import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionDB } from "../contracts/session.js";
import type { LoadedSkill, SkillDefinition, SkillSourceKind } from "../contracts/skill.js";
import type { ToolRiskClass, ToolsetName } from "../contracts/tool.js";
import type { ToolExecutionRecord } from "../tools/tool-executor.js";
import { parseSkillFile, hydrateSkillResources } from "./skill-loader.js";
import type { SkillRegistry } from "./skill-registry.js";
import { buildSkillFileContent, slugifySkillName } from "./skill-tools.js";

export type SkillAutonomy = "none" | "suggest" | "proactive" | "autonomous";

export type SkillLearningRecord = {
  key: string;
  name: string;
  content: string;
  occurrences: number;
  sourceSessionIds: string[];
  tools: string[];
  requiredToolsets: ToolsetName[];
  bounded: boolean;
  status: "observed" | "candidate" | "created";
  createdSkillName?: string;
  createdSkillPath?: string;
  updatedAt: string;
};

type SkillLearningFile = {
  version: 1;
  records: SkillLearningRecord[];
};

export type SkillLearningObservation =
  | {
      action: "observed" | "candidate";
      record: SkillLearningRecord;
    }
  | {
      action: "created";
      record: SkillLearningRecord;
      skillName: string;
      skillPath: string;
    };

export class SkillLearningManager {
  readonly #autonomy: SkillAutonomy;
  readonly #registry: SkillRegistry;
  readonly #projectSkillsRoot: string;
  readonly #store: SkillLearningStore;
  readonly #sessionDb: SessionDB;

  constructor(options: {
    autonomy: SkillAutonomy;
    registry: SkillRegistry;
    projectSkillsRoot: string;
    storePath: string;
    sessionDb: SessionDB;
  }) {
    this.#autonomy = options.autonomy;
    this.#registry = options.registry;
    this.#projectSkillsRoot = options.projectSkillsRoot;
    this.#store = new SkillLearningStore({
      path: options.storePath
    });
    this.#sessionDb = options.sessionDb;
  }

  async observeTurn(input: {
    profileId: string;
    sessionId: string;
    userText: string;
    selectedSkill: LoadedSkill | SkillDefinition | undefined;
    toolExecutions: ToolExecutionRecord[];
  }): Promise<SkillLearningObservation | undefined> {
    if (this.#autonomy === "none") {
      return undefined;
    }

    if (input.selectedSkill !== undefined) {
      return undefined;
    }

    const workflow = detectWorkflow({
      userText: input.userText,
      toolExecutions: input.toolExecutions
    });
    if (workflow === undefined) {
      return undefined;
    }

    const record = await this.#store.observe({
      key: workflow.key,
      name: workflow.name,
      content: workflow.content,
      sessionId: input.sessionId,
      tools: workflow.tools,
      requiredToolsets: workflow.requiredToolsets,
      bounded: workflow.bounded
    });
    const threshold = this.#autonomy === "autonomous" ? 1 : 2;

    if (record.status === "created") {
      return undefined;
    }

    if (workflow.bounded && shouldCreateSkill(this.#autonomy, record.occurrences, threshold)) {
      const created = await this.#createProjectSkill(record);
      const updated = await this.#store.markCreated(record.key, {
        createdSkillName: created.name,
        createdSkillPath: created.path
      });
      await this.#sessionDb.appendEvent(input.sessionId, {
        kind: "skill-learned",
        action: "created",
        record: updated
      });
      return {
        action: "created",
        record: updated,
        skillName: created.name,
        skillPath: created.path
      };
    }

    if (record.occurrences >= 2 && record.status !== "candidate") {
      const candidate = await this.#store.markCandidate(record.key);
      await this.#sessionDb.appendEvent(input.sessionId, {
        kind: "skill-learned",
        action: "candidate",
        record: candidate
      });
      return {
        action: "candidate",
        record: candidate
      };
    }

    await this.#sessionDb.appendEvent(input.sessionId, {
      kind: "skill-learned",
      action: "observed",
      record
    });
    return {
      action: "observed",
      record
    };
  }

  async inspect(): Promise<SkillLearningRecord[]> {
    return this.#store.list();
  }

  async #createProjectSkill(record: SkillLearningRecord): Promise<{ name: string; path: string }> {
    const name = ensureUniqueSkillName(this.#registry, record.name);
    const skillDir = join(this.#projectSkillsRoot, slugifySkillName(name));
    const skillPath = join(skillDir, "SKILL.md");
    const description = record.content.replace(/^Reusable workflow:\s*/u, "");
    const instructions = [
      "Use this skill for this repeated local workflow.",
      "",
      "Observed successful pattern:",
      ...record.tools.map((tool, index) => `${index + 1}. Run \`${tool}\`.`),
      "",
      "Execution notes:",
      "- Keep the workflow local to this workspace unless the user explicitly asks otherwise.",
      "- Verify the result before replying.",
      "- Adapt the exact commands or file paths if the workspace has changed.",
      "",
      `Learned from repeated successful sessions (${record.occurrences} observations).`
    ].join("\n");
    const content = buildSkillFileContent({
      name,
      description,
      category: "workflow",
      whenToUse: [description],
      requiredToolsets: record.requiredToolsets,
      instructions
    });

    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, content, "utf8");
    const loaded = await hydrateSkillResources(parseSkillFile(skillPath, content, {
      sourceKind: "local" satisfies SkillSourceKind,
      sourceRoot: this.#projectSkillsRoot
    }));
    this.#registry.register(loaded);

    return {
      name: loaded.name,
      path: skillPath
    };
  }
}

