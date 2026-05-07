import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deriveTelegramIdentityHash,
  deriveDiscordIdentityHash,
  deriveEmailIdentityHash,
  deriveWhatsAppIdentityHash,
} from "./adapter-identity.js";
import { deriveIdentityHash } from "../gateway/identity-lock.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-adapter-identity-test-"));
}

describe("adapter-identity", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  describe("deriveTelegramIdentityHash", () => {
    it("derives hash from resolved env var", async () => {
      process.env.TEST_BOT_TOKEN = "abc123";
      const hash = await deriveTelegramIdentityHash(tmpDir, { enabled: true, botTokenEnv: "TEST_BOT_TOKEN" });
      expect(hash).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      const expected = await deriveIdentityHash(tmpDir, "telegram", "abc123");
      expect(hash).toBe(expected);
    });

    it("returns undefined when env var is missing", async () => {
      const hash = await deriveTelegramIdentityHash(tmpDir, { enabled: true, botTokenEnv: "MISSING_VAR" });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when env var is empty", async () => {
      process.env.TEST_BOT_TOKEN = "";
      const hash = await deriveTelegramIdentityHash(tmpDir, { enabled: true, botTokenEnv: "TEST_BOT_TOKEN" });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when channel is disabled", async () => {
      process.env.TEST_BOT_TOKEN = "abc123";
      const hash = await deriveTelegramIdentityHash(tmpDir, { enabled: false, botTokenEnv: "TEST_BOT_TOKEN" });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when botTokenEnv is undefined", async () => {
      const hash = await deriveTelegramIdentityHash(tmpDir, { enabled: true });
      expect(hash).toBeUndefined();
    });
  });

  describe("deriveDiscordIdentityHash", () => {
    it("derives hash from resolved env var", async () => {
      process.env.TEST_DISCORD_TOKEN = "discord_secret";
      const hash = await deriveDiscordIdentityHash(tmpDir, { enabled: true, botTokenEnv: "TEST_DISCORD_TOKEN" });
      expect(hash).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      const expected = await deriveIdentityHash(tmpDir, "discord", "discord_secret");
      expect(hash).toBe(expected);
    });

    it("returns undefined when env var is whitespace-only", async () => {
      process.env.TEST_DISCORD_TOKEN = "   ";
      const hash = await deriveDiscordIdentityHash(tmpDir, { enabled: true, botTokenEnv: "TEST_DISCORD_TOKEN" });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when channel is disabled", async () => {
      process.env.TEST_DISCORD_TOKEN = "token";
      const hash = await deriveDiscordIdentityHash(tmpDir, { enabled: false, botTokenEnv: "TEST_DISCORD_TOKEN" });
      expect(hash).toBeUndefined();
    });
  });

  describe("deriveEmailIdentityHash", () => {
    it("derives hash from account triplet", async () => {
      const hash = await deriveEmailIdentityHash(tmpDir, {
        enabled: true,
        username: "user",
        ownAddress: "user@example.com",
        imapHost: "imap.example.com",
      });
      expect(hash).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      const expected = await deriveIdentityHash(tmpDir, "email", "user:user@example.com:imap.example.com");
      expect(hash).toBe(expected);
    });

    it("lowercases the input", async () => {
      const hash = await deriveEmailIdentityHash(tmpDir, {
        enabled: true,
        username: "USER",
        ownAddress: "USER@EXAMPLE.COM",
        imapHost: "IMAP.EXAMPLE.COM",
      });

      const expected = await deriveIdentityHash(tmpDir, "email", "user:user@example.com:imap.example.com");
      expect(hash).toBe(expected);
    });

    it("returns undefined when username is blank", async () => {
      const hash = await deriveEmailIdentityHash(tmpDir, {
        enabled: true,
        username: "",
        ownAddress: "user@example.com",
        imapHost: "imap.example.com",
      });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when ownAddress is whitespace", async () => {
      const hash = await deriveEmailIdentityHash(tmpDir, {
        enabled: true,
        username: "user",
        ownAddress: "   ",
        imapHost: "imap.example.com",
      });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when imapHost is blank", async () => {
      const hash = await deriveEmailIdentityHash(tmpDir, {
        enabled: true,
        username: "user",
        ownAddress: "user@example.com",
        imapHost: "",
      });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when channel is disabled", async () => {
      const hash = await deriveEmailIdentityHash(tmpDir, {
        enabled: false,
        username: "user",
        ownAddress: "user@example.com",
        imapHost: "imap.example.com",
      });
      expect(hash).toBeUndefined();
    });

    it("does not include password in hash", async () => {
      const hash = await deriveEmailIdentityHash(tmpDir, {
        enabled: true,
        username: "user",
        ownAddress: "user@example.com",
        imapHost: "imap.example.com",
        passwordEnv: "EMAIL_PASS",
      });

      const expected = await deriveIdentityHash(tmpDir, "email", "user:user@example.com:imap.example.com");
      expect(hash).toBe(expected);
    });
  });

  describe("deriveWhatsAppIdentityHash", () => {
    it("derives hash from authDir path", async () => {
      const hash = await deriveWhatsAppIdentityHash(tmpDir, {
        enabled: true,
        authDir: "/home/user/.whatsapp-auth",
      });
      expect(hash).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      const expected = await deriveIdentityHash(tmpDir, "whatsapp", "/home/user/.whatsapp-auth");
      expect(hash).toBe(expected);
    });

    it("returns undefined when authDir is missing", async () => {
      const hash = await deriveWhatsAppIdentityHash(tmpDir, { enabled: true });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when authDir is empty", async () => {
      const hash = await deriveWhatsAppIdentityHash(tmpDir, { enabled: true, authDir: "" });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when authDir is whitespace", async () => {
      const hash = await deriveWhatsAppIdentityHash(tmpDir, { enabled: true, authDir: "   " });
      expect(hash).toBeUndefined();
    });

    it("returns undefined when channel is disabled", async () => {
      const hash = await deriveWhatsAppIdentityHash(tmpDir, { enabled: false, authDir: "/home/user/.whatsapp-auth" });
      expect(hash).toBeUndefined();
    });
  });

  describe("HMAC key reuse", () => {
    it("creates key once and reuses it across adapter kinds", async () => {
      process.env.TEST_BOT_TOKEN = "abc";
      const tgHash = await deriveTelegramIdentityHash(tmpDir, { enabled: true, botTokenEnv: "TEST_BOT_TOKEN" });

      const emailHash = await deriveEmailIdentityHash(tmpDir, {
        enabled: true,
        username: "user",
        ownAddress: "user@example.com",
        imapHost: "imap.example.com",
      });

      // Both should succeed with the same key file
      expect(tgHash).toBeDefined();
      expect(emailHash).toBeDefined();
    });
  });
});
