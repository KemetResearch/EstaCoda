import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExternalMemoryProvider } from "../contracts/memory.js";
import {
  collectExternalMemoryRecall,
  createExternalMemoryProvidersFromConfig,
  createFileExternalMemoryProvider,
  externalMemoryProviderStatuses,
  EXTERNAL_RECALL_UNTRUSTED_NOTICE,
  mirrorMemoryWriteToExternalProviders
} from "./external-memory-provider.js";

describe("external memory provider hooks", () => {
  it("keeps recall disabled until config explicitly enables it", async () => {
    let called = false;
    const provider: ExternalMemoryProvider = {
      id: "fake",
      prefetch: () => {
        called = true;
        return [];
      }
    };

    const result = await collectExternalMemoryRecall({
      query: "last time",
      providers: [provider],
      config: {
        enabled: false,
        timeoutMs: 750,
        maxResults: 3,
        maxChars: 200,
        mirrorWrites: false
      },
      context: { profileId: "default" }
    });

    expect(called).toBe(false);
    expect(result).toEqual({ blocks: [], sourceProviders: [], warnings: [] });
  });

  it("bounds and labels external recall as untrusted", async () => {
    const provider: ExternalMemoryProvider = {
      id: "fake",
      prefetch: () => [
        { id: "one", source: "remote", content: "first remote fact ".repeat(30) },
        { id: "two", source: "remote", content: "second remote fact" }
      ]
    };

    const result = await collectExternalMemoryRecall({
      query: "last time",
      providers: [provider],
      config: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 1,
        maxChars: 60,
        mirrorWrites: false
      },
      context: { profileId: "default" }
    });

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      kind: "external-recall",
      trusted: false,
      scope: "external",
      source: "external:fake:remote"
    });
    expect(result.blocks[0]?.content).toContain(EXTERNAL_RECALL_UNTRUSTED_NOTICE);
    expect(result.blocks[0]?.content).toContain("[truncated]");
  });

  it("redacts credentials from provider status diagnostics", async () => {
    const provider: ExternalMemoryProvider = {
      id: "fake",
      status: () => ({
        id: "fake",
        enabled: true,
        healthy: true,
        diagnostics: {
          apiKey: "sk-secretsecretsecretsecretsecret",
          bearer: "Bearer secretsecretsecretsecretsecret"
        }
      })
    };

    const statuses = await externalMemoryProviderStatuses([provider], 750);

    expect(statuses).toEqual([
      expect.objectContaining({
        diagnostics: {
          apiKey: "[REDACTED]",
          bearer: "[REDACTED]"
        }
      })
    ]);
  });

  it("redacts secret-like text from external recall blocks", async () => {
    const provider: ExternalMemoryProvider = {
      id: "fake",
      prefetch: () => [
        { id: "one", source: "remote", content: "tool output OPENAI_API_KEY=sk-secretsecretsecretsecretsecret" }
      ]
    };

    const result = await collectExternalMemoryRecall({
      query: "last time",
      providers: [provider],
      config: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 1,
        maxChars: 500,
        mirrorWrites: false
      },
      context: { profileId: "default" }
    });

    expect(result.blocks[0]?.content).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(result.blocks[0]?.content).not.toContain("sk-secret");
  });

  it("isolates mirror write failures from local memory callers", async () => {
    const provider: ExternalMemoryProvider = {
      id: "fake",
      mirrorMemoryWrite: () => {
        throw new Error("TOKEN=secretsecretsecretsecretsecret");
      }
    };

    const result = await mirrorMemoryWriteToExternalProviders({
      providers: [provider],
      config: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 3,
        maxChars: 200,
        mirrorWrites: true
      },
      entry: {
        profileId: "default",
        source: "memory.curate",
        operation: {
          kind: "append",
          file: "USER.md",
          content: "- Durable local memory"
        }
      }
    });

    expect(result.warnings).toEqual([
      "external memory provider fake mirror write failed: TOKEN=[REDACTED]"
    ]);
  });

  it("does not create a file-backed provider until explicitly enabled with the file provider id", () => {
    const profileRoot = "/tmp/profile";

    expect(createExternalMemoryProvidersFromConfig({
      enabled: false,
      timeoutMs: 750,
      maxResults: 3,
      maxChars: 200,
      mirrorWrites: false
    }, { profileRoot })).toEqual([]);
    expect(createExternalMemoryProvidersFromConfig({
      enabled: true,
      provider: "unknown",
      timeoutMs: 750,
      maxResults: 3,
      maxChars: 200,
      mirrorWrites: false
    }, { profileRoot })).toEqual([]);
    expect(createExternalMemoryProvidersFromConfig({
      enabled: true,
      provider: "file",
      timeoutMs: 750,
      maxResults: 3,
      maxChars: 200,
      mirrorWrites: false,
      file: { maxEntries: 100 }
    }, { profileRoot })).toHaveLength(1);
  });

  it("file-backed provider mirrors redacted memory writes and returns bounded recall", async () => {
    const profileRoot = await mkdtemp(join(tmpdir(), "estacoda-file-memory-provider-"));
    const provider = createFileExternalMemoryProvider({
      profileRoot,
      path: "memory.jsonl",
      maxEntries: 10,
      maxChars: 2500,
      now: () => new Date("2026-05-20T00:00:00.000Z")
    });

    await provider.mirrorMemoryWrite?.({
      profileId: "default",
      sessionId: "session-1",
      source: "memory.curate",
      operation: {
        kind: "append",
        file: "USER.md",
        content: "- Parser decision: keep strict mode\nOPENAI_API_KEY=sk-secretsecretsecretsecretsecret"
      }
    });
    await provider.mirrorMemoryWrite?.({
      profileId: "other",
      source: "memory.curate",
      operation: {
        kind: "append",
        file: "USER.md",
        content: "- Other profile parser note"
      }
    });

    const recall = await provider.prefetch?.("what did we decide about parser strict mode", {
      profileId: "default",
      sessionId: "session-1",
      maxResults: 1,
      maxChars: 120
    });

    expect(recall).toHaveLength(1);
    expect(recall?.[0]).toMatchObject({
      source: "file:memory.jsonl",
      entryIds: [expect.stringMatching(/^file-/u)]
    });
    expect(recall?.[0]?.content).toContain("Parser decision: keep strict mode");
    expect(recall?.[0]?.content).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(recall?.[0]?.content).not.toContain("sk-secret");
  });

  it("file-backed provider status reports invalid paths without throwing or leaking secrets", async () => {
    const provider = createFileExternalMemoryProvider({
      profileRoot: "/tmp/profile",
      path: "../escape.jsonl"
    });

    const statuses = await externalMemoryProviderStatuses([provider], 750);

    expect(statuses).toEqual([
      expect.objectContaining({
        id: "file",
        enabled: true,
        healthy: false,
        message: "file external memory path is invalid"
      })
    ]);
  });

  it("file-backed provider rejects absolute escape paths as safe provider failures", async () => {
    const provider = createFileExternalMemoryProvider({
      profileRoot: "/tmp/profile",
      path: "/tmp/escape.jsonl"
    });

    const result = await mirrorMemoryWriteToExternalProviders({
      providers: [provider],
      config: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 3,
        maxChars: 200,
        mirrorWrites: true
      },
      entry: {
        profileId: "default",
        source: "memory.curate",
        operation: { kind: "append", file: "USER.md", content: "- local still wins" }
      }
    });

    expect(result.warnings).toEqual([
      "external memory provider file mirror write failed: absolute external memory file paths are not allowed"
    ]);
  });

  it("file-backed provider trims old entries by maxEntries", async () => {
    const profileRoot = await mkdtemp(join(tmpdir(), "estacoda-file-memory-provider-"));
    let tick = 0;
    const provider = createFileExternalMemoryProvider({
      profileRoot,
      path: "memory.jsonl",
      maxEntries: 1,
      now: () => new Date(1_790_000_000_000 + tick++)
    });

    await provider.mirrorMemoryWrite?.({
      profileId: "default",
      source: "memory.curate",
      operation: { kind: "append", file: "USER.md", content: "- Old parser note" }
    });
    await provider.mirrorMemoryWrite?.({
      profileId: "default",
      source: "memory.curate",
      operation: { kind: "append", file: "USER.md", content: "- New parser note" }
    });

    const content = await readFile(join(profileRoot, "external-memory", "memory.jsonl"), "utf8");
    expect(content).not.toContain("Old parser note");
    expect(content).toContain("New parser note");
  });

  it("file-backed provider truncates oversized mirrored, turn, and session-summary records before persistence", async () => {
    const profileRoot = await mkdtemp(join(tmpdir(), "estacoda-file-memory-provider-"));
    const provider = createFileExternalMemoryProvider({
      profileRoot,
      path: "memory.jsonl",
      maxEntries: 10,
      maxChars: 80,
      now: () => new Date("2026-05-20T00:00:00.000Z")
    });

    await provider.mirrorMemoryWrite?.({
      profileId: "default",
      source: "memory.curate",
      metadata: { huge: "metadata ".repeat(200) },
      operation: {
        kind: "append",
        file: "USER.md",
        content: `- ${"very large mirrored memory ".repeat(40)}OPENAI_API_KEY=sk-secretsecretsecretsecretsecret`
      }
    });
    await provider.afterTurn?.({
      profileId: "default",
      userText: "user turn ".repeat(80),
      assistantText: "assistant turn ".repeat(80)
    });
    await provider.flushSession?.({
      profileId: "default",
      summary: "session summary ".repeat(80)
    });

    const content = await readFile(join(profileRoot, "external-memory", "memory.jsonl"), "utf8");
    const records = content.trim().split("\n").map((line) => JSON.parse(line) as { content: string; metadata?: Record<string, unknown> });
    expect(records).toHaveLength(3);
    expect(records.every((record) => record.content.length <= 92)).toBe(true);
    expect(records.map((record) => record.content).join("\n")).toContain("[truncated]");
    expect(records.map((record) => record.content).join("\n")).not.toContain("sk-secret");
    expect(records[0]?.metadata).toMatchObject({
      operation: {
        kind: "append",
        file: "USER.md",
        contentChars: expect.any(Number)
      }
    });
    expect(JSON.stringify(records[0]?.metadata)).not.toContain("very large mirrored memory");
  });

  it("file-backed provider tolerates malformed and oversized JSONL while reading a bounded recent window", async () => {
    const profileRoot = await mkdtemp(join(tmpdir(), "estacoda-file-memory-provider-"));
    const provider = createFileExternalMemoryProvider({
      profileRoot,
      path: "memory.jsonl",
      maxEntries: 2,
      maxChars: 60
    });
    const memoryPath = join(profileRoot, "external-memory", "memory.jsonl");
    await mkdir(join(profileRoot, "external-memory"), { recursive: true });
    await writeFile(memoryPath, [
      "not json",
      JSON.stringify({
        id: "old",
        kind: "memory-write",
        profileId: "default",
        source: "memory.curate",
        content: "old parser note should fall outside maxEntries",
        createdAt: "2026-05-19T00:00:00.000Z"
      }),
      JSON.stringify({
        id: "oversized",
        kind: "memory-write",
        profileId: "default",
        source: "memory.curate",
        content: "parser ".repeat(20_000),
        createdAt: "2026-05-20T00:00:00.000Z"
      }),
      "{ malformed recent line",
      JSON.stringify({
        id: "new",
        kind: "memory-write",
        profileId: "default",
        source: "memory.curate",
        content: "new parser note survives bounded read",
        createdAt: "2026-05-20T00:00:01.000Z"
      })
    ].join("\n"), "utf8");

    const recall = await provider.search?.("parser note", {
      profileId: "default",
      maxResults: 1,
      maxChars: 20
    });

    expect(recall).toHaveLength(1);
    expect(recall?.[0]?.id).toBe("new");
    expect(recall?.[0]?.content).toContain("[truncated]");
    expect(recall?.[0]?.content).not.toContain("old parser note");
  });
});