class SkillLearningStore {
  readonly #path: string;
  readonly #now: () => Date;
  readonly #records = new Map<string, SkillLearningRecord>();
  #loaded = false;

  constructor(options: { path: string; now?: () => Date }) {
    this.#path = options.path;
    this.#now = options.now ?? (() => new Date());
  }

  async observe(input: {
    key: string;
    name: string;
    content: string;
    sessionId: string;
    tools: string[];
    requiredToolsets: ToolsetName[];
    bounded: boolean;
  }): Promise<SkillLearningRecord> {
    await this.#ensureLoaded();
    const now = this.#now().toISOString();
    const existing = this.#records.get(input.key);
    const sourceSessionIds = existing === undefined
      ? [input.sessionId]
      : unique([...existing.sourceSessionIds, input.sessionId]);
    const record: SkillLearningRecord = {
      key: input.key,
      name: existing?.name ?? input.name,
      content: existing?.content ?? input.content,
      occurrences: sourceSessionIds.length,
      sourceSessionIds,
      tools: existing === undefined ? input.tools : mergeOrdered(existing.tools, input.tools),
      requiredToolsets: existing === undefined ? input.requiredToolsets : mergeOrdered(existing.requiredToolsets, input.requiredToolsets),
      bounded: existing?.bounded === false ? false : input.bounded,
      status: existing?.status ?? "observed",
      createdSkillName: existing?.createdSkillName,
      createdSkillPath: existing?.createdSkillPath,
      updatedAt: now
    };
    this.#records.set(input.key, record);
    await this.#flush();
    return record;
  }

  async markCandidate(key: string): Promise<SkillLearningRecord> {
    await this.#ensureLoaded();
    const existing = this.#records.get(key);
    if (existing === undefined) {
      throw new Error(`Workflow candidate not found: ${key}`);
    }
    const updated: SkillLearningRecord = {
      ...existing,
      status: "candidate",
      updatedAt: this.#now().toISOString()
    };
    this.#records.set(key, updated);
    await this.#flush();
    return updated;
  }

