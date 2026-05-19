import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExternalMemoryProvider } from "../contracts/memory.js";
import { createFileExternalMemoryProvider } from "./external-memory-provider.js";
import { createMemoryTool } from "./memory-tool.js";
import { MemoryStore } from "./memory-store.js";

describe("memory.curate", () => {
  it("does not accept AGENTS.md", async () => {
    const tool = createMemoryTool(new MemoryStore());

    await expect(tool.run({
      kind: "append",
      file: "AGENTS.md",
      content: "workspace instructions do not belong in memory"
    } as never)).rejects.toThrow("memory.curate does not manage AGENTS.md");
  });

  it("returns structured overflow metadata without mutating memory", async () => {
    const store = new MemoryStore({ budgets: [{ kind: "USER.md", maxChars: 10 }] });
    store.write("USER.md", "short");
    const tool = createMemoryTool(store);

    const result = await tool.run({
      kind: "append",
      file: "USER.md",
      content: "too long"
    });

    expect(result.ok).toBe(false);
    expect(result.metadata).toMatchObject({
      error: "memory-budget-overflow",
      pressure: {
        kind: "USER.md",
        state: "overflow"
      }
    });
    expect(store.read("USER.md")).toBe("short");
  });

  it("does not fail local memory writes when external mirror writes fail", async () => {
    const store = new MemoryStore();
    const provider: ExternalMemoryProvider = {
      id: "fake",
      mirrorMemoryWrite: vi.fn(async () => {
        throw new Error("api_key=secretsecretsecretsecretsecret");
      })
    };
    const tool = createMemoryTool(store, {
      profileId: "default",
      sessionId: "session-1",
      workspaceRoot: "/workspace/a",
      externalMemoryProviders: [provider],
      externalMemory: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 3,
        maxChars: 2500,
        mirrorWrites: true
      }
    });

    const result = await tool.run({
      kind: "append",
      file: "USER.md",
      content: "- Likes structured summaries"
    });

    expect(result.ok).toBe(true);
    expect(store.read("USER.md")).toContain("Likes structured summaries");
    expect(provider.mirrorMemoryWrite).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "default",
      sessionId: "session-1",
      workspaceRoot: "/workspace/a",
      source: "memory.curate",
      operation: expect.objectContaining({
        kind: "append",
        file: "USER.md"
      })
    }));
    expect(result.metadata?.warnings).toEqual([
      "external memory provider fake mirror write failed: api_key=[REDACTED]"
    ]);
  });

  it("mirrors memory writes to the file-backed external provider when explicitly enabled", async () => {
    const profileRoot = await mkdtemp(join(tmpdir(), "estacoda-memory-tool-file-provider-"));
    const store = new MemoryStore();
    const provider = createFileExternalMemoryProvider({
      profileRoot,
      path: "memory.jsonl"
    });
    const tool = createMemoryTool(store, {
      profileId: "default",
      sessionId: "session-1",
      workspaceRoot: "/workspace/a",
      externalMemoryProviders: [provider],
      externalMemory: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 3,
        maxChars: 2500,
        mirrorWrites: true
      }
    });

    const result = await tool.run({
      kind: "append",
      file: "USER.md",
      content: "- Likes external-memory tests"
    });

    expect(result.ok).toBe(true);
    expect(result.metadata).toBeUndefined();
    expect(store.read("USER.md")).toContain("Likes external-memory tests");
    const mirrored = await readFile(join(profileRoot, "external-memory", "memory.jsonl"), "utf8");
    expect(mirrored).toContain("Likes external-memory tests");
    expect(mirrored).toContain("\"workspaceRoot\":\"/workspace/a\"");
  });
});
