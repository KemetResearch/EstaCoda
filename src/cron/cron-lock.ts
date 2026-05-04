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

const DEFAULT_STALE_TIMEOUT_MS = 600_000; // 10 minutes

export function createFileCronJobLock(options: CronJobLockOptions): CronJobLock {
  const staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  async function lockPath(jobId: string): Promise<string> {
    await mkdir(options.lockDir, { recursive: true });
    return join(options.lockDir, `${safeJobId(jobId)}.lock`);
  }

  async function readLockTimestamp(path: string): Promise<Date | undefined> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = Date.parse(raw.trim());
      return Number.isNaN(parsed) ? undefined : new Date(parsed);
    } catch {
      return undefined;
    }
  }

  return {
    async acquire(jobId) {
      const path = await lockPath(jobId);

      try {
        // Try to create the lock file exclusively (atomic)
        const handle = await open(path, "wx");
        await handle.writeFile(now().toISOString(), "utf8");
        await handle.close();
        return { acquired: true, stale: false };
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code !== "EEXIST") {
          throw error;
        }

        // Lock exists - check if stale
        const lockedAt = await readLockTimestamp(path);
        if (lockedAt === undefined) {
          // Corrupt lock file - treat as stale and reclaim
          await rm(path, { force: true });
          const handle = await open(path, "wx");
          await handle.writeFile(now().toISOString(), "utf8");
          await handle.close();
          return { acquired: true, stale: true };
        }

        const elapsed = now().getTime() - lockedAt.getTime();
        if (elapsed > staleTimeoutMs) {
          // Stale lock - reclaim
          await rm(path, { force: true });
          const handle = await open(path, "wx");
          await handle.writeFile(now().toISOString(), "utf8");
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
      const lockedAt = await readLockTimestamp(path);
      if (lockedAt === undefined) return undefined;
      const elapsed = now().getTime() - lockedAt.getTime();
      if (elapsed > staleTimeoutMs) {
        return lockedAt;
      }
      return undefined;
    }
  };
}

function safeJobId(jobId: string): string {
  // Replace filesystem-unsafe characters
  return jobId.replace(/[^a-zA-Z0-9_-]/gu, "_");
}
