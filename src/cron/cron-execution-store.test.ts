import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronExecutionStore } from "./cron-execution-store.js";
import type { SQLiteDatabase } from "../storage/sqlite.js";
import { openDefaultSQLiteDatabase } from "../storage/factory.js";

describe("CronExecutionStore", () => {
  let tmpDir: string;
  let db: SQLiteDatabase;
  let store: CronExecutionStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-cron-test-"));
    db = openDefaultSQLiteDatabase({ path: join(tmpDir, "test.db") });
    db.exec(`
      create table if not exists cron_executions (
        id text primary key,
        job_id text not null,
        session_id text,
        trajectory_id text,
        scheduled_at text,
        started_at text not null,
        completed_at text,
        status text not null,
        output_summary text,
        delivery_results_json text,
        failure_class text,
        failure_message text,
        created_at text not null
      );
      create index if not exists idx_cron_executions_job on cron_executions(job_id, started_at desc);
      create index if not exists idx_cron_executions_status on cron_executions(status, started_at desc);
    `);
    store = new CronExecutionStore({ db });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a running execution record", async () => {
    const record = await store.create({ jobId: "job-1" });
    expect(record.jobId).toBe("job-1");
    expect(record.status).toBe("running");
    expect(record.id).toBeTruthy();
    expect(record.startedAt).toBeTruthy();
  });

  it("completes an execution with success status", async () => {
    const record = await store.create({ jobId: "job-1" });
    await store.complete(record.id, {
      status: "success",
      outputSummary: "All good",
      deliveryResults: new Map([["local", { success: true }]])
    });

    const updated = await store.get(record.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("success");
    expect(updated!.outputSummary).toBe("All good");
    expect(updated!.deliveryResults.get("local")?.success).toBe(true);
    expect(updated!.completedAt).toBeTruthy();
  });

  it("completes an execution with failure classification", async () => {
    const record = await store.create({ jobId: "job-2" });
    await store.complete(record.id, {
      status: "failed",
      failureClass: "script_error",
      failureMessage: "Exit code 1"
    });

    const updated = await store.get(record.id);
    expect(updated!.status).toBe("failed");
    expect(updated!.failureClass).toBe("script_error");
    expect(updated!.failureMessage).toBe("Exit code 1");
  });

  it("records partial multi-target delivery failure", async () => {
    const record = await store.create({ jobId: "job-3" });
    const deliveryResults = new Map([
      ["telegram:123", { success: true }],
      ["email:user@example.com", { success: false, error: "SMTP timeout" }]
    ]);
    await store.complete(record.id, {
      status: "success",
      deliveryResults
    });

    const updated = await store.get(record.id);
    expect(updated!.deliveryResults.size).toBe(2);
    expect(updated!.deliveryResults.get("telegram:123")?.success).toBe(true);
    expect(updated!.deliveryResults.get("email:user@example.com")?.success).toBe(false);
    expect(updated!.deliveryResults.get("email:user@example.com")?.error).toBe("SMTP timeout");
  });

  it("lists executions by job id", async () => {
    await store.create({ jobId: "job-a" });
    await store.create({ jobId: "job-b" });
    await store.create({ jobId: "job-a" });

    const list = await store.list({ jobId: "job-a" });
    expect(list.length).toBe(2);
    expect(list[0].jobId).toBe("job-a");
    expect(list[1].jobId).toBe("job-a");
  });

  it("limits list results", async () => {
    for (let i = 0; i < 5; i++) {
      await store.create({ jobId: "job-limit" });
    }
    const list = await store.list({ jobId: "job-limit", limit: 2 });
    expect(list.length).toBe(2);
  });

  it("lists all executions when no jobId is provided", async () => {
    await store.create({ jobId: "job-x" });
    await store.create({ jobId: "job-y" });
    const list = await store.list();
    expect(list.length).toBe(2);
  });

  it("stores session and trajectory references", async () => {
    const record = await store.create({ jobId: "job-ref" });
    await store.complete(record.id, {
      status: "success",
      sessionId: "sess-abc",
      trajectoryId: "traj-def"
    });

    const updated = await store.get(record.id);
    expect(updated!.sessionId).toBe("sess-abc");
    expect(updated!.trajectoryId).toBe("traj-def");
  });

  it("returns undefined for missing execution", async () => {
    const result = await store.get("non-existent-id");
    expect(result).toBeUndefined();
  });
});
