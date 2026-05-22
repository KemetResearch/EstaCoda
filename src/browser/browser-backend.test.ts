import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserProvider } from "./browser-provider.js";
import {
  createBrowserBackendFromConfig,
  createLocalCdpBrowserBackend,
  createMockBrowserBackend,
  createUnconfiguredBrowserBackend,
  type CdpFetchLike
} from "./browser-backend.js";
import { registerBrowserProvider, resetBrowserProvidersForTest } from "./browser-registry.js";

function createCdpFetch(input: {
  ok: boolean;
  status: number;
  statusText: string;
  payload?: unknown;
}): CdpFetchLike {
  return vi.fn(async () => ({
    ok: input.ok,
    status: input.status,
    statusText: input.statusText,
    json: async () => input.payload ?? {},
    text: async () => JSON.stringify(input.payload ?? {})
  }));
}

describe("browser backend baselines", () => {
  afterEach(() => {
    resetBrowserProvidersForTest();
    vi.unstubAllEnvs();
  });

  it("returns stable shapes from every mock backend method", async () => {
    const backend = createMockBrowserBackend({
      sessionId: "session-1",
      title: "Mock Title",
      text: "Readable mock text."
    });

    expect(await Promise.resolve(backend.isAvailable())).toBe(true);
    expect(await backend.status()).toMatchObject({
      backend: "mock",
      available: true,
      browser: "Mock Title"
    });

    await expect(backend.navigate({ url: "https://example.com" })).resolves.toMatchObject({
      session: {
        id: "session-1",
        backend: "mock",
        currentUrl: "https://example.com",
        createdAt: "2026-04-18T00:00:00.000Z"
      },
      snapshot: {
        sessionId: "session-1",
        url: "https://example.com",
        title: "Mock Title",
        text: "Readable mock text.",
        elements: [{ ref: "@e1", role: "button", name: "Mock Button" }]
      }
    });

    await expect(backend.snapshot?.()).resolves.toMatchObject({
      sessionId: "session-1",
      url: "mock://browser",
      elements: [{ ref: "@e1", role: "button", name: "Mock Button" }]
    });
    await expect(backend.click?.({ ref: "@e1" })).resolves.toHaveProperty("sessionId", "session-1");
    await expect(backend.type?.({ ref: "@e1", text: "hello" })).resolves.toHaveProperty("sessionId", "session-1");
    await expect(backend.scroll?.({ direction: "down" })).resolves.toHaveProperty("sessionId", "session-1");
    await expect(backend.press?.({ key: "Enter" })).resolves.toHaveProperty("sessionId", "session-1");
    await expect(backend.back?.()).resolves.toHaveProperty("sessionId", "session-1");
    await expect(backend.getImages?.()).resolves.toEqual([{ src: "https://example.com/mock.png", alt: "Mock image" }]);
    await expect(backend.console?.()).resolves.toEqual([
      { level: "log", text: "Mock console entry", timestamp: "2026-04-18T00:00:00.000Z" }
    ]);
    await expect(backend.cdp?.({ method: "Runtime.evaluate", params: { expression: "1 + 1" } })).resolves.toEqual({
      method: "Runtime.evaluate",
      params: { expression: "1 + 1" }
    });
    await expect(backend.screenshot?.()).resolves.toEqual({
      mimeType: "image/png",
      base64: "iVBORw0KGgo="
    });
    await expect(backend.dialog?.({ action: "accept" })).resolves.toHaveProperty("sessionId", "session-1");
  });

  it("documents mock backend invalid-ref behavior as permissive", async () => {
    const backend = createMockBrowserBackend();

    await expect(backend.click?.({ ref: "not-a-ref" })).resolves.toMatchObject({
      sessionId: "mock-browser-session",
      url: "mock://browser"
    });
  });

  it("reports unconfigured backend unavailable and fails navigation", async () => {
    const backend = createUnconfiguredBrowserBackend({ reason: "No backend in this test." });

    expect(backend.isAvailable()).toBe(false);
    expect(await backend.status()).toEqual({
      backend: "unconfigured",
      available: false,
      reason: "No backend in this test."
    });
    await expect(backend.navigate({ url: "https://example.com" })).rejects.toThrow("No backend in this test.");
  });

  it("keeps legacy cloud backend values recognized but unavailable", async () => {
    for (const backendKind of ["browserbase", "firecrawl", "camofox"] as const) {
      const backend = createBrowserBackendFromConfig({ backend: backendKind });

      expect(backend.kind).toBe(backendKind);
      await expect(backend.isAvailable()).resolves.toBe(false);
      expect(await backend.status()).toMatchObject({
        backend: backendKind,
        available: false,
      });
      await expect(backend.navigate({ url: "https://example.com" })).rejects.toThrow();
    }
  });

  it("surfaces cloud provider missing env and not-implemented reasons", async () => {
    const missing = createBrowserBackendFromConfig({
      backend: "unconfigured",
      cloudProvider: "browserbase"
    });

    await expect(missing.status()).resolves.toMatchObject({
      backend: "unconfigured",
      available: false,
      reason: "BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID are missing."
    });

    vi.stubEnv("BROWSERBASE_API_KEY", "test-key");
    vi.stubEnv("BROWSERBASE_PROJECT_ID", "test-project");
    const configured = createBrowserBackendFromConfig({
      backend: "unconfigured",
      cloudProvider: "browserbase"
    });

    await expect(configured.status()).resolves.toMatchObject({
      backend: "unconfigured",
      available: false,
      reason: "Browserbase provider is registered but not yet implemented."
    });
  });

  it("surfaces unknown cloud provider status", async () => {
    const backend = createBrowserBackendFromConfig({
      backend: "unconfigured",
      cloudProvider: "unknown-cloud"
    });

    await expect(backend.status()).resolves.toEqual({
      backend: "unconfigured",
      available: false,
      reason: "Unknown browser provider: unknown-cloud."
    });
  });

  it("does not call createSession for unavailable cloud providers", async () => {
    const createSession = vi.fn<BrowserProvider["createSession"]>(async () => ({
      sessionName: "should-not-run",
      providerSessionId: "provider-session",
      cdpUrl: "wss://example.test/cdp",
      features: {}
    }));
    registerBrowserProvider({
      name: "offline-provider",
      displayName: "Offline Provider",
      getAvailability: () => ({ available: false, reason: "offline provider" }),
      createSession,
      closeSession: () => false,
      emergencyCleanup: () => undefined
    });
    const backend = createBrowserBackendFromConfig({
      backend: "unconfigured",
      cloudProvider: "offline-provider"
    });

    await expect(backend.status()).resolves.toMatchObject({
      available: false,
      reason: "offline provider"
    });
    await expect(backend.navigate({ url: "https://example.com" })).rejects.toThrow("offline provider");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("checks local CDP availability with a successful mocked fetch", async () => {
    const fetch = createCdpFetch({
      ok: true,
      status: 200,
      statusText: "OK",
      payload: {
        Browser: "Chrome/125.0.0.0",
        "Protocol-Version": "1.3"
      }
    });
    const backend = createLocalCdpBrowserBackend({
      cdpUrl: "http://127.0.0.1:9222/",
      fetch
    });

    await expect(backend.isAvailable()).resolves.toBe(true);
    await expect(backend.status()).resolves.toEqual({
      backend: "local-cdp",
      available: true,
      endpoint: "http://127.0.0.1:9222",
      browser: "Chrome/125.0.0.0",
      version: "1.3"
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:9222/json/version", expect.objectContaining({ method: "GET" }));
  });

  it("checks local CDP availability with a failing mocked fetch", async () => {
    const backend = createLocalCdpBrowserBackend({
      cdpUrl: "http://127.0.0.1:9222",
      fetch: createCdpFetch({
        ok: false,
        status: 503,
        statusText: "Service Unavailable"
      })
    });

    await expect(backend.isAvailable()).resolves.toBe(false);
    await expect(backend.status()).resolves.toEqual({
      backend: "local-cdp",
      available: false,
      endpoint: "http://127.0.0.1:9222",
      reason: "CDP endpoint returned 503 Service Unavailable"
    });
  });
});
