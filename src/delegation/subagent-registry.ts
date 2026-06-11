import type { DelegateRole } from "../contracts/delegation.js";

export type ActiveSubagentStatus =
  | "starting"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "timeout";

export type ActiveSubagentRecord = {
  subagentId: string;
  childSessionId: string;
  parentSessionId: string;
  batchId?: string;
  taskIndex?: number;
  depth: number;
  role: DelegateRole;
  goal: string;
  model: string;
  provider: string;
  startedAt: string;
  status: ActiveSubagentStatus;
  toolCount: number;
  lastActivityAt?: string;
  abortController: AbortController;
};

export type ActiveSubagentSnapshot = Omit<ActiveSubagentRecord, "abortController"> & {
  signalAborted: boolean;
};

export type OperatorSubagentSnapshot = {
  childSessionId: string;
  parentSessionId: string;
  role: DelegateRole;
  depth: number;
  provider: string;
  model: string;
  status: ActiveSubagentStatus;
  durationMs: number;
  cancellationState?: "aborted" | "cancelling" | "timeout";
  batchId?: string;
  taskIndex?: number;
};

export type OperatorSubagentStatus = {
  activeCount: number;
  subagents: OperatorSubagentSnapshot[];
  omittedCount: number;
};

export type RegisterSubagentInput = Omit<ActiveSubagentRecord, "goal" | "startedAt" | "status" | "lastActivityAt"> & {
  goal: string;
  startedAt?: string;
  status?: ActiveSubagentStatus;
  lastActivityAt?: string;
};

export type SubagentRegistryUpdate = Partial<Omit<ActiveSubagentRecord, "subagentId" | "abortController">>;

const MAX_GOAL_CHARS = 240;
const MAX_OPERATOR_FIELD_CHARS = 120;
const DEFAULT_OPERATOR_SUBAGENT_LIMIT = 10;
const SECRET_VALUE_RE = /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^"',\s]+/giu;
const TOKEN_PREFIX_RE = /\b(?:sk-ant-|sk-proj-|sk-|ghp_|github_pat_)[A-Za-z0-9_\-]+/gu;

export class SubagentRegistry {
  readonly #active = new Map<string, ActiveSubagentRecord>();
  #spawnPausedReason: string | undefined;

  registerSubagent(input: RegisterSubagentInput): ActiveSubagentSnapshot {
    const record: ActiveSubagentRecord = {
      ...input,
      goal: sanitizeGoal(input.goal),
      startedAt: input.startedAt ?? new Date().toISOString(),
      status: input.status ?? "starting",
      lastActivityAt: input.lastActivityAt
    };
    this.#active.set(record.subagentId, record);
    return snapshot(record);
  }

  updateSubagent(id: string, patch: SubagentRegistryUpdate): ActiveSubagentSnapshot | undefined {
    const record = this.#active.get(id);
    if (record === undefined) {
      return undefined;
    }
    if (patch.goal !== undefined) {
      record.goal = sanitizeGoal(patch.goal);
    }
    if (patch.childSessionId !== undefined) {
      record.childSessionId = patch.childSessionId;
    }
    if (patch.parentSessionId !== undefined) {
      record.parentSessionId = patch.parentSessionId;
    }
    if (patch.batchId !== undefined) {
      record.batchId = patch.batchId;
    }
    if (patch.taskIndex !== undefined) {
      record.taskIndex = patch.taskIndex;
    }
    if (patch.depth !== undefined) {
      record.depth = patch.depth;
    }
    if (patch.role !== undefined) {
      record.role = patch.role;
    }
    if (patch.model !== undefined) {
      record.model = patch.model;
    }
    if (patch.provider !== undefined) {
      record.provider = patch.provider;
    }
    if (patch.startedAt !== undefined) {
      record.startedAt = patch.startedAt;
    }
    if (patch.status !== undefined) {
      record.status = patch.status;
    }
    if (patch.toolCount !== undefined) {
      record.toolCount = patch.toolCount;
    }
    if (patch.lastActivityAt !== undefined) {
      record.lastActivityAt = patch.lastActivityAt;
    }
    return snapshot(record);
  }

  unregisterSubagent(id: string): boolean {
    return this.#active.delete(id);
  }

