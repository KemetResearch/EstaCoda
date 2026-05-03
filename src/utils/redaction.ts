export type RedactionOptions = {
  /** Additional key names (case-insensitive) to redact beyond defaults. */
  additionalKeys?: string[];
  /** When true, also redact values that look like API keys/tokens even if key is unknown. */
  strict?: boolean;
};

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

// Matches common high-entropy token patterns (hex, base64-like, JWT-ish)
const HIGH_ENTROPY_PATTERN = /^(?:[a-zA-Z0-9+/=_-]{32,}|eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)$/;

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

export function redactValue(key: string, value: unknown, options?: RedactionOptions): unknown {
  if (typeof value === "string") {
    if (isSensitiveKey(key, options) || looksLikeSecret(value, options)) {
      return "[REDACTED]";
    }
    return value;
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
    // If JSON is malformed, fall back to basic string redaction
    return redactString(json, options);
  }
}

export function redactString(input: string, options?: RedactionOptions): string {
  // Simple regex-based redaction for non-JSON strings
  // Looks for key=value patterns with sensitive keys
  let result = input;

  for (const key of DEFAULT_SENSITIVE_KEYS) {
    const pattern = new RegExp(`(["']?${key}["']?\\s*[:=]\\s*["']?)([^"'\\s&;]+)`, "gi");
    result = result.replace(pattern, "$1[REDACTED]");
  }

  if (options?.strict) {
    // Redact Authorization/Bearer headers
    result = result.replace(/(Authorization:\s*Bearer\s+)(\S+)/gi, "$1[REDACTED]");
    result = result.replace(/(Authorization:\s*Basic\s+)(\S+)/gi, "$1[REDACTED]");
  }

  return result;
}
