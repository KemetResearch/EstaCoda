import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSQLiteDatabase } from "./factory.js";
import type { SQLiteDatabase } from "./sqlite.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "estacoda-sqlite-adapter-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withBetterSQLite<T>(fn: (db: SQLiteDatabase, dir: string) => Promise<T>): Promise<T> {
  return withTempDir(async (dir) => {
    const db = await openSQLiteDatabase({ path: join(dir, "adapter.sqlite"), driver: "better-sqlite3", timeoutMs: 50 });
    try {
      return await fn(db, dir);
    } finally {
      db.close();
    }
  });
}

describe("SQLite adapter interface", () => {
  it("opens better-sqlite3 through the factory by default", async () => {
    await withTempDir(async (dir) => {
      const db = await openSQLiteDatabase({ path: join(dir, "default.sqlite") });
      try {
        db.exec("CREATE TABLE probe (value TEXT NOT NULL)");
        const result = db.query("INSERT INTO probe (value) VALUES (?)").run("ok");
        const row = db.query<{ value: string }>("SELECT value FROM probe").get();

        expect(result.changes).toBe(1);
        expect(row).toEqual({ value: "ok" });
      } finally {
        db.close();
      }
    });
  });

  it("normalizes missing rows and statement run values", async () => {
    await withBetterSQLite(async (db) => {
      db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");

      const insert = db.query("INSERT INTO items (name) VALUES (?)").run("alpha");
      const update = db.query("UPDATE items SET name = ? WHERE id = ?").run("beta", insert.lastInsertRowid ?? 1);
      const missing = db.query<{ name: string }>("SELECT name FROM items WHERE id = ?").get(-1);

      expect(insert.changes).toBe(1);
      expect(typeof insert.lastInsertRowid === "number" || typeof insert.lastInsertRowid === "bigint").toBe(true);
      expect(update.changes).toBe(1);
      expect(missing).toBeNull();
    });
  });
});

describe("better-sqlite3 verification gate", () => {
  it("proves FTS5 and bm25(messages_fts) work", async () => {
    await withBetterSQLite(async (db) => {
      db.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(content)");
      db.query("INSERT INTO messages_fts (content) VALUES (?)").run("hello from estacoda");
      db.query("INSERT INTO messages_fts (content) VALUES (?)").run("unrelated text");

      const rows = db.query<{ content: string; rank: number }>(
        "SELECT content, bm25(messages_fts) AS rank FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank"
      ).all("hello");

      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe("hello from estacoda");
      expect(typeof rows[0].rank).toBe("number");
    });
  });

  it("proves WAL mode can be enabled", async () => {
    await withBetterSQLite(async (db) => {
      const row = db.query<{ journal_mode: string }>("PRAGMA journal_mode = WAL").get();
      expect(row?.journal_mode.toLowerCase()).toBe("wal");
    });
  });

  it("proves vacuum into creates a queryable backup", async () => {
    await withBetterSQLite(async (db, dir) => {
      const backupPath = join(dir, "backup.sqlite");
      db.exec("CREATE TABLE source (value TEXT NOT NULL)");
      db.query("INSERT INTO source (value) VALUES (?)").run("backed-up");
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

      expect(existsSync(backupPath)).toBe(true);

      const backup = await openSQLiteDatabase({ path: backupPath, driver: "better-sqlite3", readonly: true });
      try {
        expect(backup.query<{ value: string }>("SELECT value FROM source").get()).toEqual({ value: "backed-up" });
      } finally {
        backup.close();
      }
    });
  });

  it("proves delete returning works", async () => {
    await withBetterSQLite(async (db) => {
      db.exec("CREATE TABLE deleted_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
      const inserted = db.query("INSERT INTO deleted_items (name) VALUES (?)").run("remove-me");
      const deleted = db.query<{ id: number; name: string }>(
        "DELETE FROM deleted_items WHERE id = ? RETURNING id, name"
      ).get(inserted.lastInsertRowid ?? 1);

      expect(deleted).toEqual({ id: Number(inserted.lastInsertRowid), name: "remove-me" });
      expect(db.query<{ count: number }>("SELECT count(*) AS count FROM deleted_items").get()).toEqual({ count: 0 });
    });
  });

  it("proves transaction rollback matches Bun-era synchronous expectations", async () => {
    await withBetterSQLite(async (db) => {
      db.exec("CREATE TABLE rollback_items (value TEXT NOT NULL)");
      db.exec("BEGIN");
      db.query("INSERT INTO rollback_items (value) VALUES (?)").run("temporary");
      db.exec("ROLLBACK");

      expect(db.query<{ count: number }>("SELECT count(*) AS count FROM rollback_items").get()).toEqual({ count: 0 });
    });
  });

  it("proves safe integer values are returned as numbers", async () => {
    await withBetterSQLite(async (db) => {
      db.exec("CREATE TABLE integers (value INTEGER NOT NULL)");
      db.query("INSERT INTO integers (value) VALUES (?)").run(Number.MAX_SAFE_INTEGER);

      const row = db.query<{ value: number }>("SELECT value FROM integers").get();
      expect(row).toEqual({ value: Number.MAX_SAFE_INTEGER });
      expect(Number.isSafeInteger(row?.value)).toBe(true);
    });
  });

  it("proves busy locking behavior is surfaced", async () => {
    await withTempDir(async (dir) => {
      const dbPath = join(dir, "busy.sqlite");
      const first = await openSQLiteDatabase({ path: dbPath, driver: "better-sqlite3", timeoutMs: 1 });
      const second = await openSQLiteDatabase({ path: dbPath, driver: "better-sqlite3", timeoutMs: 1 });

      try {
        first.exec("PRAGMA journal_mode = DELETE");
        first.exec("CREATE TABLE busy_items (value TEXT NOT NULL)");
        first.exec("BEGIN EXCLUSIVE");

        expect(() => second.query("INSERT INTO busy_items (value) VALUES (?)").run("blocked")).toThrow(/busy|locked/i);
      } finally {
        first.exec("ROLLBACK");
        second.close();
        first.close();
      }
    });
  });

  it("opens and queries a DB created by Bun SQLite when Bun is available", async () => {
    const bunAvailable = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;
    if (!bunAvailable) {
      console.warn("Skipping Bun-created SQLite compatibility check because bun is not available.");
      return;
    }

    await withTempDir(async (dir) => {
      const dbPath = join(dir, "bun-created.sqlite");
      const script = `
        import { Database } from "bun:sqlite";
        const db = new Database(${JSON.stringify(dbPath)});
        db.exec("CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
        db.query("INSERT INTO fixture (value) VALUES (?)").run("bun-created");
        db.close();
      `;

      const result = spawnSync("bun", ["-e", script], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);

      const db = await openSQLiteDatabase({ path: dbPath, driver: "better-sqlite3", readonly: true });
      try {
        expect(db.query<{ value: string }>("SELECT value FROM fixture WHERE id = 1").get()).toEqual({ value: "bun-created" });
      } finally {
        db.close();
      }
    });
  });
});
