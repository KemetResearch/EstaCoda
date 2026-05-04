import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export type CronJobLockOptions = {
  lockDir: string;
  staleTimeoutMs?: number;
  now?: () => Date;
};

export type CronJobLockResult = {
  acquired: boolean;
  stale?: boolean;
};

export type CronJobLock = {
  acquire(jobId: string): Promise<CronJobLockResult>;
  release(jobId: string): Promise<void>;
  isLocked(jobId: string): Promise<boolean>;
  staleSince(jobId: string): Promise<Date | undefined>;
};

const DEFAULT_STALE_TIMEOUT_MS = 300_000; // 5 minutes

type LockFileContent = {
  pid: number;
  startedAt: string;
};

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err.code === "EPERM") return true;
    return false;
  }
}

export function createFileCronJobLock(options: CronJobLockOptions): CronJobLock {
  const staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  async function lockPath(jobId: string): Promise<string> {
    await mkdir(options.lockDir, { recursive: true });
    return join(options.lockDir, `${safeJobId(jobId)}.lock`);
  }

  async function readLock(path: string): Promise<{ content: LockFileContent; lockedAt: Date } | undefined> {
    try {
      const raw = await readFile(path, "utf8");
      const trimmed = raw.trim();
      // Try JSON format first
      const parsed = JSON.parse(trimmed) as Partial<LockFileContent>;
      if (typeof parsed.pid === "number" && typeof parsed.startedAt === "string") {
        const lockedAt = Date.parse(parsed.startedAt);
        if (!Number.isNaN(lockedAt)) {
          return { content: { pid: parsed.pid, startedAt: parsed.startedAt }, lockedAt: new Date(lockedAt) };
        }
      }
      // Fallback: raw ISO string (old format)
      const lockedAt = Date.parse(trimmed);
      if (!Number.isNaN(lockedAt)) {
        return { content: { pid: -1, startedAt: trimmed }, lockedAt: new Date(lockedAt) };
      }
      return undefined;
    } catch {
      // JSON.parse failed - try raw ISO string
      try {
        const raw = await readFile(path, "utf8");
        const trimmed = raw.trim();
        const lockedAt = Date.parse(trimmed);
        if (!Number.isNaN(lockedAt)) {
          return { content: { pid: -1, startedAt: trimmed }, lockedAt: new Date(lockedAt) };
        }
      } catch {
        // ignore
      }
      return undefined;
    }
  }

  return {
    async acquire(jobId) {
      const path = await lockPath(jobId);

      try {
        // Try to create the lock file exclusively (atomic)
        const handle = await open(path, "wx");
        const content: LockFileContent = { pid: process.pid, startedAt: now().toISOString() };
        await handle.writeFile(JSON.stringify(content), "utf8");
        await handle.close();
        return { acquired: true, stale: false };
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code !== "EEXIST") {
          throw error;
        }

        // Lock exists - check if stale
        const lock = await readLock(path);
        if (lock === undefined) {
          // Corrupt lock file - treat as stale and reclaim
          await rm(path, { force: true });
          const handle = await open(path, "wx");
          const content: LockFileContent = { pid: process.pid, startedAt: now().toISOString() };
          await handle.writeFile(JSON.stringify(content), "utf8");
          await handle.close();
          return { acquired: true, stale: true };
        }

        const elapsed = now().getTime() - lock.lockedAt.getTime();
        const pidDead = !isPidAlive(lock.content.pid);

        if (elapsed > staleTimeoutMs || pidDead) {
          // Stale lock - reclaim
          await rm(path, { force: true });
          const handle = await open(path, "wx");
          const content: LockFileContent = { pid: process.pid, startedAt: now().toISOString() };
          await handle.writeFile(JSON.stringify(content), "utf8");
          await handle.close();
          return { acquired: true, stale: true };
        }

        // Lock is still fresh
        return { acquired: false, stale: false };
      }
    },

    async release(jobId) {
      const path = await lockPath(jobId);
      await rm(path, { force: true });
    },

    async isLocked(jobId) {
      const path = await lockPath(jobId);
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },

    async staleSince(jobId) {
      const path = await lockPath(jobId);
      const lock = await readLock(path);
      if (lock === undefined) return undefined;
      const elapsed = now().getTime() - lock.lockedAt.getTime();
      if (elapsed > staleTimeoutMs) {
        return lock.lockedAt;
      }
      return undefined;
    }
  };
}

function safeJobId(jobId: string): string {
  // Replace filesystem-unsafe characters
  return jobId.replace(/[^a-zA-Z0-9_-]/gu, "_");
}
