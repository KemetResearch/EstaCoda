export type RedactionOptions = {
  /** Additional key names (case-insensitive) to redact beyond defaults. */
  additionalKeys?: string[];
  /** When true, also redact values that look like API keys/tokens even if key is unknown. */
  strict?: boolean;
};

const REDACTED = "[REDACTED]";

const DEFAULT_SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "api-key",
  "token",
  "secret",
  "password",
  "passwd",
  "auth",
  "authorization",
  "credential",
  "credentials",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "bearer",
  "private_key",
  "privateKey",
  "keyid",
  "key_id",
  "client_secret",
  "clientSecret",
  "bot_token",
  "botToken",
  "session_token",
  "sessionToken",
  "cookie",
  "csrf",
  "xsrf",
  "mfa_secret",
  "mfaSecret",
  "backup_codes",
  "backupCodes"
]);

const HIGH_ENTROPY_PATTERN = /^(?:[a-zA-Z0-9+/=_-]{32,}|eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)$/;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/giu;
const BASIC_AUTH_PATTERN = /\bBasic\s+[A-Za-z0-9._~+/=-]{16,}\b/giu;
const URL_CREDENTIAL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/giu;
const ENV_SECRET_PATTERN = /\b([A-Z][A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASS|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Z0-9_]*\s*=\s*)(['"]?)[^\s'"]+\2/gu;
const PASSWORD_ASSIGNMENT_PATTERN = /\b((?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*)(['"]?)[^\s'"]+\2/giu;
const TOOL_SECRET_PATTERN = /\b((?:x-api-key|api-key|access_token|refresh_token|client_secret)\s*[:=]\s*)(['"]?)[^\s'"]+\2/giu;
const COMMON_API_KEY_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]*api[_-]?key[A-Za-z0-9_-]*[=:][A-Za-z0-9_-]{16,})\b/giu;

function isSensitiveKey(key: string, options?: RedactionOptions): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  const allKeys = new Set([...DEFAULT_SENSITIVE_KEYS, ...(options?.additionalKeys ?? [])]);

  for (const candidate of allKeys) {
    if (normalized === candidate.toLowerCase().replace(/[-_]/g, "")) {
      return true;
    }
  }

  return false;
}

function looksLikeSecret(value: string, options?: RedactionOptions): boolean {
  if (options?.strict !== true) return false;
  if (value.length < 24) return false;
  return HIGH_ENTROPY_PATTERN.test(value);
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(URL_CREDENTIAL_PATTERN, (_match, protocol: string) => `${protocol}${REDACTED}:${REDACTED}@`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(BASIC_AUTH_PATTERN, `Basic ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(ENV_SECRET_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(PASSWORD_ASSIGNMENT_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(TOOL_SECRET_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(COMMON_API_KEY_PATTERN, REDACTED);
}

export function redactValue(key: string, value: unknown, options?: RedactionOptions): unknown {
  if (typeof value === "string") {
    if (isSensitiveKey(key, options) || looksLikeSecret(value, options)) {
      return REDACTED;
    }
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(`${key}[${index}]`, item, options));
  }

  if (value !== null && typeof value === "object") {
    return redactObject(value, options);
  }

  return value;
}

export function redactObject(obj: unknown, options?: RedactionOptions): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => redactValue(`[${index}]`, item, options));
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    result[key] = redactValue(key, value, options);
  }

  return result;
}

export function redactJson(json: string, options?: RedactionOptions): string {
  try {
    const parsed = JSON.parse(json);
    return JSON.stringify(redactObject(parsed, options), null, 2);
  } catch {
    return redactString(json, options);
  }
}

export function redactString(input: string, options?: RedactionOptions): string {
  let result = redactSensitiveText(input);

  for (const key of DEFAULT_SENSITIVE_KEYS) {
    const pattern = new RegExp(`(["']?${key}["']?\\s*[:=]\\s*["']?)([^"'\\s&;]+)`, "gi");
    result = result.replace(pattern, `$1${REDACTED}`);
  }

  for (const key of options?.additionalKeys ?? []) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(["']?${escaped}["']?\\s*[:=]\\s*["']?)([^"'\\s&;]+)`, "gi");
    result = result.replace(pattern, `$1${REDACTED}`);
  }

  return result;
}