  listActiveSubagents(parentSessionId?: string): ActiveSubagentSnapshot[] {
    const records = [...this.#active.values()]
      .filter((record) => parentSessionId === undefined || record.parentSessionId === parentSessionId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.subagentId.localeCompare(b.subagentId));
    return records.map(snapshot);
  }

  operatorStatus(input: {
    parentSessionId?: string;
    now?: Date | string | number;
    limit?: number;
  } = {}): OperatorSubagentStatus {
    const limit = normalizeLimit(input.limit);
    const nowMs = normalizeNow(input.now);
    const records = [...this.#active.values()]
      .filter((record) => input.parentSessionId === undefined || record.parentSessionId === input.parentSessionId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.subagentId.localeCompare(b.subagentId));
    const subagents = records.slice(0, limit).map((record) => operatorSnapshot(record, nowMs));
    return {
      activeCount: records.length,
      subagents,
      omittedCount: Math.max(0, records.length - subagents.length)
    };
  }

  hasActiveSubagents(parentSessionId: string): boolean {
    for (const record of this.#active.values()) {
      if (record.parentSessionId === parentSessionId) {
        return true;
      }
    }
    return false;
  }

  interruptSubagent(id: string, reason: string): boolean {
    const record = this.#active.get(id);
    if (record === undefined) {
      return false;
    }
    record.status = "cancelling";
    record.lastActivityAt = new Date().toISOString();
    abort(record.abortController, boundedReason(reason));
    return true;
  }

  interruptChildrenForParent(parentSessionId: string, reason: string): number {
    let interrupted = 0;
    for (const record of this.#active.values()) {
      if (record.parentSessionId === parentSessionId) {
        record.status = "cancelling";
        record.lastActivityAt = new Date().toISOString();
        abort(record.abortController, boundedReason(reason));
        interrupted += 1;
      }
    }
    return interrupted;
  }

  pauseSpawns(reason: string): void {
    this.#spawnPausedReason = boundedReason(reason);
  }

  resumeSpawns(): void {
    this.#spawnPausedReason = undefined;
  }

  isSpawnPaused(): boolean {
    return this.#spawnPausedReason !== undefined;
  }

  spawnPausedReason(): string | undefined {
    return this.#spawnPausedReason;
  }
}

function snapshot(record: ActiveSubagentRecord): ActiveSubagentSnapshot {
  const { abortController: _abortController, ...rest } = record;
  return {
    ...rest,
    signalAborted: record.abortController.signal.aborted
  };
}

function operatorSnapshot(record: ActiveSubagentRecord, nowMs: number): OperatorSubagentSnapshot {
  const startedAtMs = Date.parse(record.startedAt);
  const durationMs = Number.isFinite(startedAtMs)
    ? Math.max(0, nowMs - startedAtMs)
    : 0;
  return {
    childSessionId: boundedOperatorField(record.childSessionId),
    parentSessionId: boundedOperatorField(record.parentSessionId),
    role: record.role,
    depth: record.depth,
    provider: boundedOperatorField(record.provider),
    model: boundedOperatorField(record.model),
    status: record.status,
    durationMs,
    cancellationState: cancellationState(record),
    batchId: record.batchId === undefined ? undefined : boundedOperatorField(record.batchId),
    taskIndex: record.taskIndex
  };
}

function cancellationState(record: ActiveSubagentRecord): OperatorSubagentSnapshot["cancellationState"] {
  if (record.status === "timeout") {
    return "timeout";
  }
  if (record.status === "cancelling") {
    return "cancelling";
  }
  if (record.abortController.signal.aborted) {
    return "aborted";
  }
  return undefined;
}

function sanitizeGoal(goal: string): string {
  return boundedReason(goal
    .replace(SECRET_VALUE_RE, "[REDACTED]")
    .replace(TOKEN_PREFIX_RE, "[REDACTED]")
    .replace(/\s+/gu, " ")
    .trim());
}

function boundedReason(reason: string): string {
  const normalized = reason.replace(/[\r\n\t]+/gu, " ").trim();
  if (normalized.length <= MAX_GOAL_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_GOAL_CHARS - 3)}...`;
}

function boundedOperatorField(value: string): string {
  const normalized = value.replace(/[\r\n\t]+/gu, " ").trim();
  if (normalized.length <= MAX_OPERATOR_FIELD_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_OPERATOR_FIELD_CHARS - 3)}...`;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_OPERATOR_SUBAGENT_LIMIT;
  }
  return Math.max(0, Math.floor(limit));
}

function normalizeNow(now: Date | string | number | undefined): number {
  if (now instanceof Date) {
    return now.getTime();
  }
  if (typeof now === "string") {
    const parsed = Date.parse(now);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  if (typeof now === "number" && Number.isFinite(now)) {
    return now;
  }
  return Date.now();
}

function abort(controller: AbortController, reason: string): void {
  if (controller.signal.aborted) {
    return;
  }
  controller.abort(reason);
}
