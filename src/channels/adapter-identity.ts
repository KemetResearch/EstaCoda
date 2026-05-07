import type {
  TelegramChannelConfig,
  DiscordChannelConfig,
  EmailChannelConfig,
  WhatsAppChannelConfig,
} from "../config/runtime-config.js";
import { deriveIdentityHash } from "../gateway/identity-lock.js";
import { resolve } from "node:path";

function resolveToken(botTokenEnv?: string): string | undefined {
  if (botTokenEnv === undefined) return undefined;
  const value = process.env[botTokenEnv];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function deriveTelegramIdentityHash(
  homeDir: string,
  config: TelegramChannelConfig
): Promise<string | undefined> {
  if (config.enabled !== true) return undefined;
  const token = resolveToken(config.botTokenEnv);
  if (token === undefined) return undefined;
  return deriveIdentityHash(homeDir, "telegram", token);
}

export async function deriveDiscordIdentityHash(
  homeDir: string,
  config: DiscordChannelConfig
): Promise<string | undefined> {
  if (config.enabled !== true) return undefined;
  const token = resolveToken(config.botTokenEnv);
  if (token === undefined) return undefined;
  return deriveIdentityHash(homeDir, "discord", token);
}

export async function deriveEmailIdentityHash(
  homeDir: string,
  config: EmailChannelConfig
): Promise<string | undefined> {
  if (config.enabled !== true) return undefined;
  const username = (config.username ?? "").trim().toLowerCase();
  const ownAddress = (config.ownAddress ?? "").trim().toLowerCase();
  const imapHost = (config.imapHost ?? "").trim().toLowerCase();
  if (username.length === 0 || ownAddress.length === 0 || imapHost.length === 0) {
    return undefined;
  }
  return deriveIdentityHash(homeDir, "email", `${username}:${ownAddress}:${imapHost}`);
}

export async function deriveWhatsAppIdentityHash(
  homeDir: string,
  config: WhatsAppChannelConfig
): Promise<string | undefined> {
  if (config.enabled !== true) return undefined;
  const authDir = (config.authDir ?? "").trim();
  if (authDir.length === 0) return undefined;
  const absoluteAuthDir = resolve(authDir);
  return deriveIdentityHash(homeDir, "whatsapp", absoluteAuthDir);
}
