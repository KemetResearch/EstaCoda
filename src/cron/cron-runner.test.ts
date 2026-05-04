import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronStore } from "./cron-store.js";
import { CronExecutionStore } from "./cron-execution-store.js";
import { createFileCronJobLock } from "./cron-lock.js";
import { tickCron, type CronRunner } from "./cron-runner.js";
import type { CronJob } from "./cron-store.js";

function mockOk(job: CronJob): ReturnType<CronRunner["runJob"]> {
  return Promise.resolve({
    job,
    ok: true,
    output: "done",
    delivered: true,
    deliveryResults: new Map()
  });
}

function mockFail(
  job: CronJob,
  failureClass: string,
  failureMessage: string
): ReturnType<CronRunner["runJob"]> {
  return Promise.resolve({
    job,
    ok: false,
    output: "error",
    delivered: false,
    deliveryResults: new Map(),
    failureClass,
    failureMessage
  });
}

describe("tickCron with execution store and job lock", () => {
  let tmpDir: string;
  let store: CronStore;
  let db: Database;
  let executionStore: CronExecutionStore;
  let lockDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-cron-runner-test-"));
    store = new CronStore({ homeDir: tmpDir });
    db = new Database(join(tmpDir, "test.db"));
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
    executionStore = new CronExecutionStore(db);
    lockDir = join(tmpDir, "locks");
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records execution history for a successful job", async () => {
    await store.create({
      name: "Test job",
      schedule: "* * * * *",
      prompt: "hello",
      delivery: "local"
    });

    const runner: CronRunner = { runJob: async (job) => mockOk(job) };

    const now = new Date("2030-01-01T00:00:00Z");
    const results = await tickCron({
      store,
      runner,
      executionStore,
      jobLock: createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 }),
      now
    });

    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(true);

    const history = await executionStore.list();
    expect(history.length).toBe(1);
    expect(history[0].status).toBe("success");
    expect(history[0].jobId).toBe(results[0].job.id);
  });

  it("records execution history for a failed job", async () => {
    await store.create({
      name: "Failing job",
      schedule: "* * * * *",
      prompt: "fail",
      delivery: "local"
    });

    const runner: CronRunner = {
      runJob: async (job) => mockFail(job, "script_error", "Exit code 1")
    };

    const now = new Date("2030-01-01T00:00:00Z");
    const results = await tickCron({
      store,
      runner,
      executionStore,
      jobLock: createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 }),
      now
    });

    expect(results[0].ok).toBe(false);

    const history = await executionStore.list();
    expect(history.length).toBe(1);
    expect(history[0].status).toBe("failed");
    expect(history[0].failureClass).toBe("script_error");
  });

  it("skips a due job if the lock is already held", async () => {
    await store.create({
      name: "Locked job",
      schedule: "* * * * *",
      prompt: "hello",
      delivery: "local"
    });

    let runnerCalled = false;
    const runner: CronRunner = {
      runJob: async (job) => {
        runnerCalled = true;
        return mockOk(job);
      }
    };

    // Use a mock lock that simulates an already-held lock
    let acquireCalled = false;
    const mockLock: import("./cron-lock.js").CronJobLock = {
      acquire: async () => {
        acquireCalled = true;
        return { acquired: false, stale: false };
      },
      release: async () => {},
      isLocked: async () => true,
      staleSince: async () => undefined
    };

    const now = new Date("2030-01-01T00:00:00Z");

    const results = await tickCron({ store, runner, executionStore, jobLock: mockLock, now });
    expect(results.length).toBe(1);
    expect(results[0].skipped).toBe(true);
    expect(acquireCalled).toBe(true);
    expect(runnerCalled).toBe(false);
  });

  it("allows re-execution after lock release", async () => {
    await store.create({
      name: "Re-runnable job",
      schedule: "* * * * *",
      prompt: "hello",
      delivery: "local"
    });

    let callCount = 0;
    const runner: CronRunner = {
      runJob: async (job) => {
        callCount++;
        return mockOk(job);
      }
    };

    const jobLock = createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 });
    const now = new Date("2030-01-01T00:00:00Z");

    const results1 = await tickCron({ store, runner, executionStore, jobLock, now });
    expect(results1.length).toBe(1);
    expect(callCount).toBe(1);

    // Simulate the job finishing and lock being released
    await jobLock.release(results1[0].job.id);

    // Run again at a future time when the job is due again
    // First run set nextRunAt to 00:01:00, so 00:01:01 makes it due
    const later = new Date("2030-01-01T00:01:01Z");

    const results2 = await tickCron({ store, runner, executionStore, jobLock, now: later });
    expect(results2.length).toBe(1);
    expect(callCount).toBe(2);
  });
  it("records delivery results per target", async () => {
    await store.create({
      name: "Delivery job",
      schedule: "* * * * *",
      prompt: "hello",
      delivery: "local"
    });

    const runner: CronRunner = {
      runJob: async (job) => ({
        job,
        ok: true,
        output: "done",
        delivered: true,
        deliveryResults: new Map([
          ["telegram:123", { success: true }],
          ["email:a@b.com", { success: false, error: "SMTP down" }]
        ])
      })
    };

    const now = new Date("2030-01-01T00:00:00Z");
    const results = await tickCron({
      store,
      runner,
      executionStore,
      jobLock: createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 }),
      now
    });

    expect(results[0].ok).toBe(true);

    const history = await executionStore.list();
    expect(history[0].deliveryResults.size).toBe(2);
    expect(history[0].deliveryResults.get("telegram:123")?.success).toBe(true);
    expect(history[0].deliveryResults.get("email:a@b.com")?.success).toBe(false);
  });

  it("classifies timeout failures", async () => {
    await store.create({
      name: "Timeout job",
      schedule: "* * * * *",
      prompt: "hello",
      delivery: "local"
    });

    const runner: CronRunner = {
      runJob: async (job) => mockFail(job, "timeout", "Script exceeded 30000ms")
    };

    const now = new Date("2030-01-01T00:00:00Z");
    const results = await tickCron({
      store,
      runner,
      executionStore,
      jobLock: createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 }),
      now
    });

    const history = await executionStore.list();
    expect(history[0].failureClass).toBe("timeout");
  });

  it("handles runner exceptions with unknown_error classification", async () => {
    await store.create({
      name: "Exploding job",
      schedule: "* * * * *",
      prompt: "hello",
      delivery: "local"
    });

    const runner: CronRunner = {
      runJob: async () => {
        throw new Error("Boom");
      }
    };

    const now = new Date("2030-01-01T00:00:00Z");
    const results = await tickCron({
      store,
      runner,
      executionStore,
      jobLock: createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 }),
      now
    });

    expect(results[0].ok).toBe(false);

    const history = await executionStore.list();
    expect(history[0].status).toBe("failed");
    expect(history[0].failureClass).toBe("unknown_error");
  });

  it("works without executionStore and jobLock (backward compat)", async () => {
    await store.create({
      name: "Compat job",
      schedule: "* * * * *",
      prompt: "hello",
      delivery: "local"
    });

    const runner: CronRunner = { runJob: async (job) => mockOk(job) };

    const now = new Date("2030-01-01T00:00:00Z");
    const results = await tickCron({ store, runner, now });
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(true);
  });
});
