import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumeWhatsAppUserAuthCode,
  createWhatsAppUserAuthCode,
  normalizeWhatsAppUserId
} from "./whatsapp-pairing-store.js";

async function withStore<T>(run: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "estacoda-wa-pairing-"));
  try {
    return await run(join(dir, "whatsapp-user-auth.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("WhatsApp user auth pairing store", () => {
  it("stores salted hashes instead of plaintext codes and writes 0600 files", async () => {
    await withStore(async (storePath) => {
      const result = await createWhatsAppUserAuthCode({
        storePath,
        requesterId: "owner",
        code: () => "PAIR-1234",
        salt: () => "fixed-salt",
        now: () => new Date("2026-06-10T10:00:00.000Z")
      });

      expect(result.created).toBe(true);
      const raw = await readFile(storePath, "utf8");
      expect(raw).not.toContain("PAIR-1234");
      expect(raw).not.toContain("PAIR1234");
      expect(raw).toContain("fixed-salt");
      expect((await stat(storePath)).mode & 0o777).toBe(0o600);
    });
  });

  it("redeems a valid code once for the sender that presents it", async () => {
    await withStore(async (storePath) => {
      const created = await createWhatsAppUserAuthCode({
        storePath,
        requesterId: "owner",
        code: () => "12345678",
        now: () => new Date("2026-06-10T10:00:00.000Z")
      });
      expect(created.created).toBe(true);

      const consumed = await consumeWhatsAppUserAuthCode({
        storePath,
        senderId: "971501234567@s.whatsapp.net",
        code: "1234 5678",
        now: () => new Date("2026-06-10T10:01:00.000Z")
      });

      expect(consumed).toMatchObject({
        paired: true,
        senderId: "971501234567@s.whatsapp.net",
        normalizedSenderId: "971501234567"
      });

      const reused = await consumeWhatsAppUserAuthCode({
        storePath,
        senderId: "971501234567@s.whatsapp.net",
        code: "12345678",
        now: () => new Date("2026-06-10T10:02:00.000Z")
      });
      expect(reused).toMatchObject({ paired: false, reason: "missing" });
    });
  });

  it("expires pending codes after the TTL", async () => {
    await withStore(async (storePath) => {
      await createWhatsAppUserAuthCode({
        storePath,
        requesterId: "owner",
        code: () => "87654321",
        ttlMs: 10 * 60_000,
        now: () => new Date("2026-06-10T10:00:00.000Z")
      });

      const consumed = await consumeWhatsAppUserAuthCode({
        storePath,
        senderId: "971501234567",
        code: "87654321",
        now: () => new Date("2026-06-10T10:11:00.000Z")
      });

      expect(consumed).toMatchObject({ paired: false, reason: "expired" });
    });
  });

  it("rate-limits code creation per requester", async () => {
    await withStore(async (storePath) => {
      const first = await createWhatsAppUserAuthCode({
        storePath,
        requesterId: "971501234567@s.whatsapp.net",
        code: () => "11111111",
        now: () => new Date("2026-06-10T10:00:00.000Z")
      });
      const second = await createWhatsAppUserAuthCode({
        storePath,
        requesterId: "971501234567",
        code: () => "22222222",
        now: () => new Date("2026-06-10T10:05:00.000Z")
      });

      expect(first.created).toBe(true);
      expect(second).toMatchObject({ created: false, reason: "rate_limited" });
    });
  });

  it("limits active pending codes to three", async () => {
    await withStore(async (storePath) => {
      for (let i = 0; i < 3; i += 1) {
        const created = await createWhatsAppUserAuthCode({
          storePath,
          requesterId: `owner-${i}`,
          code: () => `1000000${i}`,
          now: () => new Date("2026-06-10T10:00:00.000Z")
        });
        expect(created.created).toBe(true);
      }

      const blocked = await createWhatsAppUserAuthCode({
        storePath,
        requesterId: "owner-4",
        code: () => "10000004",
        now: () => new Date("2026-06-10T10:00:00.000Z")
      });

      expect(blocked).toMatchObject({ created: false, reason: "max_pending", pendingCount: 3 });
    });
  });

  it("locks a sender for one hour after five failed attempts", async () => {
    await withStore(async (storePath) => {
      await createWhatsAppUserAuthCode({
        storePath,
        requesterId: "owner",
        code: () => "55555555",
        now: () => new Date("2026-06-10T10:00:00.000Z")
      });

      for (let i = 0; i < 4; i += 1) {
        const result = await consumeWhatsAppUserAuthCode({
          storePath,
          senderId: "971501234567@s.whatsapp.net",
          code: "00000000",
          now: () => new Date(`2026-06-10T10:0${i}:00.000Z`)
        });
        expect(result).toMatchObject({ paired: false, reason: "mismatch" });
      }

      const fifth = await consumeWhatsAppUserAuthCode({
        storePath,
        senderId: "971501234567",
        code: "00000000",
        now: () => new Date("2026-06-10T10:05:00.000Z")
      });
      expect(fifth).toMatchObject({
        paired: false,
        reason: "locked",
        lockedUntil: "2026-06-10T11:05:00.000Z"
      });

      const validWhileLocked = await consumeWhatsAppUserAuthCode({
        storePath,
        senderId: "971501234567",
        code: "55555555",
        now: () => new Date("2026-06-10T10:06:00.000Z")
      });
      expect(validWhileLocked).toMatchObject({ paired: false, reason: "locked" });
    });
  });

  it("fails closed when the store is corrupt", async () => {
    await withStore(async (storePath) => {
      await writeFile(storePath, "{not-json\n", "utf8");

      await expect(createWhatsAppUserAuthCode({
        storePath,
        requesterId: "owner",
        code: () => "12345678"
      })).resolves.toMatchObject({ created: false, reason: "store_corrupt" });

      await expect(consumeWhatsAppUserAuthCode({
        storePath,
        senderId: "971501234567",
        code: "12345678"
      })).resolves.toMatchObject({ paired: false, reason: "store_corrupt" });
    });
  });

  it("normalizes WhatsApp sender IDs consistently", () => {
    expect(normalizeWhatsAppUserId("whatsapp:971501234567@s.whatsapp.net")).toBe("971501234567");
    expect(normalizeWhatsAppUserId("971501234567@lid")).toBe("971501234567");
  });
});
