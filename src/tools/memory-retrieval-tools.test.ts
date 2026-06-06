import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MEMORY_CONFIG } from "../config/memory-config.js";
import { resolveProfileStateHome } from "../config/profile-home.js";
import { MemoryIndex } from "../memory/memory-index.js";
import { MemoryIndexStore } from "../memory/memory-index-store.js";
import { LocalMemoryRetrievalService } from "../memory/memory-retrieval-service.js";
import { createSessionSearchTool } from "./session-search-tool.js";
import {
  createMemoryReadTool,
  createMemorySearchTool,
  MEMORY_RETRIEVAL_TOOL_MAX_RESULT_CHARS,
  memoryRetrievalToolProvider
} from "./memory-retrieval-tools.js";
import { toolRegistrationPlan } from "./index.js";

const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "estacoda-memory-retrieval-tools-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("memory retrieval tools", () => {
  it("memory.read USER.md", async () => {
    const { readTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "USER.md",
      content: "- Prefers concise replies."
    });

    try {
      const result = await readTool.run({ source: "USER.md" });
      const payload = parsePayload(result);

      expect(result.ok).toBe(true);
      expect(payload.result).toMatchObject({
        source: "USER.md",
        memoryFileKind: "USER.md",
        protectedClass: "none",
        authority: "canonical",
        content: "- Prefers concise replies.",
        contextLabel: "local-memory-context",
        instructionBoundary: "context-not-instruction",
        trusted: false
      });
    } finally {
      cleanup();
    }
  });

  it("memory.read MEMORY.md", async () => {
    const { readTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "MEMORY.md",
      content: "- Project uses pnpm."
    });

    try {
      const payload = parsePayload(await readTool.run({ source: "MEMORY.md" }));

      expect(payload.result).toMatchObject({
        source: "MEMORY.md",
        memoryFileKind: "MEMORY.md",
        content: "- Project uses pnpm.",
        contextLabel: "local-memory-context"
      });
    } finally {
      cleanup();
    }
  });

  it("memory.read shared memory", async () => {
    const { readTool, index, cleanup } = await createIndexedTools();
    index.indexSharedMemory({
      profileId: "alpha",
      sourceKey: "team",
      content: "- Shared release checklist."
    });

    try {
      const payload = parsePayload(await readTool.run({ source: "shared", key: "team" }));

      expect(payload.result).toMatchObject({
        sourceType: "shared_memory",
        source: "team",
        sourceKey: "team",
        content: "- Shared release checklist.",
        instructionBoundary: "context-not-instruction"
      });
    } finally {
      cleanup();
    }
  });

  it("memory.read SOUL.md denied without includeProtected", async () => {
    const { readTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "SOUL.md",
      content: "Identity guardrails."
    });

    try {
      const result = await readTool.run({ source: "SOUL.md" });
      const payload = parsePayload(result);

      expect(result.ok).toBe(false);
      expect(payload.result).toBeNull();
      expect(payload.diagnostics.diagnostics).toContainEqual(expect.objectContaining({
        code: "memory-protected-filtered",
        source: "SOUL.md",
        protectedClass: "identity"
      }));
    } finally {
      cleanup();
    }
  });

  it("memory.read SOUL.md allowed with includeProtected", async () => {
    const { readTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "SOUL.md",
      content: "Identity guardrails stay bounded."
    });

    try {
      const payload = parsePayload(await readTool.run({
        source: "SOUL.md",
        includeProtected: true,
        maxChars: 16
      }));

      expect(payload.result).toMatchObject({
        source: "SOUL.md",
        protectedClass: "identity",
        content: "Identity guardra"
      });
      expect(payload.diagnostics.truncated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("memory.search lexical", async () => {
    const { searchTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "USER.md",
      content: "Needle preference memory."
    });

    try {
      const result = await searchTool.run({ query: "needle" });
      const payload = parsePayload(result);

      expect(result.ok).toBe(true);
      expect(payload.results).toEqual([
        expect.objectContaining({
          source: "USER.md",
          content: "Needle preference memory.",
          contextLabel: "local-memory-context"
        })
      ]);
    } finally {
      cleanup();
    }
  });

  it("memory.search bounded output", async () => {
    const { searchTool, index, cleanup } = await createIndexedTools();
    for (let item = 1; item <= 30; item += 1) {
      index.indexSharedMemory({
        profileId: "alpha",
        sourceKey: `large-${item}`,
        content: `needle ${"x".repeat(2_000)}`
      });
    }

    try {
      const result = await searchTool.run({
        query: "needle",
        maxResults: 999,
        maxChars: 1_000
      });

      expect(result.content.length).toBeLessThanOrEqual(MEMORY_RETRIEVAL_TOOL_MAX_RESULT_CHARS);
      expect(result.metadata).toMatchObject({
        truncated: true
      });
    } finally {
      cleanup();
    }
  });

  it("memory.search redacted output", async () => {
    const { searchTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "USER.md",
      content: "needle OPENAI_API_KEY=secretsecretsecretsecretsecret"
    });

    try {
      const result = await searchTool.run({ query: "needle" });

      expect(result.content).toContain("OPENAI_API_KEY=[REDACTED]");
      expect(result.content).not.toContain("secretsecret");
      expect(parsePayload(result).diagnostics.redactionApplied).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("memory.search excludes protected entries by default", async () => {
    const { searchTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "SOUL.md",
      content: "Protected identity marker."
    });
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "MEMORY.md",
      content: "Visible marker."
    });

    try {
      const payload = parsePayload(await searchTool.run({ query: "marker" }));

      expect(payload.results.map((entry: { source: string }) => entry.source)).toEqual(["MEMORY.md"]);
      expect(payload.diagnostics.diagnostics).toContainEqual(expect.objectContaining({
        code: "memory-protected-filtered"
      }));
    } finally {
      cleanup();
    }
  });

  it("includeProtected returns bounded protected excerpt", async () => {
    const { searchTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "SOUL.md",
      content: "Protected identity marker should stay bounded."
    });

    try {
      const payload = parsePayload(await searchTool.run({
        query: "marker",
        includeProtected: true,
        maxChars: 18
      }));

      expect(payload.results).toEqual([
        expect.objectContaining({
          source: "SOUL.md",
          protectedClass: "identity",
          content: "Protected identity"
        })
      ]);
      expect(payload.diagnostics.truncated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("maxChars is accepted and bounded", async () => {
    const { readTool, searchTool, index, cleanup } = await createIndexedTools();
    index.indexMemoryFile({
      profileId: "alpha",
      memoryFileKind: "USER.md",
      content: `needle ${"A".repeat(120)}`
    });

    try {
      const readPayload = parsePayload(await readTool.run({ source: "USER.md", maxChars: 12 }));
      const searchPayload = parsePayload(await searchTool.run({
        query: "needle",
        maxChars: 12
      }));

      expect(readPayload.result.content).toHaveLength(12);
      expect(searchPayload.results[0].content).toHaveLength(12);
      expect(JSON.stringify(readTool.inputSchema)).toContain("maxChars");
      expect(JSON.stringify(searchTool.inputSchema)).toContain("maxChars");
    } finally {
      cleanup();
    }
  });

  it("tool registration includes memory.read and memory.search", () => {
    const entry = toolRegistrationPlan.find((item) => item.provider.name === "memoryRetrieval");

    expect(entry).toMatchObject({
      phase: "pre-skill-visibility",
      provider: {
        kind: "session",
        name: "memoryRetrieval"
      }
    });
    expect(memoryRetrievalToolProvider.createTools({
      workspaceRoot: "/workspace",
      profileId: "default",
      sessionId: "session",
      currentSessionId: () => "session"
    }).map((tool) => tool.name)).toEqual(["memory.read", "memory.search"]);
  });

  it("missing memoryRetrievalService fails clearly", async () => {
    const [readTool, searchTool] = memoryRetrievalToolProvider.createTools({
      workspaceRoot: "/workspace",
      profileId: "default",
      sessionId: "session",
      currentSessionId: () => "session"
    });

    await expect(readTool.run({ source: "USER.md" })).resolves.toMatchObject({
      ok: false,
      metadata: {
        error: "missing-memory-retrieval-service",
        dependency: "memoryRetrievalService"
      }
    });
    await expect(searchTool.run({ query: "needle" })).resolves.toMatchObject({
      ok: false,
      metadata: {
        error: "missing-memory-retrieval-service",
        dependency: "memoryRetrievalService"
      }
    });
  });

  it("index unavailable fallback is surfaced safely", async () => {
    const homeDir = await makeTempHome();
    await writeProfileMemory(homeDir, "alpha", {
      "USER.md": "Fallback visible marker."
    });
    const service = new LocalMemoryRetrievalService({ homeDir });
    const searchTool = createMemorySearchTool({
      memoryRetrievalService: service,
      profileId: "alpha"
    });

    const payload = parsePayload(await searchTool.run({ query: "marker" }));

    expect(payload.results).toEqual([
      expect.objectContaining({
        source: "USER.md",
        content: "Fallback visible marker."
      })
    ]);
    expect(payload.diagnostics).toMatchObject({
      fallbackUsed: true,
      indexAvailable: false
    });
    expect(payload.diagnostics.diagnostics).toContainEqual(expect.objectContaining({
      code: "memory-index-unavailable"
    }));
  });

  it("memory.read rejects traversal shared-memory keys before fallback", async () => {
    const homeDir = await makeTempHome();
    await writeProfileMemory(homeDir, "alpha", {
      "SOUL.md": "Tool traversal must not expose this."
    });
    const service = new LocalMemoryRetrievalService({
      homeDir,
      config: {
        ...DEFAULT_MEMORY_CONFIG,
        index: {
          ...DEFAULT_MEMORY_CONFIG.index,
          enabled: false
        }
      }
    });
    const readTool = createMemoryReadTool({
      memoryRetrievalService: service,
      profileId: "alpha"
    });

    const payload = parsePayload(await readTool.run({
      source: "shared",
      key: "../../profiles/alpha/SOUL.md"
    }));

    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: "invalid-shared-key"
      }
    });
    expect(JSON.stringify(payload)).not.toContain("Tool traversal");
  });

  it("retrieval disabled returns structured tool diagnostics without content", async () => {
    const homeDir = await makeTempHome();
    await writeProfileMemory(homeDir, "alpha", {
      "USER.md": "Tool disabled retrieval must not expose this."
    });
    const service = new LocalMemoryRetrievalService({
      homeDir,
      config: {
        ...DEFAULT_MEMORY_CONFIG,
        retrieval: {
          ...DEFAULT_MEMORY_CONFIG.retrieval,
          enabled: false
        },
        index: {
          ...DEFAULT_MEMORY_CONFIG.index,
          enabled: false
        }
      }
    });
    const readTool = createMemoryReadTool({
      memoryRetrievalService: service,
      profileId: "alpha"
    });

    const result = await readTool.run({ source: "USER.md" });
    const payload = parsePayload(result);

    expect(result.ok).toBe(false);
    expect(payload.result).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("Tool disabled retrieval");
    expect(payload.diagnostics.diagnostics).toContainEqual(expect.objectContaining({
      code: "memory-retrieval-disabled"
    }));
  });

  it("session_search schema still does not expose maxChars", () => {
    const sessionSearchTool = createSessionSearchTool({});

    expect(JSON.stringify(sessionSearchTool.inputSchema)).not.toContain("maxChars");
    expect(JSON.stringify(sessionSearchTool.inputSchema)).not.toContain("max_chars");
  });
});

