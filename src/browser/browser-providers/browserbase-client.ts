export interface BrowserbaseClientOptions {
  apiKey: string;
  projectId: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  retry?: {
    attempts?: number;
    baseDelayMs?: number;
    delay?: (ms: number) => Promise<void>;
  };
}

export interface BrowserbaseCreateSessionOptions {
  proxies?: boolean;
  extension?: string;
  keepAlive?: boolean;
}

export interface BrowserbaseSession {
  id: string;
  cdpUrl: string;
  raw: unknown;
}

export class BrowserbaseClient {
  readonly #apiKey: string;
  readonly #projectId: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #retryAttempts: number;
  readonly #retryBaseDelayMs: number;
  readonly #delay: (ms: number) => Promise<void>;

  constructor(options: BrowserbaseClientOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) {
      throw new Error("Browserbase API key is required.");
    }

    const projectId = options.projectId.trim();
    if (projectId.length === 0) {
      throw new Error("Browserbase project ID is required.");
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("Browserbase client requires a fetch implementation.");
    }

    this.#apiKey = apiKey;
    this.#projectId = projectId;
    this.#baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.browserbase.com");
    this.#fetch = fetchImpl;
    this.#retryAttempts = Math.max(1, Math.floor(options.retry?.attempts ?? 3));
    this.#retryBaseDelayMs = Math.max(0, Math.floor(options.retry?.baseDelayMs ?? 250));
    this.#delay = options.retry?.delay ?? defaultDelay;
  }

  async createSession(options: BrowserbaseCreateSessionOptions = {}): Promise<BrowserbaseSession> {
    const body: Record<string, unknown> = {
      projectId: this.#projectId
    };

    if (options.proxies !== undefined) {
      body.proxies = options.proxies;
    }
    if (options.extension !== undefined) {
      body.extensionId = options.extension;
    }
    if (options.keepAlive !== undefined) {
      body.keepAlive = options.keepAlive;
    }

    const raw = await this.#requestJson("/v1/sessions", {
      method: "POST",
      json: body
    });

    return parseCreatedSession(raw);
  }

  async getSession(sessionId: string): Promise<unknown> {
    return await this.#requestJson(`/v1/sessions/${encodeSessionId(sessionId)}`, {
      method: "GET"
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.#requestJson(`/v1/sessions/${encodeSessionId(sessionId)}`, {
      method: "POST",
      json: { status: "REQUEST_RELEASE" }
    });
  }

  async #requestJson(path: string, request: { method: string; json?: unknown }): Promise<unknown> {
    const response = await this.#request(path, request);
    if (response.status === 204) {
      return undefined;
    }

    try {
      return await response.json();
    } catch {
      throw new Error(`Browserbase ${request.method} ${path} returned malformed JSON.`);
    }
  }

  async #request(path: string, request: { method: string; json?: unknown }): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.#retryAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(this.#url(path), {
          method: request.method,
          headers: this.#headers(request.json !== undefined),
          body: request.json === undefined ? undefined : JSON.stringify(request.json)
        });
      } catch {
        lastError = new Error(`Browserbase ${request.method} ${path} network error.`);
        if (attempt < this.#retryAttempts) {
          await this.#sleepBeforeRetry(attempt);
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return response;
      }

      const error = browserbaseHttpError(request.method, path, response.status);
      if (!shouldRetryStatus(response.status) || attempt >= this.#retryAttempts) {
        throw error;
      }

      lastError = error;
      await this.#sleepBeforeRetry(attempt);
    }

    throw lastError ?? new Error(`Browserbase ${request.method} ${path} failed.`);
  }

  #headers(hasBody: boolean): HeadersInit {
    const headers: Record<string, string> = {
      "X-BB-API-Key": this.#apiKey
    };
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  #url(path: string): string {
    return `${this.#baseUrl}${path}`;
  }

  async #sleepBeforeRetry(attempt: number): Promise<void> {
    if (this.#retryBaseDelayMs <= 0) {
      return;
    }
    await this.#delay(this.#retryBaseDelayMs * (2 ** (attempt - 1)));
  }
}

function parseCreatedSession(raw: unknown): BrowserbaseSession {
  if (!isRecord(raw)) {
    throw new Error("Browserbase create session returned an invalid response object.");
  }

  const id = raw.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Browserbase create session response is missing session id.");
  }

  const cdpUrl = raw.connectUrl;
  if (typeof cdpUrl !== "string" || cdpUrl.trim().length === 0) {
    throw new Error("Browserbase create session response is missing connectUrl.");
  }

  return {
    id,
    cdpUrl,
    raw
  };
}

function browserbaseHttpError(method: string, path: string, status: number): Error {
  if (status === 401 || status === 403) {
    return new Error(`Browserbase ${method} ${path} failed with authentication error (${status}).`);
  }
  if (status === 429) {
    return new Error(`Browserbase ${method} ${path} failed with rate limit error (429).`);
  }
  if (status >= 500) {
    return new Error(`Browserbase ${method} ${path} failed with server error (${status}).`);
  }
  return new Error(`Browserbase ${method} ${path} failed with HTTP ${status}.`);
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("Browserbase base URL is required.");
  }
  return trimmed.replace(/\/+$/, "");
}

function encodeSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (trimmed.length === 0) {
    throw new Error("Browserbase session ID is required.");
  }
  return encodeURIComponent(trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function defaultDelay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
