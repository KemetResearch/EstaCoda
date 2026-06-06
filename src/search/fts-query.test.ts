import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionDB } from "../session/in-memory-session-db.js";
import { SQLiteSessionDB } from "../session/sqlite-session-db.js";
import { quoteFtsTerm, toFtsQuery, tokenizeSearchTerms } from "./fts-query.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "estacoda-fts-query-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("fts query helpers", () => {
  it("returns an empty query for empty input", () => {
    expect(toFtsQuery("")).toBe("");
    expect(toFtsQuery("   ")).toBe("");
  });

  it("ignores single-character terms", () => {
    expect(toFtsQuery("a b c")).toBe("");
    expect(toFtsQuery("a beta c")).toBe("\"beta\"");
  });

  it("escapes quotes inside FTS terms", () => {
    expect(quoteFtsTerm('alpha"beta')).toBe('"alpha""beta"');
  });

  it("strips punctuation before quoting terms", () => {
    expect(toFtsQuery("alpha,beta.gamma")).toBe("\"alpha\" OR \"beta\" OR \"gamma\"");
  });

  it("treats FTS operators as ordinary text", () => {
    expect(toFtsQuery("alpha OR beta NOT gamma")).toBe("\"alpha\" OR \"or\" OR \"beta\" OR \"not\" OR \"gamma\"");
  });

  it("preserves Arabic terms", () => {
    expect(toFtsQuery("ذاكرة البحث")).toBe("\"ذاكرة\" OR \"البحث\"");
  });

  it("preserves mixed Arabic and English terms", () => {
    expect(tokenizeSearchTerms("Memory ذاكرة v2")).toEqual(["memory", "ذاكرة", "v2"]);
    expect(toFtsQuery("Memory ذاكرة v2")).toBe("\"memory\" OR \"ذاكرة\" OR \"v2\"");
  });

  it("produces deterministic output", () => {
    const query = "Alpha alpha ذاكرة!";

    expect(toFtsQuery(query)).toBe(toFtsQuery(query));
    expect(toFtsQuery(query)).toBe("\"alpha\" OR \"alpha\" OR \"ذاكرة\"");
  });

  it("keeps SQLite and in-memory search parity for basic terms", async () => {
    const root = await makeTempDir();
    const sqlite = new SQLiteSessionDB({
      path: join(root, "sessions.sqlite"),
      now: () => new Date("2030-01-01T00:00:00.000Z")
    });
    const memory = new InMemorySessionDB({
      now: () => new Date("2030-01-01T00:00:00.000Z")
    });

    try {
      for (const db of [sqlite, memory]) {
        await db.createSession({ id: "match-session", profileId: "default" });
        await db.createSession({ id: "miss-session", profileId: "default" });
        await db.appendMessage({
          id: "match-message",
          sessionId: "match-session",
          role: "user",
          content: "Needle phrase with ذاكرة"
        });
        await db.appendMessage({
          id: "miss-message",
          sessionId: "miss-session",
          role: "user",
          content: "unrelated content"
        });
      }

      const sqliteResults = await sqlite.search("needle ذاكرة", { profileId: "default" });
      const memoryResults = await memory.search("needle ذاكرة", { profileId: "default" });

      expect(sqliteResults.map((result) => result.message.id)).toEqual(["match-message"]);
      expect(memoryResults.map((result) => result.message.id)).toEqual(["match-message"]);
    } finally {
      sqlite.close();
    }
  });
});
