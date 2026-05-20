import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteSessionDB } from "./sqlite-session-db.js";
import { reconstructSessionCompressionState } from "./session-compression-state.js";

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

  it("requires an existing session before replacing messages", async () => {
    const db = new SQLiteSessionDB({ path: dbPath });
    try {
      await expect(db.replaceMessages({
        sessionId: "missing-session",
        messages: [{ role: "user", content: "replacement" }]
      })).rejects.toThrow("Session not found: missing-session");
    } finally {
      db.close();
    }
  });

  it("transactionally replaces messages and FTS rows in stable order", async () => {
    const db = new SQLiteSessionDB({
      path: dbPath,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
      id: (() => {
        let next = 0;
        return () => `generated-${++next}`;
      })()
    });

    try {
      await db.createSession({ id: "session-1", profileId: "default" });
      await db.appendMessage({ id: "old-1", sessionId: "session-1", role: "user", content: "old searchable content" });

      const replacement = await db.replaceMessages({
        sessionId: "session-1",
        messages: [
          {
            role: "tool",
            content: "new beta content",
            channel: "cli",
            metadata: {
              tool_call_id: "call-tool",
              tool_call_name: "memory.lookup",
              provider_native_tool_call: { id: "provider-call", type: "function" }
            }
          },
          {
            role: "agent",
            content: "new gamma content"
          },
          {
            id: "new-1",
            role: "user",
            content: "new alpha content",
            createdAt: "2030-01-01T00:00:10.000Z",
            metadata: {
              tool_call_id: "call-user",
              tool_call_name: "memory.lookup"
            }
          }
        ]
      });

      expect(replacement.map((message) => message.id)).toEqual(["generated-1", "generated-2", "new-1"]);
      expect(replacement.map((message) => message.createdAt)).toEqual([
        "2030-01-01T00:00:00.000Z",
        "2030-01-01T00:00:00.001Z",
        "2030-01-01T00:00:10.000Z"
      ]);

      const messages = await db.listMessages("session-1");
      expect(messages.map((message) => message.content)).toEqual([
        "new beta content",
        "new gamma content",
        "new alpha content"
      ]);
      expect(messages[0]?.metadata).toMatchObject({
        tool_call_id: "call-tool",
        tool_call_name: "memory.lookup",
        provider_native_tool_call: { id: "provider-call", type: "function" }
      });

      await expect(db.search("old", { profileId: "default" })).resolves.toHaveLength(0);
      const newResults = await db.search("beta", { profileId: "default" });
      expect(newResults.map((result) => result.message.id)).toEqual(["generated-1"]);
    } finally {
      db.close();
    }
  });

  it("rolls back messages and FTS rows when replacement insert fails", async () => {
    const db = new SQLiteSessionDB({ path: dbPath });

    try {
      await db.createSession({ id: "session-1", profileId: "default" });
      await db.appendMessage({
        id: "old-1",
        sessionId: "session-1",
        role: "user",
        content: "old rollback searchable"
      });

      await expect(db.replaceMessages({
        sessionId: "session-1",
        messages: [
          { id: "duplicate", role: "user", content: "new should rollback" },
          { id: "duplicate", role: "agent", content: "new should also rollback" }
        ]
      })).rejects.toThrow();

      const messages = await db.listMessages("session-1");
      expect(messages.map((message) => message.id)).toEqual(["old-1"]);
      expect(messages[0]?.content).toBe("old rollback searchable");
      await expect(db.search("rollback", { profileId: "default" })).resolves.toHaveLength(1);
      await expect(db.search("should", { profileId: "default" })).resolves.toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("reconstructs compression state after reopening the session DB", async () => {
    const first = new SQLiteSessionDB({ path: dbPath });
    try {
      await first.createSession({ id: "session-1", profileId: "default" });
      await first.appendEvent("session-1", {
        kind: "session-compression-state",
        state: {
          status: "compressed",
          trigger: "manual",
          protectedFirstN: 3,
          protectedLastN: 20,
          protectedSpans: [],
          summaryFormatVersion: "session-summary.v1",
          summaryChars: 320,
          fallbackUsed: false,
          warnings: []
        }
      });
    } finally {
      first.close();
    }

    const reopened = new SQLiteSessionDB({ path: dbPath });
    try {
      const state = reconstructSessionCompressionState(await reopened.listEvents("session-1"));
      expect(state).toMatchObject({
        status: "compressed",
        trigger: "manual",
        protectedFirstN: 3,
        protectedLastN: 20,
        summaryFormatVersion: "session-summary.v1",
        summaryChars: 320,
        fallbackUsed: false
      });
    } finally {
      reopened.close();
    }
  });

  it("lists same-timestamp session events in insertion order", async () => {
    const db = new SQLiteSessionDB({
      path: dbPath,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
      id: (() => {
        let next = 0;
        return () => `event-${++next}`;
      })()
    });

    try {
      await db.createSession({ id: "session-1", profileId: "default" });
      await db.appendEvent("session-1", {
        kind: "session-history-compressed",
        trigger: "auto",
        source: { messageCount: 10 },
        protectedFirstN: 3,
        protectedLastN: 20,
        summaryFormatVersion: "session-summary.v1",
        summaryChars: 128
      });
      await db.appendEvent("session-1", {
        kind: "session-compression-state",
        state: {
          status: "compressed",
          trigger: "auto",
          compressionCount: 1,
          protectedFirstN: 3,
          protectedLastN: 20,
          protectedSpans: [],
          summaryFormatVersion: "session-summary.v1",
          summaryChars: 128,
          fallbackUsed: false,
          warnings: []
        }
      });
      await db.appendEvent("session-1", {
        kind: "external-memory-recall",
        providerIds: ["file"],
        enabled: true,
        attempted: true,
        resultCount: 0,
        totalChars: 0,
        workspaceScoped: false,
        warningCount: 0,
        failureCount: 0
      });

      const events = await db.listEvents("session-1");

      expect(events.map((event) => event.kind)).toEqual([
        "session-history-compressed",
        "session-compression-state",
        "external-memory-recall"
      ]);
    } finally {
      db.close();
    }
  });

  it("hydrates the last inserted same-timestamp session-compression-state event", async () => {
    const db = new SQLiteSessionDB({
      path: dbPath,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
      id: (() => {
        let next = 0;
        return () => `event-${++next}`;
      })()
    });

    try {
      await db.createSession({ id: "session-1", profileId: "default" });
      await db.appendEvent("session-1", {
        kind: "session-compression-state",
        state: {
          status: "compressed",
          trigger: "auto",
          compressionCount: 1,
          ineffectiveCompressionCount: 1,
          protectedFirstN: 3,
          protectedLastN: 20,
          protectedSpans: [],
          summaryFormatVersion: "session-summary.v1",
          summaryChars: 128,
          fallbackUsed: false,
          warnings: ["older state"]
        }
      });
      await db.appendEvent("session-1", {
        kind: "session-compression-state",
        state: {
          status: "compressed",
          trigger: "manual",
          compressionCount: 2,
          ineffectiveCompressionCount: 0,
          protectedFirstN: 4,
          protectedLastN: 30,
          protectedSpans: [],
          summaryFormatVersion: "session-summary.v1",
          summaryChars: 256,
          fallbackUsed: true,
          fallbackReason: "deterministic-packing",
          warnings: ["newer state"]
        }
      });

      const state = reconstructSessionCompressionState(await db.listEvents("session-1"));

      expect(state).toMatchObject({
        status: "compressed",
        trigger: "manual",
        compressionCount: 2,
        ineffectiveCompressionCount: 0,
        protectedFirstN: 4,
        protectedLastN: 30,
        summaryChars: 256,
        fallbackUsed: true,
        fallbackReason: "deterministic-packing",
        warnings: ["newer state"]
      });
    } finally {
      db.close();
    }
  });

  it("lists same-timestamp profile-scoped session events in insertion order", async () => {
    const db = new SQLiteSessionDB({
      path: dbPath,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
      id: (() => {
        let next = 0;
        return () => `event-${++next}`;
      })()
    });

    try {
      await db.createSession({ id: "session-1", profileId: "default" });
      await db.appendEvent("session-1", {
        kind: "session-history-packed",
        sourceMessageCount: 10,
        summarizedMessageCount: 4,
        protectedMessageCount: 6,
        estimatedTokens: 900
      });
      await db.appendEvent("session-1", {
        kind: "session-history-compressed",
        trigger: "manual",
        source: { messageCount: 10 },
        protectedFirstN: 3,
        protectedLastN: 20,
        summaryFormatVersion: "session-summary.v1",
        summaryChars: 128
      });
      await db.appendEvent("session-1", {
        kind: "session-compression-state",
        state: {
          status: "compressed",
          trigger: "manual",
          compressionCount: 1,
          protectedFirstN: 3,
          protectedLastN: 20,
          protectedSpans: [],
          summaryFormatVersion: "session-summary.v1",
          summaryChars: 128,
          fallbackUsed: false,
          warnings: []
        }
      });

      const events = await db.listEventsForProfile("session-1", "default");

      expect(events.map((event) => event.kind)).toEqual([
        "session-history-packed",
        "session-history-compressed",
        "session-compression-state"
      ]);
    } finally {
      db.close();
    }
  });
});
