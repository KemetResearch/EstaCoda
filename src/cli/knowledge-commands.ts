import { join } from "node:path";
import { homedir } from "node:os";
import type { CliCommandResult, CliOptions } from "./cli.js";
import { MemoryStore } from "../memory/memory-store.js";
import { MemoryPromotionStore } from "../memory/memory-promotion-store.js";
import { MemoryInspector } from "../memory/memory-inspector.js";

export async function knowledge(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const [subcommand, ...restArgs] = args;

  switch (subcommand) {
    case "memory":
      return knowledgeMemory(options, restArgs);
    case "code":
      return {
        handled: true,
        exitCode: 1,
        output: "Knowledge code commands are not yet available. They will be introduced in Track B."
      };
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return {
        handled: true,
        exitCode: 0,
        output: knowledgeHelp()
      };
    default:
      return {
        handled: true,
        exitCode: 1,
        output: `Unknown knowledge subcommand: ${subcommand}\n\n${knowledgeHelp()}`
      };
  }
}

function knowledgeHelp(): string {
  return [
    "EstaCoda knowledge commands",
    "  estacoda knowledge memory list [--active-only] [--kind preference|fact] [--limit N]",
    "  estacoda knowledge memory inspect <id>",
    "  estacoda knowledge memory deactivate <id>",
    "",
    "  estacoda knowledge code deps <file-path>",
    "  estacoda knowledge code rdeps <file-path>",
    "  estacoda knowledge code affected <file-path>",
    "  estacoda knowledge code summary",
    "  estacoda knowledge code refresh"
  ].join("\n");
}

async function knowledgeMemory(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const [action, ...actionArgs] = args;

  const inspector = await openMemoryInspector(options);

  if (inspector === undefined) {
    return {
      handled: true,
      exitCode: 1,
      output: "Memory inspector is not available. Ensure the workspace has a valid memory configuration."
    };
  }

  switch (action) {
    case "list":
      return memoryList(inspector, actionArgs);
    case "inspect":
      return memoryInspect(inspector, actionArgs);
    case "deactivate":
      return memoryDeactivate(inspector, actionArgs);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return {
        handled: true,
        exitCode: 0,
        output: knowledgeMemoryHelp()
      };
    default:
      return {
        handled: true,
        exitCode: 1,
        output: `Unknown knowledge memory action: ${action}\n\n${knowledgeMemoryHelp()}`
      };
  }
}

function knowledgeMemoryHelp(): string {
  return [
    "EstaCoda knowledge memory commands",
    "  estacoda knowledge memory list [--active-only] [--kind preference|fact] [--limit N]",
    "  estacoda knowledge memory inspect <id>",
    "  estacoda knowledge memory deactivate <id>"
  ].join("\n");
}

async function memoryList(
  inspector: MemoryInspector,
  args: string[]
): Promise<CliCommandResult> {
  const activeOnly = hasFlag(args, "--active-only");
  const kind = parseKind(valueAfter(args, "--kind"));
  const limit = parseLimit(valueAfter(args, "--limit"));

  const records = await inspector.list({ activeOnly, kind, limit });

  if (records.length === 0) {
    return {
      handled: true,
      exitCode: 0,
      output: "No memory promotions found."
    };
  }

  const lines = records.map((record) => {
    const status = record.active ? "active" : "inactive";
    const provenance = record.sourceTrajectoryId !== undefined ? "provenanced" : "legacy";
    const truncated = record.content.length > 80
      ? `${record.content.slice(0, 80)}...`
      : record.content;
    return `${record.id} | ${record.kind} | ${status} | ${provenance} | ${truncated}`;
  });

  return {
    handled: true,
    exitCode: 0,
    output: ["ID | Kind | Status | Provenance | Content", "-".repeat(60), ...lines].join("\n")
  };
}

async function memoryInspect(
  inspector: MemoryInspector,
  args: string[]
): Promise<CliCommandResult> {
  const id = args[0];

  if (id === undefined) {
    return {
      handled: true,
      exitCode: 1,
      output: "Usage: estacoda knowledge memory inspect <id>"
    };
  }

  const record = await inspector.inspect(id);

  if (record === undefined) {
    return {
      handled: true,
      exitCode: 1,
      output: `No promotion record found with id: ${id}`
    };
  }

  const lines = [
    `ID: ${record.id}`,
    `Kind: ${record.kind}`,
    `Active: ${record.active}`,
    `Content: ${record.content}`,
    `Confidence: ${record.confidence}`,
    `Occurrences: ${record.occurrences}`,
    `Source: ${record.source}`,
    `Source sessions: ${record.sourceSessionIds.join(", ") || "none"}`,
    `Created at: ${record.createdAt ?? "unknown (legacy)"}`,
    `Updated at: ${record.updatedAt}`,
    `Source trajectory: ${record.sourceTrajectoryId ?? "none (legacy)"}`,
    `Source event: ${record.sourceEventId ?? "none (legacy)"}`,
    record.supersededBy === undefined ? undefined : `Superseded by: ${record.supersededBy}`,
    record.forgottenAt === undefined ? undefined : `Forgotten at: ${record.forgottenAt} (${record.forgottenReason ?? ""})`
  ].filter((line) => line !== undefined);

  return {
    handled: true,
    exitCode: 0,
    output: lines.join("\n")
  };
}

async function memoryDeactivate(
  inspector: MemoryInspector,
  args: string[]
): Promise<CliCommandResult> {
  const id = args[0];

  if (id === undefined) {
    return {
      handled: true,
      exitCode: 1,
      output: "Usage: estacoda knowledge memory deactivate <id>"
    };
  }

  const result = await inspector.deactivate(id);

  if (!result.ok) {
    return {
      handled: true,
      exitCode: 1,
      output: `Failed to deactivate: ${result.reason}`
    };
  }

  return {
    handled: true,
    exitCode: 0,
    output: `Deactivated ${result.record.id}. File removed: ${result.fileRemoved ? "yes" : "no (suppressed by renderer)"}`
  };
}

async function openMemoryInspector(options: CliOptions): Promise<MemoryInspector | undefined> {
  const homeDir = options.homeDir ?? process.env.HOME ?? homedir();
  const workspaceRoot = options.workspaceRoot;
  const userMemoryRoot = `${homeDir}/.estacoda/memory/default`;
  const projectMemoryRoot = join(workspaceRoot, ".estacoda", "memory");
  const promotionStorePath = join(userMemoryRoot, "promotions.json");

  const memoryStore = new MemoryStore();
  try {
    await memoryStore.loadFromDirectory(userMemoryRoot);
  } catch {
    // User memory may not exist yet
  }
  try {
    await memoryStore.loadFromDirectory(projectMemoryRoot);
  } catch {
    // Project memory may not exist yet
  }

  const promotionStore = new MemoryPromotionStore({ path: promotionStorePath });

  return new MemoryInspector({
    promotionStore,
    memoryStore
  });
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return flags.some((flag) => args.includes(flag));
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 || index + 1 >= args.length ? undefined : args[index + 1];
}

function parseKind(value: string | undefined): "user-preference" | "project-fact" | undefined {
  if (value === "preference") {
    return "user-preference";
  }
  if (value === "fact") {
    return "project-fact";
  }
  return undefined;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
