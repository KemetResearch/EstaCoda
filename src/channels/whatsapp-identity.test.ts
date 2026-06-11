import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultWhatsAppAliasStorePath,
  normalizeWhatsAppChatId,
  normalizeWhatsAppGroupId,
  normalizeWhatsAppUserId,
  readWhatsAppAliasStore,
  rememberWhatsAppAlias,
  resolveWhatsAppAlias,
  whatsappChatIdToJid,
} from "./whatsapp-identity.js";

describe("WhatsApp identity normalization", () => {
  it("normalizes phone numbers", () => {
    expect(normalizeWhatsAppUserId("+971 50 123 4567")).toBe("971501234567");
    expect(normalizeWhatsAppUserId("whatsapp:+1 (415) 555-0100")).toBe("14155550100");
  });

  it("normalizes @s.whatsapp.net JIDs", () => {
    expect(normalizeWhatsAppUserId("971501234567@s.whatsapp.net")).toBe("971501234567");
    expect(normalizeWhatsAppChatId("971501234567@s.whatsapp.net")).toBe("971501234567");
    expect(whatsappChatIdToJid("971501234567")).toBe("971501234567@s.whatsapp.net");
  });

  it("normalizes @lid IDs", () => {
    expect(normalizeWhatsAppUserId("A1B2C3@lid")).toBe("a1b2c3@lid");
    expect(whatsappChatIdToJid("A1B2C3@lid")).toBe("a1b2c3@lid");
  });

  it("normalizes group JIDs", () => {
    expect(normalizeWhatsAppGroupId("120363025555555555@g.us")).toBe("120363025555555555@g.us");
    expect(normalizeWhatsAppChatId("120363025555555555@g.us", { isGroup: true })).toBe("120363025555555555@g.us");
    expect(whatsappChatIdToJid("120363025555555555@g.us", { isGroup: true })).toBe("120363025555555555@g.us");
  });

  it("fails closed for invalid and non-WhatsApp user identifiers", () => {
    expect(normalizeWhatsAppUserId("not a whatsapp id")).toBe("");
    expect(normalizeWhatsAppUserId("abc123")).toBe("");
    expect(normalizeWhatsAppUserId("not-a-phone@s.whatsapp.net")).toBe("");
    expect(normalizeWhatsAppUserId("@lid")).toBe("");
    expect(normalizeWhatsAppUserId("bad id@lid")).toBe("");
    expect(normalizeWhatsAppUserId("120363025555555555@g.us")).toBe("");
  });

  it("fails closed for invalid and non-WhatsApp group identifiers", () => {
    expect(normalizeWhatsAppGroupId("not a group")).toBe("");
    expect(normalizeWhatsAppGroupId("120363025555555555")).toBe("");
    expect(normalizeWhatsAppGroupId("bad group@g.us")).toBe("");
    expect(normalizeWhatsAppGroupId("971501234567@s.whatsapp.net")).toBe("");
  });

  it("persists LID/phone aliases profile-locally without message content", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "estacoda-wa-identity-"));
    try {
      const storePath = defaultWhatsAppAliasStorePath({ homeDir, profileId: "default" });

      await rememberWhatsAppAlias(storePath, "abc123@lid", "+971 50 123 4567");

      expect(await resolveWhatsAppAlias(storePath, "abc123@lid")).toBe("971501234567");
      expect(await resolveWhatsAppAlias(storePath, "971501234567@s.whatsapp.net")).toBe("971501234567");
      expect(await readWhatsAppAliasStore(storePath)).toEqual({
        version: 1,
        aliases: {
          "abc123@lid": "971501234567",
          "971501234567": "971501234567",
        },
      });
      expect(await readFile(storePath, "utf8")).not.toContain("hello");
      expect((await stat(storePath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
