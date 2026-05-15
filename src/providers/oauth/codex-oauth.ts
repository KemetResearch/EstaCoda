/**
 * Codex OAuth device flow against auth.openai.com.
 *
 * This module initiates the device-code authorization flow, polls for
 * the user to complete authorization, and exchanges the device code
 * for access/refresh tokens.
 */

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_AUTH_URL = "https://auth.openai.com/api/accounts/deviceauth/authorize";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export type CodexDeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type CodexTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

export type CodexTokenBundle = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes: string[];
};

export type CodexOAuthFlowResult =
  | { kind: "success"; tokens: CodexTokenBundle }
  | { kind: "cancelled" }
  | { kind: "timeout"; reason: string }
  | { kind: "error"; reason: string };

export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

function defaultFetch(): FetchLike {
  return async (url, init) => {
    const response = await globalThis.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: async () => response.json()
    };
  };
}

export async function requestCodexDeviceCode(
  fetchLike?: FetchLike
): Promise<CodexDeviceCodeResponse> {
  const fetchFn = fetchLike ?? defaultFetch();

  const body = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    scope: ""
  });

  const response = await fetchFn(DEVICE_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    throw new CodexOAuthError(
      `Device code request failed: ${response.status} ${response.statusText}`,
      { status: response.status }
    );
  }

  const parsed = parseDeviceCodeResponse(data);
  if (!parsed) {
    throw new CodexOAuthError("Device code response missing required fields.");
  }

  return parsed;
}

export async function pollCodexToken(
  deviceCode: string,
  options: {
    intervalSeconds: number;
    expiresInSeconds: number;
    signal?: AbortSignal;
    fetchLike?: FetchLike;
  }
): Promise<CodexTokenBundle> {
  const fetchFn = options.fetchLike ?? defaultFetch();
  const intervalMs = options.intervalSeconds * 1000;
  const deadline = Date.now() + Math.min(options.expiresInSeconds * 1000, POLL_TIMEOUT_MS);

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new CodexOAuthCancellation();
    }

    await sleep(intervalMs, options.signal);

    if (options.signal?.aborted) {
      throw new CodexOAuthCancellation();
    }

    const body = new URLSearchParams({
      client_id: CODEX_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    });

    const response = await fetchFn(DEVICE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    const data = await response.json();

    if (response.ok) {
      const parsed = parseTokenResponse(data);
      if (!parsed) {
        throw new CodexOAuthError("Token response missing access_token.");
      }
      return parsed;
    }

    // Continue polling on 403/404; stop on other errors
    if (response.status !== 403 && response.status !== 404) {
      const errorDesc = extractErrorDescription(data) || response.statusText;
      throw new CodexOAuthError(
        `Token poll failed: ${response.status} ${errorDesc}`,
        { status: response.status }
      );
    }
  }

  throw new CodexOAuthTimeout("Authorization timed out after 15 minutes.");
}

export async function runCodexOAuthFlow(
  options?: {
    fetchLike?: FetchLike;
    signal?: AbortSignal;
    onDeviceCode?: (info: {
      userCode: string;
      verificationUri: string;
      verificationUriComplete?: string;
    }) => void;
  }
): Promise<CodexOAuthFlowResult> {
  try {
    const deviceCode = await requestCodexDeviceCode(options?.fetchLike);

    if (options?.signal?.aborted) {
      return { kind: "cancelled" };
    }

    options?.onDeviceCode?.({
      userCode: deviceCode.user_code,
      verificationUri: deviceCode.verification_uri,
      verificationUriComplete: deviceCode.verification_uri_complete
    });

    const tokens = await pollCodexToken(deviceCode.device_code, {
      intervalSeconds: deviceCode.interval,
      expiresInSeconds: deviceCode.expires_in,
      signal: options?.signal,
      fetchLike: options?.fetchLike
    });

    return { kind: "success", tokens };
  } catch (error) {
    if (error instanceof CodexOAuthCancellation) {
      return { kind: "cancelled" };
    }
    if (error instanceof CodexOAuthTimeout) {
      return { kind: "timeout", reason: error.message };
    }
    if (error instanceof CodexOAuthError) {
      return { kind: "error", reason: error.message };
    }
    if (error instanceof Error) {
      return { kind: "error", reason: error.message };
    }
    return { kind: "error", reason: "Unknown error during Codex OAuth flow." };
  }
}

export function isCodexTokenExpired(record: { expiresAt?: string }): boolean {
  if (!record.expiresAt) return false;
  return new Date(record.expiresAt) <= new Date();
}

// ── Error types ──────────────────────────────────────────────────────────────

export class CodexOAuthError extends Error {
  status?: number;

  constructor(message: string, meta?: { status?: number }) {
    super(message);
    this.name = "CodexOAuthError";
    this.status = meta?.status;
  }
}

export class CodexOAuthCancellation extends Error {
  constructor() {
    super("OAuth flow cancelled.");
    this.name = "CodexOAuthCancellation";
  }
}

export class CodexOAuthTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexOAuthTimeout";
  }
}

// ── Response parsers ─────────────────────────────────────────────────────────

function parseDeviceCodeResponse(data: unknown): CodexDeviceCodeResponse | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.device_code !== "string") return null;
  if (typeof obj.user_code !== "string") return null;
  if (typeof obj.verification_uri !== "string") return null;
  if (typeof obj.expires_in !== "number") return null;
  if (typeof obj.interval !== "number") return null;

  return {
    device_code: obj.device_code,
    user_code: obj.user_code,
    verification_uri: obj.verification_uri,
    verification_uri_complete: typeof obj.verification_uri_complete === "string"
      ? obj.verification_uri_complete
      : undefined,
    expires_in: obj.expires_in,
    interval: obj.interval
  };
}

function parseTokenResponse(data: unknown): CodexTokenBundle | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.access_token !== "string") return null;

  const bundle: CodexTokenBundle = {
    accessToken: obj.access_token,
    scopes: []
  };

  if (typeof obj.refresh_token === "string") {
    bundle.refreshToken = obj.refresh_token;
  }

  if (typeof obj.expires_in === "number") {
    const expiry = new Date(Date.now() + obj.expires_in * 1000);
    bundle.expiresAt = expiry.toISOString();
  }

  if (typeof obj.scope === "string" && obj.scope.length > 0) {
    bundle.scopes = obj.scope.split(" ");
  }

  return bundle;
}

function extractErrorDescription(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  if (typeof obj.error_description === "string") return obj.error_description;
  if (typeof obj.error === "string") return obj.error;
  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CodexOAuthCancellation());
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new CodexOAuthCancellation());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
