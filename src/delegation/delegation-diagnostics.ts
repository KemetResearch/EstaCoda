import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DelegateRole, DelegationConfig } from "../contracts/delegation.js";
import { redactSensitiveText } from "../utils/redaction.js";

export type DelegationDiagnosticReason = "timeout" | "stale-heartbeat";

export type DelegationDiagnosticInput = {
  diagnosticsRoot?: string;
  config: DelegationConfig["diagnostics"];
  reason: DelegationDiagnosticReason;
  parentSessionId: string;
  childSessionId: string;
  task: string;
  prompt?: string;
  role: DelegateRole;
  depth: number;
  effectiveTools: string[];
  provider: string;
  model: string;
  lastActivityAt?: string;
  lastSafeEventSummaries: string[];
  timeoutDurationMs?: number;
  taskIndex?: number;
  batchId?: string;
  now?: () => Date;
};

export type DelegationDiagnosticResult = {
  path?: string;
  taskHash: string;
  taskPreview: string;
};

const MAX_PREVIEW_CHARS = 160;
const MAX_TOOL_NAMES = 80;
const MAX_EVENT_SUMMARIES = 12;
const MAX_EVENT_SUMMARY_CHARS = 160;
const MAX_PROMPT_PREVIEW_CHARS = 500;

export async function writeDelegationDiagnostic(input: DelegationDiagnosticInput): Promise<DelegationDiagnosticResult> {
  const taskHash = hashTask(input.task);
  const taskPreview = preview(input.task, MAX_PREVIEW_CHARS);
  if (input.config.enabled !== true || input.diagnosticsRoot === undefined) {
    return { taskHash, taskPreview };
  }

  const now = input.now?.() ?? new Date();
  const directory = join(input.diagnosticsRoot, "delegation");
  await mkdir(directory, { recursive: true });
  const filename = `${safeFilePart(now.toISOString())}-${safeFilePart(input.childSessionId)}-${input.reason}.json`;
  const path = join(directory, filename);
  const payload = {
    reason: input.reason,
    parentSessionId: input.parentSessionId,
    childSessionId: input.childSessionId,
    taskHash,
    taskPreview,
    role: input.role,
    depth: input.depth,
    taskIndex: input.taskIndex,
    batchId: input.batchId,
    effectiveTools: input.effectiveTools.slice(0, MAX_TOOL_NAMES),
    provider: preview(input.provider, 80),
    model: preview(input.model, 120),
    lastActivityAt: input.lastActivityAt,
    lastSafeEventSummaries: input.lastSafeEventSummaries
      .slice(-MAX_EVENT_SUMMARIES)
      .map((summary) => preview(summary, MAX_EVENT_SUMMARY_CHARS)),
    timeoutDurationMs: input.timeoutDurationMs,
    promptPreview: input.config.includePromptPreview === true && input.prompt !== undefined
      ? preview(input.prompt, MAX_PROMPT_PREVIEW_CHARS)
      : undefined
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { path, taskHash, taskPreview };
}

export function hashTask(task: string): string {
  return createHash("sha256").update(task).digest("hex").slice(0, 16);
}

export function preview(value: string, maxChars: number): string {
  const redacted = redactSensitiveText(value).replace(/\s+/gu, " ").trim();
  if (redacted.length <= maxChars) {
    return redacted;
  }
  return `${redacted.slice(0, Math.max(0, maxChars - 3))}...`;
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/gu, "-").slice(0, 120);
}
