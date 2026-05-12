import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteSessionDB } from "./sqlite-session-db.js";

describe("SQLiteSessionDB", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-session-db-test-"));
    dbPath = join(tmpDir, "sessions.sqlite");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates sessions and messages through the internal SQLite adapter", async () => {
    const db = new SQLiteSessionDB({
      path: dbPath,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
      id: () => "fixed-id"
    });

    try {
      const session = await db.createSession({ id: "session-1", profileId: "default", title: "Adapter session" });
      const message = await db.appendMessage({
        id: "message-1",
        sessionId: session.id,
        role: "user",
        content: "adapter-backed search text"
      });

      expect(session.profileId).toBe("default");
      expect(message.sessionId).toBe("session-1");
      await expect(db.listMessages("session-1")).resolves.toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("opens an existing DB and preserves FTS search behavior", async () => {
    const first = new SQLiteSessionDB({ path: dbPath });
    try {
      const session = await first.createSession({ id: "session-1", profileId: "default" });
      await first.appendMessage({
        id: "message-1",
        sessionId: session.id,
        role: "agent",
        content: "needle phrase for ranked retrieval"
      });
    } finally {
      first.close();
    }

    const reopened = new SQLiteSessionDB({ path: dbPath });
    try {
      const results = await reopened.search("needle", { profileId: "default" });
      expect(results).toHaveLength(1);
      expect(results[0].message.id).toBe("message-1");
      expect(typeof results[0].score).toBe("number");
    } finally {
      reopened.close();
    }
  });
});
