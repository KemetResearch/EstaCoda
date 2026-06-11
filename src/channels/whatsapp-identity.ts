import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultProfileId, resolveProfileStateHome } from "../config/profile-home.js";

export const WHATSAPP_DEFAULT_REPLY_PREFIX = "EstaCoda: ";

export type WhatsAppAliasStoreData = {
  version: 1;
  aliases: Record<string, string>;
};

export function normalizeWhatsAppUserId(input: string): string {
  const raw = stripWhatsAppPrefix(input).toLowerCase();
  if (raw.endsWith("@s.whatsapp.net")) {
    return normalizePhoneId(raw.slice(0, -"@s.whatsapp.net".length));
  }
  if (raw.endsWith("@lid")) {
    const lid = raw.slice(0, -"@lid".length).trim();
    return isLidId(lid) ? `${lid}@lid` : "";
  }
  if (raw.endsWith("@g.us")) {
    return "";
  }
  return normalizePhoneId(raw);
}

export function normalizeWhatsAppGroupId(input: string): string {
  const raw = stripWhatsAppPrefix(input).toLowerCase();
  if (raw.endsWith("@g.us")) {
    const group = raw.slice(0, -"@g.us".length).trim();
    return isGroupId(group) ? `${group}@g.us` : "";
  }
  return "";
}

export function normalizeWhatsAppChatId(input: string, options: { isGroup?: boolean } = {}): string {
  return options.isGroup === true ? normalizeWhatsAppGroupId(input) : normalizeWhatsAppUserId(input);
}

export function whatsappChatIdToJid(chatId: string, options: { isGroup?: boolean } = {}): string {
  const normalized = normalizeWhatsAppChatId(chatId, options);
  if (normalized.length === 0) return chatId;
  if (normalized.endsWith("@g.us") || normalized.endsWith("@lid") || normalized.endsWith("@s.whatsapp.net")) {
    return normalized;
  }
  if (/^\d+$/u.test(normalized)) return `${normalized}@s.whatsapp.net`;
  return normalized;
}

export function defaultWhatsAppAliasStorePath(options: { homeDir?: string; profileId?: string }): string {
  return join(resolveProfileStateHome({ homeDir: options.homeDir, profileId: options.profileId ?? defaultProfileId() }).gatewayStatePath, "whatsapp-identity-aliases.json");
}

export async function readWhatsAppAliasStore(path: string): Promise<WhatsAppAliasStoreData> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isAliasStoreData(parsed)) return emptyAliasStore();
    return {
      version: 1,
      aliases: normalizeAliasRecord(parsed.aliases),
    };
  } catch {
    return emptyAliasStore();
  }
}

export async function resolveWhatsAppAlias(path: string | undefined, id: string): Promise<string> {
  const normalized = normalizeWhatsAppUserId(id);
  if (path === undefined || normalized.length === 0) return normalized;
  const store = await readWhatsAppAliasStore(path);
  return store.aliases[normalized] ?? normalized;
}

export async function rememberWhatsAppAlias(path: string | undefined, first: string, second: string): Promise<void> {
  if (path === undefined) return;
  const a = normalizeWhatsAppUserId(first);
  const b = normalizeWhatsAppUserId(second);
  if (a.length === 0 || b.length === 0 || a === b) return;
  if (a.endsWith("@g.us") || b.endsWith("@g.us")) return;

  const canonical = chooseCanonicalUserId(a, b);
  const store = await readWhatsAppAliasStore(path);
  store.aliases[a] = canonical;
  store.aliases[b] = canonical;
  await writeWhatsAppAliasStore(path, store);
}

export function normalizeWhatsAppAllowlist(values: readonly string[] | undefined): string[] {
  return unique((values ?? []).map(normalizeWhatsAppUserId));
}

export function normalizeWhatsAppGroupAllowlist(values: readonly string[] | undefined): string[] {
  return unique((values ?? []).map(normalizeWhatsAppGroupId));
}

function chooseCanonicalUserId(a: string, b: string): string {
  if (/^\d+$/u.test(a)) return a;
  if (/^\d+$/u.test(b)) return b;
  return a.localeCompare(b) <= 0 ? a : b;
}

function stripWhatsAppPrefix(input: string): string {
  return input.trim().replace(/^whatsapp:/iu, "");
}

function normalizePhoneId(input: string): string {
  const trimmed = input.trim();
  if (!/^[+\d\s().-]+$/u.test(trimmed)) return "";
  const digits = trimmed.replace(/[^\d]/gu, "");
  return digits.length > 0 ? digits : "";
}

function isLidId(input: string): boolean {
  return /^[a-z0-9._-]+$/u.test(input);
}

function isGroupId(input: string): boolean {
  return /^[a-z0-9._-]+$/u.test(input);
}

function normalizeAliasRecord(input: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizeWhatsAppUserId(key);
    const normalizedValue = normalizeWhatsAppUserId(value);
    if (normalizedKey.length > 0 && normalizedValue.length > 0) {
      output[normalizedKey] = normalizedValue;
    }
  }
  return output;
}

async function writeWhatsAppAliasStore(path: string, store: WhatsAppAliasStoreData): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, path);
  await chmod(path, 0o600).catch(() => undefined);
}

function emptyAliasStore(): WhatsAppAliasStoreData {
  return { version: 1, aliases: {} };
}

function isAliasStoreData(value: unknown): value is WhatsAppAliasStoreData {
  return typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { aliases?: unknown }).aliases === "object" &&
    (value as { aliases?: unknown }).aliases !== null &&
    Object.values((value as { aliases: Record<string, unknown> }).aliases).every((alias) => typeof alias === "string");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