  async markCreated(key: string, input: { createdSkillName: string; createdSkillPath: string }): Promise<SkillLearningRecord> {
    await this.#ensureLoaded();
    const existing = this.#records.get(key);
    if (existing === undefined) {
      throw new Error(`Workflow skill record not found: ${key}`);
    }
    const updated: SkillLearningRecord = {
      ...existing,
      status: "created",
      createdSkillName: input.createdSkillName,
      createdSkillPath: input.createdSkillPath,
      updatedAt: this.#now().toISOString()
    };
    this.#records.set(key, updated);
    await this.#flush();
    return updated;
  }

  async list(): Promise<SkillLearningRecord[]> {
    await this.#ensureLoaded();
    return [...this.#records.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) {
      return;
    }
    this.#loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as Partial<SkillLearningFile>;
      for (const record of Array.isArray(parsed.records) ? parsed.records : []) {
        if (typeof record?.key !== "string") {
          continue;
        }
        this.#records.set(record.key, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async #flush(): Promise<void> {
    const file: SkillLearningFile = {
      version: 1,
      records: [...this.#records.values()].sort((left, right) => left.key.localeCompare(right.key))
    };
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function detectWorkflow(input: {
  userText: string;
  toolExecutions: ToolExecutionRecord[];
}): {
  key: string;
  name: string;
  content: string;
  tools: string[];
  requiredToolsets: ToolsetName[];
  bounded: boolean;
} | undefined {
  const successful = input.toolExecutions.filter((execution) => execution.result?.ok === true);
  if (successful.length < 2) {
    return undefined;
  }

  const tools = mergeOrdered([], successful.map((execution) => execution.tool.name));
  if (tools.length < 2) {
    return undefined;
  }

  const normalizedPrompt = normalizePrompt(input.userText);
  if (normalizedPrompt.length === 0) {
    return undefined;
  }

  const bounded = successful.every((execution) => isBoundedRisk(execution.riskClass));
  const requiredToolsets = mergeOrdered(
    [],
    successful.flatMap((execution) => execution.tool.toolsets)
  );
  const label = humanizePrompt(input.userText);

  return {
    key: `${normalizedPrompt}::${tools.join(">")}`,
    name: `${summarizePrompt(input.userText)} workflow`,
    content: `Reusable workflow: ${label}`,
    tools,
    requiredToolsets,
    bounded
  };
}

function shouldCreateSkill(autonomy: SkillAutonomy, occurrences: number, threshold: number): boolean {
  if (autonomy === "suggest" || autonomy === "none") {
    return false;
  }

  return occurrences >= threshold;
}

function ensureUniqueSkillName(registry: SkillRegistry, proposed: string): string {
  if (registry.get(proposed) === undefined) {
    return proposed;
  }

  for (let index = 2; index < 100; index++) {
    const candidate = `${proposed} ${index}`;
    if (registry.get(candidate) === undefined) {
      return candidate;
    }
  }

  return `${proposed} ${Date.now()}`;
}

function mergeOrdered<T extends string>(left: T[], right: T[]): T[] {
  return [...new Set([...left, ...right])];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizePrompt(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'“”‘’]/gu, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/gu, " ")
    .trim();
}

function summarizePrompt(value: string): string {
  const normalized = normalizePrompt(value)
    .split(/\s+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 5)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  if (normalized.length === 0) {
    return "Generated";
  }

  return normalized.join(" ");
}

function humanizePrompt(value: string): string {
  const trimmed = value.trim().replace(/\s+/gu, " ");
  if (trimmed.length === 0) {
    return "repeated local task";
  }
  return trimmed.replace(/[.?!]+$/u, "");
}

function isBoundedRisk(riskClass: ToolRiskClass): boolean {
  return (
    riskClass === "read-only-local" ||
    riskClass === "workspace-write" ||
    riskClass === "read-only-network"
  );
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "this",
  "with",
  "from",
  "into",
  "please",
  "tell",
  "what",
  "about",
  "exactly",
  "there",
  "give",
  "make"
]);
