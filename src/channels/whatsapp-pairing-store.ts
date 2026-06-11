import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultProfileId, readActiveProfile, resolveProfileStateHome } from "../config/profile-home.js";
import { resolveHomeDir } from "../config/home-dir.js";

const STORE_VERSION = 1;
const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_RATE_LIMIT_MS = 10 * 60_000;
const DEFAULT_LOCKOUT_MS = 60 * 60_000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_MAX_PENDING_CODES = 3;

type PendingCodeRecord = {
  id: string;
  salt: string;
  hash: string;
  requestedBy: string;
  createdAt: string;
  expiresAt: string;
};

type FailureRecord = {
  count: number;
  lockedUntil?: string;
  updatedAt: string;
};

type RequestRecord = {
  lastRequestedAt: string;
};

type WhatsAppPairingStoreFile = {
  version: 1;
  pending: PendingCodeRecord[];
  requests: Record<string, RequestRecord>;
  failures: Record<string, FailureRecord>;
};

export type WhatsAppUserAuthStoreOptions = {
  homeDir?: string;
  profileId?: string;
  storePath?: string;
  now?: () => Date;
  ttlMs?: number;
  rateLimitMs?: number;
  lockoutMs?: number;
  maxFailures?: number;
  maxPendingCodes?: number;
};

export type CreateWhatsAppUserAuthCodeResult =
  | { created: true; code: string; expiresAt: string; path: string; pendingCount: number }
  | { created: false; reason: "rate_limited" | "max_pending" | "store_corrupt"; path: string; retryAfter?: string; pendingCount?: number };

export type ConsumeWhatsAppUserAuthCodeResult =
  | { paired: true; senderId: string; normalizedSenderId: string; path: string }
  | { paired: false; reason: "missing" | "expired" | "mismatch" | "locked" | "store_corrupt"; path: string; lockedUntil?: string };

export function defaultWhatsAppUserAuthStorePath(options: { homeDir?: string; profileId?: string } = {}): string {
  const homeDir = resolveHomeDir(options.homeDir);
  const profileId = options.profileId ?? readActiveProfile({ homeDir })?.profileId ?? defaultProfileId();
  return join(resolveProfileStateHome({ homeDir, profileId }).gatewayStatePath, "whatsapp-user-auth.json");
}

export function normalizeWhatsAppUserId(value: string): string {
  return value
    .trim()
    .replace(/^whatsapp:/iu, "")
    .replace(/@s\.whatsapp\.net$/iu, "")
    .replace(/@lid$/iu, "");
}

export async function createWhatsAppUserAuthCode(
  options: WhatsAppUserAuthStoreOptions & {
    requesterId: string;
    code?: () => string;
    salt?: () => string;
    id?: () => string;
  }
): Promise<CreateWhatsAppUserAuthCodeResult> {
  const path = options.storePath ?? defaultWhatsAppUserAuthStorePath(options);
  const now = options.now?.() ?? new Date();
  const rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
  const maxPendingCodes = options.maxPendingCodes ?? DEFAULT_MAX_PENDING_CODES;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const requesterId = normalizeWhatsAppUserId(options.requesterId);
  const loaded = await readStore(path);
  if (!loaded.ok) {
    return { created: false, reason: "store_corrupt", path };
  }

  const store = pruneStore(loaded.store, now);
  const lastRequestedAt = store.requests[requesterId]?.lastRequestedAt;
  if (lastRequestedAt !== undefined) {
    const elapsed = now.getTime() - new Date(lastRequestedAt).getTime();
    if (elapsed < rateLimitMs) {
      return {
        created: false,
        reason: "rate_limited",
        path,
        retryAfter: new Date(new Date(lastRequestedAt).getTime() + rateLimitMs).toISOString(),
        pendingCount: store.pending.length
      };
    }
  }

  if (store.pending.length >= maxPendingCodes) {
    return { created: false, reason: "max_pending", path, pendingCount: store.pending.length };
  }

  const code = options.code?.() ?? randomAuthCode();
  const salt = options.salt?.() ?? randomBytes(16).toString("hex");
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  store.pending.push({
    id: options.id?.() ?? randomBytes(12).toString("hex"),
    salt,
    hash: hashCode(code, salt),
    requestedBy: requesterId,
    createdAt,
    expiresAt
  });
  store.requests[requesterId] = { lastRequestedAt: createdAt };
  await writeStore(path, store);

  return { created: true, code, expiresAt, path, pendingCount: store.pending.length };
}

