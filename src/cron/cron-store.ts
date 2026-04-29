import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertCronPromptSafe } from "./cron-safety.js";

export type CronJobStatus = "active" | "paused" | "completed";
export type CronDelivery = "local" | "origin" | string;
export type CronScheduleKind = "once" | "interval" | "cron";

export type CronJob = {
  id: string;
  name: string;
  prompt: string;
  script?: string;
  scriptArgs?: string[];
  scriptTimeoutMs?: number;
  schedule: string;
  scheduleKind: CronScheduleKind;
  skills: string[];
  delivery: CronDelivery;
  status: CronJobStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: "succeeded" | "failed";
  runCount: number;
  repeat?: number;
  runRequested?: boolean;
  origin?: {
    channel?: string;
    chatId?: string;
    userId?: string;
    threadId?: string;
  };
};

export type CronStoreSnapshot = {
  jobs: CronJob[];
};

export class CronStore {
  readonly path: string;
  readonly outputRoot: string;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: {
    path?: string;
    outputRoot?: string;
    homeDir?: string;
    now?: () => Date;
    id?: () => string;
  } = {}) {
    const home = options.homeDir ?? process.env.HOME ?? process.cwd();
    this.path = options.path ?? join(home, ".estacoda", "cron", "jobs.json");
    this.outputRoot = options.outputRoot ?? join(home, ".estacoda", "cron", "output");
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? (() => randomUUID());
  }

  async list(): Promise<CronJob[]> {
    return (await this.#load()).jobs;
  }

  async get(id: string): Promise<CronJob | undefined> {
    return (await this.list()).find((job) => job.id === id);
  }

  async create(input: {
    prompt: string;
    schedule: string;
    name?: string;
    script?: string;
    scriptArgs?: string[];
    scriptTimeoutMs?: number;
    skills?: string[];
    delivery?: CronDelivery;
    repeat?: number;
    origin?: CronJob["origin"];
  }): Promise<CronJob> {
    assertCronPromptSafe(input.prompt);
    const now = this.#now().toISOString();
    const parsed = parseCronSchedule(input.schedule, this.#now());
    const job: CronJob = {
      id: `cron-${this.#id()}`,
      name: input.name ?? summarizePrompt(input.prompt),
      prompt: input.prompt,
      script: input.script,
      scriptArgs: input.scriptArgs,
      scriptTimeoutMs: input.scriptTimeoutMs,
      schedule: input.schedule,
      scheduleKind: parsed.kind,
      skills: input.skills ?? [],
      delivery: input.delivery ?? "local",
      status: "active",
      createdAt: now,
      updatedAt: now,
      nextRunAt: parsed.nextRunAt?.toISOString(),
      runCount: 0,
      repeat: input.repeat,
      origin: input.origin
    };
    await this.#mutate((jobs) => [...jobs, job]);
    return structuredClone(job);
  }

  async update(id: string, patch: Partial<Pick<CronJob, "name" | "prompt" | "script" | "scriptArgs" | "scriptTimeoutMs" | "schedule" | "skills" | "delivery" | "repeat">>): Promise<CronJob | undefined> {
    if (patch.prompt !== undefined) {
      assertCronPromptSafe(patch.prompt);
    }
    let updated: CronJob | undefined;
    await this.#mutate((jobs) => jobs.map((job) => {
      if (job.id !== id) return job;
      const schedule = patch.schedule ?? job.schedule;
      const parsed = patch.schedule === undefined ? undefined : parseCronSchedule(schedule, this.#now());
      updated = {
        ...job,
        ...patch,
        schedule,
        scheduleKind: parsed?.kind ?? job.scheduleKind,
        nextRunAt: parsed?.nextRunAt?.toISOString() ?? job.nextRunAt,
        updatedAt: this.#now().toISOString()
      };
      return updated;
    }));
    return updated === undefined ? undefined : structuredClone(updated);
  }

  async pause(id: string): Promise<CronJob | undefined> {
    return this.#setStatus(id, "paused");
  }

  async resume(id: string): Promise<CronJob | undefined> {
    const parsedJob = await this.get(id);
    if (parsedJob === undefined) return undefined;
    const parsed = parseCronSchedule(parsedJob.schedule, this.#now());
    let updated: CronJob | undefined;
    await this.#mutate((jobs) => jobs.map((job) => {
      if (job.id !== id) return job;
      updated = {
        ...job,
        status: "active",
        nextRunAt: parsed.nextRunAt?.toISOString(),
        updatedAt: this.#now().toISOString()
      };
      return updated;
    }));
    return updated === undefined ? undefined : structuredClone(updated);
  }

  async requestRun(id: string): Promise<CronJob | undefined> {
    let updated: CronJob | undefined;
    await this.#mutate((jobs) => jobs.map((job) => {
      if (job.id !== id) return job;
      updated = {
        ...job,
        status: job.status === "completed" ? "active" : job.status,
        runRequested: true,
        updatedAt: this.#now().toISOString()
      };
      return updated;
    }));
    return updated === undefined ? undefined : structuredClone(updated);
  }

  async remove(id: string): Promise<boolean> {
    let removed = false;
    await this.#mutate((jobs) => {
      const next = jobs.filter((job) => job.id !== id);
      removed = next.length !== jobs.length;
      return next;
    });
    return removed;
  }

  async markRunResult(id: string, input: { ok: boolean; output: string }): Promise<CronJob | undefined> {
    const now = this.#now();
    let updated: CronJob | undefined;
    await this.writeOutput(id, now, input.output);
    await this.#mutate((jobs) => jobs.map((job) => {
      if (job.id !== id) return job;
      const runCount = job.runCount + 1;
      const exhausted = job.repeat !== undefined && runCount >= job.repeat;
      const next = exhausted || job.scheduleKind === "once"
        ? undefined
        : computeNextRun(job.schedule, now)?.toISOString();
      updated = {
        ...job,
        runCount,
        runRequested: false,
        lastRunAt: now.toISOString(),
        lastStatus: input.ok ? "succeeded" : "failed",
        status: exhausted || job.scheduleKind === "once" ? "completed" : job.status,
        nextRunAt: next,
        updatedAt: now.toISOString()
      };
      return updated;
    }));
    return updated === undefined ? undefined : structuredClone(updated);
  }

  async due(now = this.#now()): Promise<CronJob[]> {
    return (await this.list()).filter((job) =>
      job.status === "active" &&
      (job.runRequested === true || (job.nextRunAt !== undefined && new Date(job.nextRunAt).getTime() <= now.getTime()))
    );
  }

  async writeOutput(jobId: string, timestamp: Date, output: string): Promise<string> {
    const safeTimestamp = timestamp.toISOString().replace(/[:.]/gu, "-");
    const path = join(this.outputRoot, jobId, `${safeTimestamp}.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, output, "utf8");
    return path;
  }

  async #setStatus(id: string, status: CronJobStatus): Promise<CronJob | undefined> {
    let updated: CronJob | undefined;
    await this.#mutate((jobs) => jobs.map((job) => {
      if (job.id !== id) return job;
      updated = {
        ...job,
        status,
        updatedAt: this.#now().toISOString()
      };
      return updated;
    }));
    return updated === undefined ? undefined : structuredClone(updated);
  }

  async #load(): Promise<CronStoreSnapshot> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<CronStoreSnapshot>;
      return {
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs.map(normalizeJob) : []
      };
    } catch {
      return { jobs: [] };
    }
  }

  async #save(snapshot: CronStoreSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temp, this.path);
  }

  async #mutate(fn: (jobs: CronJob[]) => CronJob[]): Promise<void> {
    const snapshot = await this.#load();
    await this.#save({
      jobs: fn(snapshot.jobs).map((job) => structuredClone(job))
    });
  }
}

export function parseCronSchedule(value: string, now = new Date()): { kind: CronScheduleKind; nextRunAt?: Date } {
  const nextRunAt = computeNextRun(value, now);
  if (nextRunAt === undefined) {
    throw new Error(`Unsupported cron schedule: ${value}`);
  }
  return {
    kind: scheduleKind(value),
    nextRunAt
  };
}

export function computeNextRun(value: string, now = new Date()): Date | undefined {
  const trimmed = value.trim();
  const every = /^every\s+(\d+)(m|h|d)$/iu.exec(trimmed);
  if (every !== null) {
    return new Date(now.getTime() + durationMs(Number(every[1]), every[2]));
  }

  const relative = /^(\d+)(m|h|d)$/iu.exec(trimmed);
  if (relative !== null) {
    return new Date(now.getTime() + durationMs(Number(relative[1]), relative[2]));
  }

  if (/^(\S+\s+){4}\S+$/u.test(trimmed)) {
    return nextCronExpressionRun(trimmed, now);
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp);
  }

  return undefined;
}

function scheduleKind(value: string): CronScheduleKind {
  const trimmed = value.trim();
  if (/^every\s+\d+(m|h|d)$/iu.test(trimmed)) return "interval";
  if (/^(\S+\s+){4}\S+$/u.test(trimmed)) return "cron";
  return "once";
}

function durationMs(amount: number, unit: string): number {
  const minute = 60_000;
  if (unit.toLowerCase() === "m") return amount * minute;
  if (unit.toLowerCase() === "h") return amount * 60 * minute;
  return amount * 24 * 60 * minute;
}

function nextCronExpressionRun(expression: string, now: Date): Date | undefined {
  const fields = expression.trim().split(/\s+/u);
  const start = new Date(now.getTime() + 60_000);
  start.setUTCSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (
      cronFieldMatches(fields[0]!, candidate.getUTCMinutes(), 0, 59) &&
      cronFieldMatches(fields[1]!, candidate.getUTCHours(), 0, 23) &&
      cronFieldMatches(fields[2]!, candidate.getUTCDate(), 1, 31) &&
      cronFieldMatches(fields[3]!, candidate.getUTCMonth() + 1, 1, 12) &&
      cronFieldMatches(fields[4]!, candidate.getUTCDay(), 0, 7)
    ) {
      return candidate;
    }
  }
  return undefined;
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    const step = /^\*\/(\d+)$/u.exec(part);
    if (step !== null) return value % Number(step[1]) === 0;
    const range = /^(\d+)-(\d+)$/u.exec(part);
    if (range !== null) return value >= Number(range[1]) && value <= Number(range[2]);
    const numeric = Number(part);
    if (!Number.isInteger(numeric)) return false;
    const normalized = max === 7 && numeric === 7 ? 0 : numeric;
    return normalized >= min && normalized <= max && normalized === value;
  });
}

function normalizeJob(job: CronJob): CronJob {
  return {
    ...job,
    scriptArgs: Array.isArray(job.scriptArgs) ? job.scriptArgs : undefined,
    skills: Array.isArray(job.skills) ? job.skills : [],
    runCount: Number.isFinite(job.runCount) ? job.runCount : 0,
    status: job.status ?? "active",
    delivery: job.delivery ?? "local"
  };
}

function summarizePrompt(prompt: string): string {
  const single = prompt.trim().replace(/\s+/gu, " ");
  return single.length <= 48 ? single : `${single.slice(0, 45)}...`;
}
