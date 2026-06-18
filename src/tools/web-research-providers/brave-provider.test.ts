import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveRuntimeCredential } from "../../providers/runtime-credential-resolver.js";
import type { WebResearchFetch, WebResearchProvider } from "../web-research-provider.js";
import { braveProvider } from "./brave-provider.js";

function response(body: string, status = 200): Awaited<ReturnType<WebResearchFetch>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => body
  };
}

function configuredBrave(input: {
  apiKeyEnv?: string;
  fetch?: WebResearchFetch;
  credentialResolver?: Parameters<NonNullable<WebResearchProvider["configure"]>>[0]["credentialResolver"];
} = {}): WebResearchProvider {
  return braveProvider.configure?.({
    config: {
      brave: input.apiKeyEnv === undefined ? undefined : {
        apiKeyEnv: input.apiKeyEnv
      }
    },
    fetch: input.fetch ?? vi.fn(async () => response(JSON.stringify({ web: { results: [] } }))),
    credentialResolver: input.credentialResolver ?? resolveRuntimeCredential
  }) ?? braveProvider;
}

describe("braveProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is unavailable when no credential source resolves", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    await expect(braveProvider.getAvailability()).resolves.toEqual({
      available: false,
      reason: "Missing env var BRAVE_SEARCH_API_KEY"
    });
  });

  it("is available when the default env var resolves", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "default-token");

    await expect(braveProvider.getAvailability()).resolves.toEqual({
      available: true
    });
  });

  it("is available when the configured apiKeyEnv resolves", async () => {
    vi.stubEnv("CUSTOM_BRAVE_KEY", "custom-token");

    await expect(configuredBrave({ apiKeyEnv: "CUSTOM_BRAVE_KEY" }).getAvailability()).resolves.toEqual({
      available: true
    });
  });

  it("uses configured apiKeyEnv through the credential resolver", async () => {
    const credentialResolver = vi.fn(async () => ({
      credential: {
        kind: "bearer" as const,
        id: "CUSTOM_BRAVE_KEY",
        value: "custom-token",
        source: "env" as const
      },
      diagnostic: { ok: true }
    }));
    const fetch = vi.fn(async (_url: string, _init?: Parameters<WebResearchFetch>[1]) => response(JSON.stringify({
      web: {
        results: [{
          title: "Configured",
          url: "https://example.com/configured",
          description: "configured snippet"
        }]
      }
    })));
    const provider = configuredBrave({ apiKeyEnv: "CUSTOM_BRAVE_KEY", fetch, credentialResolver });

    await expect(provider.search?.("estacoda")).resolves.toEqual([{
      title: "Configured",
      url: "https://example.com/configured",
      snippet: "configured snippet"
    }]);
    expect(credentialResolver).toHaveBeenCalledWith({
      providerId: "brave",
      providerConfig: {
        apiKeyEnv: "CUSTOM_BRAVE_KEY"
      }
    });
  });

  it("sends the Brave endpoint, headers, and query params", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "default-token");
    const fetch = vi.fn(async () => response(JSON.stringify({
      web: {
        results: [{
          title: "Result",
          url: "https://example.com/result",
          description: "result snippet"
        }]
      }
    })));
    const provider = configuredBrave({ fetch });

    await provider.search?.("hello brave", { maxResults: 7 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, Parameters<WebResearchFetch>[1]];
    expect(url).toBe("https://api.search.brave.com/res/v1/web/search?q=hello+brave&count=7");
    expect(init).toMatchObject({
      method: "GET",
      headers: {
        "X-Subscription-Token": "default-token",
        Accept: "application/json"
      }
    });
  });

  it("caps count to 20", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "default-token");
    const fetch = vi.fn(async (_url: string, _init?: Parameters<WebResearchFetch>[1]) => response(JSON.stringify({ web: { results: [] } })));
    const provider = configuredBrave({ fetch });

    await provider.search?.("hello", { maxResults: 200 });

    const [url] = fetch.mock.calls[0] as [string, Parameters<WebResearchFetch>[1]];
    expect(url).toBe("https://api.search.brave.com/res/v1/web/search?q=hello&count=20");
  });

  it("maps description to snippet and does not expose a description field", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "default-token");
    const provider = configuredBrave({
      fetch: vi.fn(async () => response(JSON.stringify({
        web: {
          results: [{
            title: "Mapped",
            url: "https://example.com/mapped",
            description: "mapped snippet"
          }]
        }
      })))
    });

    const results = await provider.search?.("hello");

    expect(results).toEqual([{
      title: "Mapped",
      url: "https://example.com/mapped",
      snippet: "mapped snippet"
    }]);
    expect(results?.[0]).not.toHaveProperty("description");
  });

  it("handles empty results", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "default-token");
    const provider = configuredBrave({
      fetch: vi.fn(async () => response(JSON.stringify({ web: { results: [] } })))
    });

    await expect(provider.search?.("empty")).resolves.toEqual([]);
  });

  it("handles malformed results", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "default-token");
    const provider = configuredBrave({
      fetch: vi.fn(async () => response(JSON.stringify({ web: { results: [{ title: 123 }] } })))
    });

    await expect(provider.search?.("bad")).rejects.toThrow("Brave Search response contained malformed results.");
  });

  it.each([
    [401, "Brave Search authentication failed with HTTP 401."],
    [403, "Brave Search authorization failed with HTTP 403."],
    [429, "Brave Search rate limit exceeded with HTTP 429."],
    [500, "Brave Search request failed with HTTP 500."]
  ])("handles HTTP %s", async (status, message) => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret-token");
    const provider = configuredBrave({
      fetch: vi.fn(async () => response("{}", status))
    });

    await expect(provider.search?.("status")).rejects.toThrow(message);
    await expect(provider.search?.("status")).rejects.not.toThrow("secret-token");
  });

  it("handles network failure without exposing the token", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret-token");
    const provider = configuredBrave({
      fetch: vi.fn(async () => {
        throw new Error("network leaked secret-token");
      })
    });

    await expect(provider.search?.("network")).rejects.toThrow("Brave Search request failed.");
    await expect(provider.search?.("network")).rejects.not.toThrow("secret-token");
  });

  it("handles JSON parse failure", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret-token");
    const provider = configuredBrave({
      fetch: vi.fn(async () => response("{not json"))
    });

    await expect(provider.search?.("json")).rejects.toThrow("Brave Search returned invalid JSON.");
  });

  it("handles malformed responses", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret-token");
    const provider = configuredBrave({
      fetch: vi.fn(async () => response(JSON.stringify({ web: {} })))
    });

    await expect(provider.search?.("malformed")).rejects.toThrow("Brave Search response was malformed.");
  });

  it("respects AbortSignal", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret-token");
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal);
      const error = new Error("aborted secret-token");
      error.name = "AbortError";
      throw error;
    });
    const provider = configuredBrave({ fetch });

    await expect(provider.search?.("abort", { signal: controller.signal })).rejects.toThrow("Brave Search request was aborted.");
    await expect(provider.search?.("abort", { signal: controller.signal })).rejects.not.toThrow("secret-token");
  });
});