export async function consumeWhatsAppUserAuthCode(
  options: WhatsAppUserAuthStoreOptions & {
    senderId: string;
    code: string;
  }
): Promise<ConsumeWhatsAppUserAuthCodeResult> {
  const path = options.storePath ?? defaultWhatsAppUserAuthStorePath(options);
  const now = options.now?.() ?? new Date();
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
  const lockoutMs = options.lockoutMs ?? DEFAULT_LOCKOUT_MS;
  const senderId = normalizeWhatsAppUserId(options.senderId);
  const loaded = await readStore(path);
  if (!loaded.ok) {
    return { paired: false, reason: "store_corrupt", path };
  }

  const store = pruneFailures(loaded.store, now);
  const failure = store.failures[senderId];
  if (failure?.lockedUntil !== undefined && new Date(failure.lockedUntil).getTime() > now.getTime()) {
    await writeStore(path, store);
    return { paired: false, reason: "locked", path, lockedUntil: failure.lockedUntil };
  }

  const matchIndex = store.pending.findIndex((pending) => hashesEqual(hashCode(options.code, pending.salt), pending.hash));
  if (matchIndex === -1) {
    store.pending = store.pending.filter((pending) => new Date(pending.expiresAt).getTime() > now.getTime());
    if (store.pending.length === 0) {
      await writeStore(path, store);
      return { paired: false, reason: "missing", path };
    }
    const lockedUntil = recordFailure(store, senderId, now, maxFailures, lockoutMs);
    await writeStore(path, store);
    return lockedUntil === undefined
      ? { paired: false, reason: "mismatch", path }
      : { paired: false, reason: "locked", path, lockedUntil };
  }

  const pending = store.pending[matchIndex];
  if (new Date(pending.expiresAt).getTime() <= now.getTime()) {
    store.pending.splice(matchIndex, 1);
    await writeStore(path, store);
    return { paired: false, reason: "expired", path };
  }

  store.pending.splice(matchIndex, 1);
  delete store.failures[senderId];
  await writeStore(path, store);
  return { paired: true, senderId: options.senderId, normalizedSenderId: senderId, path };
}

function emptyStore(): WhatsAppPairingStoreFile {
  return {
    version: STORE_VERSION,
    pending: [],
    requests: {},
    failures: {}
  };
}

async function readStore(path: string): Promise<{ ok: true; store: WhatsAppPairingStoreFile } | { ok: false }> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<WhatsAppPairingStoreFile>;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.pending) || parsed.requests === undefined || parsed.failures === undefined) {
      return { ok: false };
    }
    return {
      ok: true,
      store: {
        version: STORE_VERSION,
        pending: parsed.pending.filter(isPendingCodeRecord),
        requests: filterRecords(parsed.requests, isRequestRecord),
        failures: filterRecords(parsed.failures, isFailureRecord)
      }
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ok: true, store: emptyStore() };
    }
    return { ok: false };
  }
}

async function writeStore(path: string, store: WhatsAppPairingStoreFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // Best effort on platforms/filesystems that do not support chmod.
  }
}

function pruneStore(store: WhatsAppPairingStoreFile, now: Date): WhatsAppPairingStoreFile {
  const nowMs = now.getTime();
  return {
    version: STORE_VERSION,
    pending: store.pending.filter((pending) => new Date(pending.expiresAt).getTime() > nowMs),
    requests: store.requests,
    failures: Object.fromEntries(
      Object.entries(store.failures).filter(([, failure]) =>
        failure.lockedUntil === undefined || new Date(failure.lockedUntil).getTime() > nowMs || failure.count > 0
      )
    )
  };
}

function pruneFailures(store: WhatsAppPairingStoreFile, now: Date): WhatsAppPairingStoreFile {
  return {
    ...store,
    failures: Object.fromEntries(
      Object.entries(store.failures).filter(([, failure]) =>
        failure.lockedUntil === undefined || new Date(failure.lockedUntil).getTime() > now.getTime() || failure.count > 0
      )
    )
  };
}

function recordFailure(
  store: WhatsAppPairingStoreFile,
  senderId: string,
  now: Date,
  maxFailures: number,
  lockoutMs: number
): string | undefined {
  const previous = store.failures[senderId];
  const count = (previous?.lockedUntil !== undefined && new Date(previous.lockedUntil).getTime() <= now.getTime())
    ? 1
    : (previous?.count ?? 0) + 1;
  const lockedUntil = count >= maxFailures
    ? new Date(now.getTime() + lockoutMs).toISOString()
    : undefined;
  store.failures[senderId] = {
    count,
    lockedUntil,
    updatedAt: now.toISOString()
  };
  return lockedUntil;
}

function hashCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${normalizeCode(code)}`).digest("hex");
}

function hashesEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function normalizeCode(code: string): string {
  return code.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function randomAuthCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

function filterRecords<T>(value: unknown, predicate: (value: unknown) => value is T): Record<string, T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, record]) => predicate(record))) as Record<string, T>;
}

function isPendingCodeRecord(value: unknown): value is PendingCodeRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as PendingCodeRecord;
  return typeof record.id === "string" &&
    typeof record.salt === "string" &&
    typeof record.hash === "string" &&
    typeof record.requestedBy === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.expiresAt === "string";
}

function isRequestRecord(value: unknown): value is RequestRecord {
  return value !== null &&
    typeof value === "object" &&
    typeof (value as RequestRecord).lastRequestedAt === "string";
}

function isFailureRecord(value: unknown): value is FailureRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as FailureRecord;
  return typeof record.count === "number" &&
    typeof record.updatedAt === "string" &&
    (record.lockedUntil === undefined || typeof record.lockedUntil === "string");
}