async function createIndexedTools(): Promise<{
  readTool: ReturnType<typeof createMemoryReadTool>;
  searchTool: ReturnType<typeof createMemorySearchTool>;
  index: MemoryIndex;
  cleanup: () => void;
}> {
  const homeDir = await makeTempHome();
  const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });
  const index = new MemoryIndex({
    store,
    now: () => new Date("2030-01-01T00:00:00.000Z")
  });
  const service = new LocalMemoryRetrievalService({ index, homeDir });
  return {
    readTool: createMemoryReadTool({
      memoryRetrievalService: service,
      profileId: "alpha"
    }),
    searchTool: createMemorySearchTool({
      memoryRetrievalService: service,
      profileId: "alpha"
    }),
    index,
    cleanup: () => store.dispose()
  };
}

async function writeProfileMemory(
  homeDir: string,
  profileId: string,
  files: Partial<Record<"USER.md" | "MEMORY.md" | "SOUL.md", string>>
): Promise<void> {
  const paths = resolveProfileStateHome({ homeDir, profileId });
  await mkdir(paths.profileRoot, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const path = file === "USER.md"
      ? paths.userMdPath
      : file === "MEMORY.md"
        ? paths.memoryMdPath
        : paths.soulMdPath;
    await writeFile(path, content, "utf8");
  }
}

function parsePayload(result: { content: string }): any {
  return JSON.parse(result.content);
}
