import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deriveIdentityHash,
  identityLockPath,
  acquireAdapterIdentityLock,
  releaseAdapterIdentityLock,
  isAdapterIdentityLocked,
  reclaimStaleAdapterIdentityLock,
  listAdapterIdentityLocks,
} from "./identity-lock.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-identity-lock-test-"));
}

describe("identity-lock", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await mkdir(join(tmpDir, ".estacoda", "gateway", "locks"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("deriveIdentityHash", () => {
    it("creates key file with 0o600 on first call", async () => {
      await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const keyPath = join(tmpDir, ".estacoda", "gateway", "identity-lock-key");
      const content = await readFile(keyPath, "utf8");
      expect(content.length).toBeGreaterThan(0);
      const stats = await import("node:fs/promises").then((m) => m.stat(keyPath));
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it("reuses existing key and produces identical hashes", async () => {
      const hash1 = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const hash2 = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces different hashes for different kinds with same raw string", async () => {
      const hash1 = await deriveIdentityHash(tmpDir, "telegram", "same");
      const hash2 = await deriveIdentityHash(tmpDir, "discord", "same");
      expect(hash1).not.toBe(hash2);
    });

    it("produces different hashes for different strings with same kind", async () => {
      const hash1 = await deriveIdentityHash(tmpDir, "telegram", "abc");
      const hash2 = await deriveIdentityHash(tmpDir, "telegram", "def");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("acquireAdapterIdentityLock", () => {
    it("creates lock file atomically", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const result = await acquireAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(result.acquired).toBe(true);
      expect(result.stale).toBe(false);

      const path = identityLockPath(tmpDir, "telegram", hash);
      const content = JSON.parse(await readFile(path, "utf8"));
      expect(typeof content.pid).toBe("number");
      expect(typeof content.startedAt).toBe("string");
    });

    it("second acquire for same identity fails", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const first = await acquireAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(first.acquired).toBe(true);

      const second = await acquireAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(second.acquired).toBe(false);
      expect(second.holderPid).toBe(process.pid);
    });

    it("acquire for different identity succeeds", async () => {
      const hash1 = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const hash2 = await deriveIdentityHash(tmpDir, "telegram", "def456");
      const first = await acquireAdapterIdentityLock(tmpDir, "telegram", hash1);
      const second = await acquireAdapterIdentityLock(tmpDir, "telegram", hash2);
      expect(first.acquired).toBe(true);
      expect(second.acquired).toBe(true);
    });

    it("cross-kind collision is impossible", async () => {
      const hash1 = await deriveIdentityHash(tmpDir, "telegram", "same");
      const hash2 = await deriveIdentityHash(tmpDir, "discord", "same");
      const first = await acquireAdapterIdentityLock(tmpDir, "telegram", hash1);
      const second = await acquireAdapterIdentityLock(tmpDir, "discord", hash2);
      expect(first.acquired).toBe(true);
      expect(second.acquired).toBe(true);
    });

    it("reclaims stale lock when PID is dead", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const path = identityLockPath(tmpDir, "telegram", hash);
      await writeFile(path, JSON.stringify({ pid: 99999, startedAt: new Date().toISOString() }), "utf8");

      const result = await acquireAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(result.acquired).toBe(true);
      expect(result.stale).toBe(true);

      const content = JSON.parse(await readFile(path, "utf8"));
      expect(content.pid).toBe(process.pid);
    });

    it("old timestamp alone does NOT make lock stale", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const path = identityLockPath(tmpDir, "telegram", hash);
      const oldDate = new Date(Date.now() - 3600_000).toISOString();
      await writeFile(path, JSON.stringify({ pid: process.pid, startedAt: oldDate }), "utf8");

      const result = await acquireAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(result.acquired).toBe(false);
      expect(result.stale).toBe(false);

      const content = JSON.parse(await readFile(path, "utf8"));
      expect(content.pid).toBe(process.pid);
      expect(content.startedAt).toBe(oldDate);
    });

    it("corrupt lock file is treated as stale during acquire", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const path = identityLockPath(tmpDir, "telegram", hash);
      await writeFile(path, "not-json", "utf8");

      const result = await acquireAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(result.acquired).toBe(true);
      expect(result.stale).toBe(true);
    });
  });

  describe("releaseAdapterIdentityLock", () => {
    it("removes owned lock", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      await acquireAdapterIdentityLock(tmpDir, "telegram", hash);

      const result = await releaseAdapterIdentityLock(tmpDir, "telegram", hash, process.pid);
      expect(result.released).toBe(true);
      expect(result.reason).toBe("released");

      expect(await isAdapterIdentityLocked(tmpDir, "telegram", hash)).toBe(false);
    });

    it("refuses to delete live lock owned by another PID", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      await acquireAdapterIdentityLock(tmpDir, "telegram", hash);

      const result = await releaseAdapterIdentityLock(tmpDir, "telegram", hash, process.pid + 1);
      expect(result.released).toBe(false);
      expect(result.reason).toBe("not_owner");

      expect(await isAdapterIdentityLocked(tmpDir, "telegram", hash)).toBe(true);
    });

    it("returns missing for absent lock", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const result = await releaseAdapterIdentityLock(tmpDir, "telegram", hash, process.pid);
      expect(result.released).toBe(true);
      expect(result.reason).toBe("missing");
    });

    it("returns stale for corrupt lock", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const path = identityLockPath(tmpDir, "telegram", hash);
      await writeFile(path, "not-json", "utf8");

      const result = await releaseAdapterIdentityLock(tmpDir, "telegram", hash, process.pid);
      expect(result.released).toBe(false);
      expect(result.reason).toBe("stale");
    });
  });

  describe("reclaimStaleAdapterIdentityLock", () => {
    it("reclaims dead-PID lock", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const path = identityLockPath(tmpDir, "telegram", hash);
      await writeFile(path, JSON.stringify({ pid: 99999, startedAt: new Date().toISOString() }), "utf8");

      const result = await reclaimStaleAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(result.acquired).toBe(true);
      expect(result.stale).toBe(true);

      const content = JSON.parse(await readFile(path, "utf8"));
      expect(content.pid).toBe(process.pid);
    });

    it("does not reclaim live lock", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      await acquireAdapterIdentityLock(tmpDir, "telegram", hash);

      const result = await reclaimStaleAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(result.acquired).toBe(false);
      expect(result.stale).toBe(false);
      expect(result.holderPid).toBe(process.pid);
    });

    it("reclaims corrupt lock", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const path = identityLockPath(tmpDir, "telegram", hash);
      await writeFile(path, "not-json", "utf8");

      const result = await reclaimStaleAdapterIdentityLock(tmpDir, "telegram", hash);
      expect(result.acquired).toBe(true);
      expect(result.stale).toBe(true);
    });
  });

  describe("listAdapterIdentityLocks", () => {
    it("returns all locks with stale flag", async () => {
      const hash1 = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      const hash2 = await deriveIdentityHash(tmpDir, "discord", "def456");
      const hash3 = await deriveIdentityHash(tmpDir, "email", "user@example.com");

      await acquireAdapterIdentityLock(tmpDir, "telegram", hash1);
      await acquireAdapterIdentityLock(tmpDir, "discord", hash2);
      const path3 = identityLockPath(tmpDir, "email", hash3);
      await writeFile(path3, JSON.stringify({ pid: 99999, startedAt: new Date().toISOString() }), "utf8");

      const locks = await listAdapterIdentityLocks(tmpDir);
      expect(locks.length).toBe(3);

      const tg = locks.find((l) => l.kind === "telegram");
      expect(tg).toBeDefined();
      expect(tg!.stale).toBe(false);

      const dc = locks.find((l) => l.kind === "discord");
      expect(dc).toBeDefined();
      expect(dc!.stale).toBe(false);

      const em = locks.find((l) => l.kind === "email");
      expect(em).toBeDefined();
      expect(em!.stale).toBe(true);
    });

    it("returns empty array when no locks dir exists", async () => {
      const locks = await listAdapterIdentityLocks(tmpDir);
      expect(locks).toEqual([]);
    });
  });

  describe("secret non-exposure", () => {
    it("lock file does not contain raw secret", async () => {
      const rawToken = "super_secret_token_12345";
      const hash = await deriveIdentityHash(tmpDir, "telegram", rawToken);
      await acquireAdapterIdentityLock(tmpDir, "telegram", hash);

      const path = identityLockPath(tmpDir, "telegram", hash);
      const content = await readFile(path, "utf8");
      expect(content).not.toContain(rawToken);
      expect(content).not.toContain("super_secret");

      // Filename should only contain hex after the prefix
      const fileName = path.split("/").pop()!;
      expect(fileName).toMatch(/^identity-telegram-[a-f0-9]+\.lock$/);
    });

    it("lock file does not contain HMAC key", async () => {
      const hash = await deriveIdentityHash(tmpDir, "telegram", "abc");
      await acquireAdapterIdentityLock(tmpDir, "telegram", hash);

      const keyPath = join(tmpDir, ".estacoda", "gateway", "identity-lock-key");
      const keyContent = await readFile(keyPath, "utf8");

      const lockPath = identityLockPath(tmpDir, "telegram", hash);
      const lockContent = await readFile(lockPath, "utf8");
      expect(lockContent).not.toContain(keyContent.trim());
    });
  });
});
