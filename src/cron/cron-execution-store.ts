import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";

export type CronExecutionStatus = "success" | "failed" | "cancelled" | "skipped" | "running";

export type CronDeliveryResult = {
  success: boolean;
  error?: string;
};

export type CronExecutionRecord = {
  id: string;
  jobId: string;
  sessionId?: string;
  trajectoryId?: string;
  scheduledAt?: string;
  startedAt: string;
  completedAt?: string;
  status: CronExecutionStatus;
  outputSummary?: string;
  deliveryResults: Map<string, CronDeliveryResult>;
  failureClass?: string;
  failureMessage?: string;
};

export type CronExecutionStoreOptions = {
  db: Database;
  now?: () => Date;
  id?: () => string;
};

type ExecutionRow = {
  id: string;
  job_id: string;
  session_id: string | null;
  trajectory_id: string | null;
  scheduled_at: string | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  output_summary: string | null;
  delivery_results_json: string | null;
  failure_class: string | null;
  failure_message: string | null;
  created_at: string;
};

export class CronExecutionStore {
  readonly #db: Database;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: CronExecutionStoreOptions | Database) {
    const opts = options instanceof Database ? { db: options } : options;
    this.#db = opts.db;
    this.#now = opts.now ?? (() => new Date());
    this.#id = opts.id ?? (() => randomUUID());
  }

  async create(input: {
    jobId: string;
    scheduledAt?: Date;
  }): Promise<CronExecutionRecord> {
    const now = this.#now();
    const id = this.#id();
    const record: CronExecutionRecord = {
      id,
      jobId: input.jobId,
      scheduledAt: input.scheduledAt?.toISOString(),
      startedAt: now.toISOString(),
      status: "running",
      deliveryResults: new Map()
    };

    this.#db
      .query(
        `insert into cron_executions (
          id, job_id, session_id, trajectory_id, scheduled_at,
          started_at, completed_at, status, output_summary,
          delivery_results_json, failure_class, failure_message, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.jobId,
        null,
        null,
        record.scheduledAt ?? null,
        record.startedAt,
        null,
        record.status,
        null,
        null,
        null,
        null,
        record.startedAt
      );

    return record;
  }

  async complete(
    id: string,
    input: {
      status: Exclude<CronExecutionStatus, "running">;
      outputSummary?: string;
      deliveryResults?: Map<string, CronDeliveryResult>;
      failureClass?: string;
      failureMessage?: string;
      sessionId?: string;
      trajectoryId?: string;
    }
  ): Promise<void> {
    const completedAt = this.#now().toISOString();
    const deliveryJson = input.deliveryResults !== undefined && input.deliveryResults.size > 0
      ? JSON.stringify(Object.fromEntries(input.deliveryResults))
      : null;

    this.#db
      .query(
        `update cron_executions set
          status = ?,
          completed_at = ?,
          output_summary = ?,
          delivery_results_json = ?,
          failure_class = ?,
          failure_message = ?,
          session_id = ?,
          trajectory_id = ?
        where id = ?`
      )
      .run(
        input.status,
        completedAt,
        input.outputSummary ?? null,
        deliveryJson,
        input.failureClass ?? null,
        input.failureMessage ?? null,
        input.sessionId ?? null,
        input.trajectoryId ?? null,
        id
      );
  }

  async get(id: string): Promise<CronExecutionRecord | undefined> {
    const row = this.#db.query<ExecutionRow>("select * from cron_executions where id = ?").get(id);
    return row === null ? undefined : rowToRecord(row);
  }

  async list(options: {
    jobId?: string;
    status?: CronExecutionStatus;
    limit?: number;
    after?: string;
  } = {}): Promise<CronExecutionRecord[]> {
    const limit = options.limit ?? 50;

    let rows: ExecutionRow[];
    if (options.jobId !== undefined && options.status !== undefined) {
      rows = this.#db
        .query<ExecutionRow>(
          "select * from cron_executions where job_id = ? and status = ? order by started_at desc limit ?"
        )
        .all(options.jobId, options.status, limit);
    } else if (options.jobId !== undefined) {
      rows = this.#db
        .query<ExecutionRow>(
          "select * from cron_executions where job_id = ? order by started_at desc limit ?"
        )
        .all(options.jobId, limit);
    } else if (options.status !== undefined) {
      rows = this.#db
        .query<ExecutionRow>(
          "select * from cron_executions where status = ? order by started_at desc limit ?"
        )
        .all(options.status, limit);
    } else {
      rows = this.#db
        .query<ExecutionRow>(
          "select * from cron_executions order by started_at desc limit ?"
        )
        .all(limit);
    }

    return rows.map(rowToRecord);
  }

  async count(options: { jobId?: string; status?: CronExecutionStatus } = {}): Promise<number> {
    let row: { count: number } | null;
    if (options.jobId !== undefined && options.status !== undefined) {
      row = this.#db
        .query<{ count: number }>("select count(*) as count from cron_executions where job_id = ? and status = ?")
        .get(options.jobId, options.status);
    } else if (options.jobId !== undefined) {
      row = this.#db
        .query<{ count: number }>("select count(*) as count from cron_executions where job_id = ?")
        .get(options.jobId);
    } else if (options.status !== undefined) {
      row = this.#db
        .query<{ count: number }>("select count(*) as count from cron_executions where status = ?")
        .get(options.status);
    } else {
      row = this.#db
        .query<{ count: number }>("select count(*) as count from cron_executions")
        .get();
    }
    return row?.count ?? 0;
  }

  async recentFailures(limit = 10): Promise<CronExecutionRecord[]> {
    const rows = this.#db
      .query<ExecutionRow>(
        "select * from cron_executions where status = 'failed' order by started_at desc limit ?"
      )
      .all(limit);
    return rows.map(rowToRecord);
  }
}

function rowToRecord(row: ExecutionRow): CronExecutionRecord {
  const deliveryResults: Map<string, CronDeliveryResult> = new Map();
  if (row.delivery_results_json !== null) {
    try {
      const parsed = JSON.parse(row.delivery_results_json) as Record<string, CronDeliveryResult>;
      for (const [key, value] of Object.entries(parsed)) {
        deliveryResults.set(key, value);
      }
    } catch {
      // ignore parse errors
    }
  }

  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id ?? undefined,
    trajectoryId: row.trajectory_id ?? undefined,
    scheduledAt: row.scheduled_at ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    status: row.status as CronExecutionStatus,
    outputSummary: row.output_summary ?? undefined,
    deliveryResults,
    failureClass: row.failure_class ?? undefined,
    failureMessage: row.failure_message ?? undefined
  };
}
