/**
 * Codex OAuth device flow against auth.openai.com.
 *
 * Codex uses OpenAI's device auth endpoints rather than the standard
 * RFC 8628 device-code grant. The flow is:
 * request user code -> poll for authorization code -> exchange for tokens.
 */

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_USER_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
const CODEX_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export type CodexDeviceCodeResponse = {
  user_code: string;
  device_auth_id: string;
  interval: number;
  expires_in?: number;
};

export type CodexAuthorizationCodeResponse = {
  authorization_code: string;
  code_verifier: string;
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

export function codexDeviceVerificationUrl(): string {
  return CODEX_DEVICE_VERIFICATION_URL;
}

export async function requestCodexDeviceCode(
  fetchLike?: FetchLike
): Promise<CodexDeviceCodeResponse> {
  const fetchFn = fetchLike ?? defaultFetch();

  const response = await fetchFn(DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID })
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

export async function pollCodexAuthorizationCode(
  deviceAuthId: string,
  userCode: string,
  options: {
    intervalSeconds: number;
    signal?: AbortSignal;
    fetchLike?: FetchLike;
    timeoutMs?: number;
  }
): Promise<CodexAuthorizationCodeResponse> {
  const fetchFn = options.fetchLike ?? defaultFetch();
  const intervalMs = Math.max(options.intervalSeconds, 0) * 1000;
  const deadline = Date.now() + Math.min(options.timeoutMs ?? POLL_TIMEOUT_MS, POLL_TIMEOUT_MS);

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new CodexOAuthCancellation();
    }

    await sleep(intervalMs, options.signal);

    if (options.signal?.aborted) {
      throw new CodexOAuthCancellation();
    }

    const response = await fetchFn(DEVICE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode
      })
    });

    const data = await response.json();

    if (response.ok) {
      const parsed = parseAuthorizationCodeResponse(data);
      if (!parsed) {
        throw new CodexOAuthError("Authorization response missing required fields.");
      }
      return parsed;
    }

    // Continue polling while the user has not approved the device code.
    if (response.status !== 403 && response.status !== 404) {
      throw new CodexOAuthError(
        `Authorization poll failed: ${response.status} ${response.statusText}`,
        { status: response.status }
      );
    }
  }

  throw new CodexOAuthTimeout("Authorization timed out after 15 minutes.");
}

export async function exchangeCodexAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
  options?: {
    fetchLike?: FetchLike;
  }
): Promise<CodexTokenBundle> {
  const fetchFn = options?.fetchLike ?? defaultFetch();
  const body = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    grant_type: "authorization_code",
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: CODEX_REDIRECT_URI
  });

  const response = await fetchFn(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    throw new CodexOAuthError(
      `Token exchange failed: ${response.status} ${response.statusText}`,
      { status: response.status }
    );
  }

  const parsed = parseTokenResponse(data);
  if (!parsed) {
    throw new CodexOAuthError("Token response missing access_token.");
  }

  return parsed;
}

export async function runCodexOAuthFlow(
  options?: {
    fetchLike?: FetchLike;
    signal?: AbortSignal;
    onDeviceCode?: (info: {
      userCode: string;
      verificationUri: string;
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
      verificationUri: CODEX_DEVICE_VERIFICATION_URL
    });

    const authorization = await pollCodexAuthorizationCode(
      deviceCode.device_auth_id,
      deviceCode.user_code,
      {
        intervalSeconds: deviceCode.interval,
        signal: options?.signal,
        fetchLike: options?.fetchLike,
        timeoutMs: typeof deviceCode.expires_in === "number"
          ? deviceCode.expires_in * 1000
          : undefined
      }
    );

    const tokens = await exchangeCodexAuthorizationCode(
      authorization.authorization_code,
      authorization.code_verifier,
      { fetchLike: options?.fetchLike }
    );

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
      return { kind: "error", reason: "Unexpected error during Codex OAuth flow." };
    }
    return { kind: "error", reason: "Unknown error during Codex OAuth flow." };
  }
}

export function isCodexTokenExpired(record: { expiresAt?: string }): boolean {
  if (!record.expiresAt) return false;
  return new Date(record.expiresAt) <= new Date();
}

// -- Error types --------------------------------------------------------------

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

// -- Response parsers ---------------------------------------------------------

function parseDeviceCodeResponse(data: unknown): CodexDeviceCodeResponse | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.user_code !== "string" || obj.user_code.length === 0) return null;
  if (typeof obj.device_auth_id !== "string" || obj.device_auth_id.length === 0) return null;
  if (obj.interval !== undefined && typeof obj.interval !== "number") return null;
  if (obj.expires_in !== undefined && typeof obj.expires_in !== "number") return null;

  const response: CodexDeviceCodeResponse = {
    user_code: obj.user_code,
    device_auth_id: obj.device_auth_id,
    interval: typeof obj.interval === "number" ? obj.interval : DEFAULT_POLL_INTERVAL_SECONDS
  };
  if (typeof obj.expires_in === "number") {
    response.expires_in = obj.expires_in;
  }
  return response;
}

function parseAuthorizationCodeResponse(data: unknown): CodexAuthorizationCodeResponse | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.authorization_code !== "string" || obj.authorization_code.length === 0) return null;
  if (typeof obj.code_verifier !== "string" || obj.code_verifier.length === 0) return null;

  return {
    authorization_code: obj.authorization_code,
    code_verifier: obj.code_verifier
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
