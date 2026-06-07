import { describe, expect, it } from "vitest";
import { BrowserbaseClient } from "./browserbase-client.js";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" }
  });
}

function makeFetch(responses: Response[]): { fetch: typeof globalThis.fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      init: init ?? {}
    });
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("unexpected fetch call");
    }
    return response;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function makeThrowingFetch(errorMessage: string): { fetch: typeof globalThis.fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      init: init ?? {}
    });
    throw new Error(errorMessage);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function makeClient(responses: Response[], options: { attempts?: number; baseUrl?: string } = {}) {
  const { fetch, calls } = makeFetch(responses);
  const delays: number[] = [];
  const client = new BrowserbaseClient({
    apiKey: "bb_test_secret",
    projectId: "project_123",
    baseUrl: options.baseUrl,
    fetch,
    retry: {
      attempts: options.attempts ?? 3,
      baseDelayMs: 10,
      delay: async (ms) => {
        delays.push(ms);
      }
    }
  });
  return { client, calls, delays };
}

function requestBody(call: FetchCall): unknown {
  expect(typeof call.init.body).toBe("string");
  return JSON.parse(call.init.body as string);
}

describe("BrowserbaseClient", () => {
  it("constructor rejects missing API key", () => {
    expect(() => new BrowserbaseClient({
      apiKey: " ",
      projectId: "project_123",
      fetch: makeFetch([]).fetch
    })).toThrow("Browserbase API key is required");
  });

  it("constructor rejects missing project ID", () => {
    expect(() => new BrowserbaseClient({
      apiKey: "bb_test_secret",
      projectId: " ",
      fetch: makeFetch([]).fetch
    })).toThrow("Browserbase project ID is required");
  });

  it("createSession sends the documented URL, method, headers, and body", async () => {
    const { client, calls } = makeClient([
      jsonResponse(201, { id: "session_123", connectUrl: "wss://connect.example" })
    ]);

    const session = await client.createSession();

    expect(session).toEqual({
      id: "session_123",
      cdpUrl: "wss://connect.example",
      raw: { id: "session_123", connectUrl: "wss://connect.example" }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.browserbase.com/v1/sessions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      "X-BB-API-Key": "bb_test_secret",
      "Content-Type": "application/json"
    });
    expect(requestBody(calls[0])).toEqual({ projectId: "project_123" });
  });

  it("createSession includes optional proxies, extensionId, and keepAlive only when provided", async () => {
    const { client, calls } = makeClient([
      jsonResponse(201, { id: "session_123", connectUrl: "wss://connect.example" })
    ]);

    await client.createSession({
      proxies: true,
      extension: "extension_123",
      keepAlive: true
    });

    expect(requestBody(calls[0])).toEqual({
      projectId: "project_123",
      proxies: true,
      extensionId: "extension_123",
      keepAlive: true
    });
  });

  it("createSession supports an override base URL", async () => {
    const { client, calls } = makeClient([
      jsonResponse(201, { id: "session_123", connectUrl: "wss://connect.example" })
    ], { baseUrl: "https://browserbase.test/" });

    await client.createSession();

    expect(calls[0].url).toBe("https://browserbase.test/v1/sessions");
  });

  it("fails closed when the response is missing session ID", async () => {
    const { client } = makeClient([
      jsonResponse(201, { connectUrl: "wss://connect.example" })
    ]);

    await expect(client.createSession()).rejects.toThrow("missing session id");
  });

  it("fails closed when the response is missing connectUrl", async () => {
    const { client } = makeClient([
      jsonResponse(201, { id: "session_123" })
    ]);

    await expect(client.createSession()).rejects.toThrow("missing connectUrl");
  });

  it("fails clearly on malformed JSON", async () => {
    const { client } = makeClient([
      textResponse(201, "{not-json")
    ]);

    await expect(client.createSession()).rejects.toThrow("returned malformed JSON");
  });

  it.each([401, 403])("throws a clear auth error for %s without leaking the API key", async (status) => {
    const { client } = makeClient([
      jsonResponse(status, { error: "bb_test_secret should not leak" })
    ]);

    let thrown: unknown;
    try {
      await client.createSession();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(`authentication error (${status})`);
    expect((thrown as Error).message).not.toContain("bb_test_secret");
  });

  it("does not leak API keys from thrown fetch errors", async () => {
    const { fetch } = makeThrowingFetch("request failed with X-BB-API-Key: bb_test_secret");
    const client = new BrowserbaseClient({
      apiKey: "bb_test_secret",
      projectId: "project_123",
      fetch,
      retry: {
        attempts: 1,
        baseDelayMs: 0,
        delay: async () => {}
      }
    });

    let thrown: unknown;
    try {
      await client.createSession();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Browserbase POST /v1/sessions network error.");
    expect((thrown as Error).message).not.toContain("bb_test_secret");
    expect((thrown as Error).message).not.toContain("X-BB-API-Key");
  });

  it("does not leak raw request details from thrown fetch errors", async () => {
    const { fetch } = makeThrowingFetch(
      "POST https://api.browserbase.com/v1/sessions headers={\"X-BB-API-Key\":\"bb_test_secret\"} body={\"projectId\":\"project_123\"}"
    );
    const client = new BrowserbaseClient({
      apiKey: "bb_test_secret",
      projectId: "project_123",
      fetch,
      retry: {
        attempts: 1,
        baseDelayMs: 0,
        delay: async () => {}
      }
    });

    let thrown: unknown;
    try {
      await client.createSession();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Browserbase POST /v1/sessions network error.");
    expect((thrown as Error).message).not.toContain("project_123");
    expect((thrown as Error).message).not.toContain("api.browserbase.com");
    expect((thrown as Error).message).not.toContain("X-BB-API-Key");
  });

  it("does not leak API keys or response bodies on HTTP errors", async () => {
    const { client } = makeClient([
      jsonResponse(400, { error: "raw response body bb_test_secret should not leak" })
    ]);

    let thrown: unknown;
    try {
      await client.createSession();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Browserbase POST /v1/sessions failed with HTTP 400.");
    expect((thrown as Error).message).not.toContain("bb_test_secret");
    expect((thrown as Error).message).not.toContain("raw response body");
  });

  it("retries 429 then succeeds", async () => {
    const { client, calls, delays } = makeClient([
      jsonResponse(429, { error: "rate limited" }),
      jsonResponse(201, { id: "session_123", connectUrl: "wss://connect.example" })
    ]);

    await expect(client.createSession()).resolves.toMatchObject({ id: "session_123" });
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([10]);
  });

  it("retries 429 then fails after bounded attempts", async () => {
    const { client, calls, delays } = makeClient([
      jsonResponse(429, {}),
      jsonResponse(429, {}),
      jsonResponse(429, {})
    ], { attempts: 3 });

    await expect(client.createSession()).rejects.toThrow("rate limit error (429)");
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([10, 20]);
  });

  it("retries 5xx then succeeds", async () => {
    const { client, calls, delays } = makeClient([
      jsonResponse(502, {}),
      jsonResponse(201, { id: "session_123", connectUrl: "wss://connect.example" })
    ]);

    await expect(client.createSession()).resolves.toMatchObject({ cdpUrl: "wss://connect.example" });
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([10]);
  });

  it("does not retry 400 responses", async () => {
    const { client, calls, delays } = makeClient([
      jsonResponse(400, { error: "bad request" }),
      jsonResponse(201, { id: "session_123", connectUrl: "wss://connect.example" })
    ]);

    await expect(client.createSession()).rejects.toThrow("HTTP 400");
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("getSession uses the documented endpoint", async () => {
    const raw = { id: "session_123", status: "RUNNING" };
    const { client, calls } = makeClient([
      jsonResponse(200, raw)
    ]);

    await expect(client.getSession("session_123")).resolves.toEqual(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.browserbase.com/v1/sessions/session_123");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toEqual({
      "X-BB-API-Key": "bb_test_secret"
    });
  });

  it("closeSession requests release through the documented update endpoint", async () => {
    const { client, calls } = makeClient([
      jsonResponse(200, { id: "session_123", status: "COMPLETED" })
    ]);

    await expect(client.closeSession("session_123")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.browserbase.com/v1/sessions/session_123");
    expect(calls[0].init.method).toBe("POST");
    expect(requestBody(calls[0])).toEqual({ status: "REQUEST_RELEASE" });
  });

  it("closeSession treats 404 as a deterministic non-success error", async () => {
    const { client } = makeClient([
      jsonResponse(404, { error: "missing" })
    ]);

    await expect(client.closeSession("session_123")).rejects.toThrow("HTTP 404");
  });

  it("does not perform real network calls unless a method is explicitly called", () => {
    const { calls } = makeClient([]);
    expect(calls).toEqual([]);
  });
});
