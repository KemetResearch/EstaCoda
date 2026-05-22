import { redactUrlForMetadata, scanUrlForSecrets } from "./url-safety.js";

export type BrowserDebugEvent = {
  event: string;
  data?: unknown;
};

export class BrowserDebugSession {
  readonly #enabled: boolean;
  readonly #events: BrowserDebugEvent[] = [];

  constructor(options: { enabled?: boolean } = {}) {
    this.#enabled = options.enabled ?? isBrowserDebugEnabled();
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  log(event: string, data?: unknown): void {
    if (!this.#enabled) {
      return;
    }
    this.#events.push({
      event: truncateString(event, 120),
      data: redactDebugValue(data)
    });
  }

  flush(): BrowserDebugEvent[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }
}

export function createBrowserDebugSession(options: { enabled?: boolean } = {}): BrowserDebugSession {
  return new BrowserDebugSession(options);
}

export function isBrowserDebugEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ESTACODA_BROWSER_DEBUG === "true" || env.ESTACODA_WEB_TOOLS_DEBUG === "true";
}

function redactDebugValue(value: unknown, path: string[] = [], depth = 0): unknown {
  if (depth > 8) {
    return "[TRUNCATED_DEPTH]";
  }
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return redactDebugString(value, path);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactDebugValue(entry, path, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    let count = 0;
    for (const [key, entry] of Object.entries(value)) {
      if (count >= 50) {
        output.__truncatedKeys = true;
        break;
      }
      count += 1;
      const nextPath = [...path, key];
      output[key] = shouldRedactValueForKey(key)
        ? redactionForKey(key)
        : redactDebugValue(entry, nextPath, depth + 1);
    }
    return output;
  }
  return "[UNSUPPORTED_DEBUG_VALUE]";
}

function shouldRedactValueForKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "authorization" ||
    normalized === "proxy-authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized === "x-api-key" ||
    normalized === "api-key" ||
    normalized === "apikey" ||
    normalized === "requestbody" ||
    normalized === "responsebody" ||
    normalized === "body" ||
    normalized === "expression" ||
    normalized === "functiondeclaration" ||
    normalized === "script" ||
    normalized === "source";
}

function redactionForKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === "expression" || normalized === "functiondeclaration" || normalized === "script" || normalized === "source") {
    return "[REDACTED_EXPRESSION]";
  }
  if (normalized === "body" || normalized === "requestbody" || normalized === "responsebody") {
    return "[REDACTED_BODY]";
  }
  return "[REDACTED_SECRET]";
}

function redactDebugString(value: string, path: string[]): string {
  if (path.some((part) => part.toLowerCase().includes("text") || part.toLowerCase().includes("content"))) {
    return truncateString(redactSecretsInString(value), 240);
  }
  return truncateString(redactSecretsInString(value), 800);
}

function redactSecretsInString(value: string): string {
  const maybeUrl = redactUrlString(value);
  return maybeUrl
    .replace(/\bBearer\s+[\w.\-~+/]+=*/giu, "Bearer [REDACTED]")
    .replace(/\bBasic\s+[\w.\-~+/]+=*/giu, "Basic [REDACTED]")
    .replace(/\bApiKey\s+[\w.\-~+/]+=*/giu, "ApiKey [REDACTED]")
    .replace(/\b(api[_-]?key|token|key)=([^&\s]+)/giu, "$1=[REDACTED]")
    .replace(/\b(?:sk-ant-|sk-proj-|sk-|ghp_|gho_|github_pat_)[A-Za-z0-9_\-]+/gu, "[REDACTED_SECRET]");
}

function redactUrlString(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>\\)]+/giu, (url) => redactSingleUrl(url));
}

function redactSingleUrl(url: string): string {
  if (scanUrlForSecrets(url) !== undefined) {
    return redactUrlForMetadata(url);
  }
  try {
    const parsed = new URL(url);
    parsed.username = parsed.username.length === 0 ? "" : "[REDACTED]";
    parsed.password = parsed.password.length === 0 ? "" : "[REDACTED]";
    return parsed.toString();
  } catch {
    return url;
  }
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}
