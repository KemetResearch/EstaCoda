import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileCronJobLock } from "./cron-lock.js";

describe("createFileCronJobLock", () => {
  let tmpDir: string;
  let lockDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-cron-lock-test-"));
    lockDir = join(tmpDir, "locks");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("acquires a lock for a job", async () => {
    const lock = createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 });
    const result = await lock.acquire("job-1");
    expect(result.acquired).toBe(true);
    expect(result.stale).toBe(false);
    expect(await lock.isLocked("job-1")).toBe(true);
  });

  it("refuses to acquire a lock already held", async () => {
    const lock = createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 });
    await lock.acquire("job-1");
    const result = await lock.acquire("job-1");
    expect(result.acquired).toBe(false);
    expect(result.stale).toBe(false);
  });

  it("releases a lock", async () => {
    const lock = createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 });
    await lock.acquire("job-1");
    await lock.release("job-1");
    expect(await lock.isLocked("job-1")).toBe(false);
  });

  it("allows re-acquisition after release", async () => {
    const lock = createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 });
    await lock.acquire("job-1");
    await lock.release("job-1");
    const result = await lock.acquire("job-1");
    expect(result.acquired).toBe(true);
  });

  it("recovers a stale lock", async () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const lock = createFileCronJobLock({
      lockDir,
      staleTimeoutMs: 5_000,
      now: () => now
    });
    await lock.acquire("job-1");

    // Advance time past stale timeout
    now.setTime(now.getTime() + 10_000);

    const result = await lock.acquire("job-1");
    expect(result.acquired).toBe(true);
    expect(result.stale).toBe(true);
  });

  it("does not recover a fresh lock", async () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const lock = createFileCronJobLock({
      lockDir,
      staleTimeoutMs: 60_000,
      now: () => now
    });
    await lock.acquire("job-1");

    // Advance time, but not past stale timeout
    now.setTime(now.getTime() + 30_000);

    const result = await lock.acquire("job-1");
    expect(result.acquired).toBe(false);
    expect(result.stale).toBe(false);
  });

  it("handles release of non-existent lock gracefully", async () => {
    const lock = createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 });
    await expect(lock.release("job-never-locked")).resolves.toBeUndefined();
  });

  it("tracks multiple jobs independently", async () => {
    const lock = createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 });
    await lock.acquire("job-a");
    const result = await lock.acquire("job-b");
    expect(result.acquired).toBe(true);
    expect(await lock.isLocked("job-a")).toBe(true);
    expect(await lock.isLocked("job-b")).toBe(true);
  });

  it("cleans up lock file on release", async () => {
    const lock = createFileCronJobLock({ lockDir, staleTimeoutMs: 60_000 });
    await lock.acquire("job-1");
    const lockFile = join(lockDir, "job-1.lock");
    expect(existsSync(lockFile)).toBe(true);
    await lock.release("job-1");
    expect(existsSync(lockFile)).toBe(false);
  });
});
