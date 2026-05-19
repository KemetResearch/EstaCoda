import type { ExternalMemoryProvider, MemoryFileKind, MemoryOperation } from "../contracts/memory.js";
import type { RegisteredTool, ToolResult } from "../contracts/tool.js";
import type { ExternalMemoryRuntimeConfig } from "./external-memory-provider.js";
import { mirrorMemoryWriteToExternalProviders } from "./external-memory-provider.js";
import { isMemoryBudgetOverflowError, type MemoryStore } from "./memory-store.js";

const MEMORY_CURATE_FILES: readonly MemoryFileKind[] = ["MEMORY.md", "USER.md", "SOUL.md"];

export type MemoryToolOptions = {
  externalMemory?: ExternalMemoryRuntimeConfig;
  externalMemoryProviders?: ExternalMemoryProvider[];
  profileId?: string;
  sessionId?: string;
  workspaceRoot?: string;
};

export function createMemoryTool(memoryStore: MemoryStore, options: MemoryToolOptions = {}): RegisteredTool<MemoryToolInput> {
  return {
    name: "memory.curate",
    description:
      "Curate bounded EstaCoda memory. Memory is already injected into context; use this only to add, replace, or remove durable facts.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["append", "replace", "remove"] },
        file: { type: "string", enum: MEMORY_CURATE_FILES },
        content: { type: "string" },
        match: { type: "string" },
        replacement: { type: "string" }
      },
      required: ["kind", "file"]
    },
    riskClass: "workspace-write",
    toolsets: ["core", "memory"],
    progressLabel: "curating memory",
    maxResultSizeChars: 2000,
    isAvailable: () => true,
    run: async (input) => applyMemoryToolInput(memoryStore, input, options)
  };
}

type MemoryToolInput = {
  kind: "append" | "replace" | "remove";
  file: string;
  content?: string;
  match?: string;
  replacement?: string;
};

async function applyMemoryToolInput(
  memoryStore: MemoryStore,
  input: MemoryToolInput,
  options: MemoryToolOptions
): Promise<ToolResult> {
  const operation = toOperation(input);
  try {
    memoryStore.apply(operation);
  } catch (error) {
    if (isMemoryBudgetOverflowError(error)) {
      return {
        ok: false,
        content: [
          `${error.overflow.kind} was not updated because it exceeded the memory budget.`,
          `Budget: ${error.overflow.chars}/${error.overflow.maxChars} chars (${error.overflow.pressure.state}).`
        ].join("\n"),
        metadata: {
          error: error.overflow.code,
          overflow: error.overflow,
          pressure: error.overflow.pressure
        }
      };
    }
    throw error;
  }

  const mirror = await mirrorMemoryWriteToExternalProviders({
    entry: {
      profileId: options.profileId ?? "default",
      sessionId: options.sessionId,
      workspaceRoot: options.workspaceRoot,
      operation,
      source: "memory.curate"
    },
    providers: options.externalMemoryProviders ?? [],
    config: options.externalMemory ?? {
      enabled: false,
      timeoutMs: 750,
      maxResults: 3,
      maxChars: 2_500,
      mirrorWrites: false
    }
  });

  return {
    ok: true,
    content: [
      `${input.file} updated with ${input.kind}`,
      ...mirror.warnings
    ].join("\n"),
    metadata: mirror.warnings.length === 0 ? undefined : {
      warnings: mirror.warnings
    }
  };
}

function toOperation(input: MemoryToolInput): MemoryOperation {
  const file = assertMemoryFile(input.file);

  if (input.kind === "append") {
    assertPresent(input.content, "content");
    return {
      kind: "append",
      file,
      content: input.content
    };
  }

  if (input.kind === "replace") {
    assertPresent(input.match, "match");
    assertPresent(input.replacement, "replacement");
    return {
      kind: "replace",
      file,
      match: input.match,
      replacement: input.replacement
    };
  }

  assertPresent(input.match, "match");
  return {
    kind: "remove",
    file,
    match: input.match
  };
}

function assertMemoryFile(file: string): MemoryFileKind {
  if (MEMORY_CURATE_FILES.includes(file as MemoryFileKind)) {
    return file as MemoryFileKind;
  }

  throw new Error(`memory.curate does not manage ${file}`);
}

function assertPresent(value: string | undefined, field: string): asserts value is string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`memory.curate requires ${field}`);
  }
}
