import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserProvider } from "./browser-provider.js";
import {
  getBrowserProvider,
  listBrowserProviders,
  registerBrowserProvider,
  registerDefaultBrowserProviders,
  resetBrowserProvidersForTest,
  selectBrowserProvider
} from "./browser-registry.js";

function provider(input: Partial<BrowserProvider> & Pick<BrowserProvider, "name">): BrowserProvider {
  return {
    displayName: input.name,
    getAvailability: () => ({ available: true }),
    createSession: vi.fn(async () => ({
      sessionName: "test-session",
      providerSessionId: "provider-session",
      cdpUrl: "wss://example.test/cdp",
      features: {}
    })),
    closeSession: () => false,
    emergencyCleanup: () => undefined,
    ...input
  };
}

describe("browser provider registry", () => {
  afterEach(() => {
    resetBrowserProvidersForTest();
    vi.unstubAllEnvs();
  });

  it("registers, lists, gets, and resets providers", () => {
    const custom = provider({ name: "custom" });

    registerBrowserProvider(custom);

    expect(listBrowserProviders()).toEqual([custom]);
    expect(getBrowserProvider("custom")).toBe(custom);

    resetBrowserProvidersForTest();

    expect(listBrowserProviders()).toEqual([]);
  });

  it("default registration is idempotent", () => {
    registerDefaultBrowserProviders();
    registerDefaultBrowserProviders();

    expect(listBrowserProviders().map((entry) => entry.name)).toEqual([
      "browser-use",
      "browserbase",
      "firecrawl",
      "camofox"
    ]);
  });

  it("returns explicit unavailable providers with their reason", async () => {
    registerBrowserProvider(provider({
      name: "offline",
      getAvailability: () => ({ available: false, reason: "offline for test" })
    }));

    await expect(selectBrowserProvider({ cloudProvider: "offline" })).resolves.toMatchObject({
      providerName: "offline",
      explicit: true,
      availability: {
        available: false,
        reason: "offline for test"
      }
    });
  });

  it("returns deterministic results for unknown and local configs", async () => {
    await expect(selectBrowserProvider({ cloudProvider: "missing" })).resolves.toMatchObject({
      providerName: "missing",
      explicit: true,
      availability: {
        available: false,
        reason: "Unknown browser provider: missing."
      }
    });
    await expect(selectBrowserProvider({ backend: "local-cdp" })).resolves.toEqual({
      availability: {
        available: false,
        reason: "No cloud browser provider selected."
      },
      explicit: false
    });
  });

  it("auto-detect skips unavailable providers and never selects Firecrawl", async () => {
    registerDefaultBrowserProviders();

    const selection = await selectBrowserProvider({});

    expect(selection).toEqual({
      availability: {
        available: false,
        reason: "No available cloud browser provider configured."
      },
      explicit: false
    });
    expect(selection.providerName).not.toBe("firecrawl");
  });

  it("does not auto-select Firecrawl even if registered as available", async () => {
    registerBrowserProvider(provider({ name: "firecrawl" }));

    await expect(selectBrowserProvider({})).resolves.toEqual({
      availability: {
        available: false,
        reason: "No available cloud browser provider configured."
      },
      explicit: false
    });
  });

  it("selects explicit and auto-detected available fake providers", async () => {
    registerBrowserProvider(provider({ name: "browser-use" }));
    registerBrowserProvider(provider({ name: "browserbase" }));
    registerBrowserProvider(provider({ name: "explicit" }));

    await expect(selectBrowserProvider({ cloudProvider: "explicit" })).resolves.toMatchObject({
      providerName: "explicit",
      explicit: true,
      availability: { available: true }
    });
    await expect(selectBrowserProvider({})).resolves.toMatchObject({
      providerName: "browser-use",
      explicit: false,
      availability: { available: true }
    });
  });

  it("provider stubs remain unavailable with missing and present env", async () => {
    registerDefaultBrowserProviders();

    expect(await getBrowserProvider("browserbase")?.getAvailability()).toEqual({
      available: false,
      reason: "BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID are missing."
    });
    vi.stubEnv("BROWSERBASE_API_KEY", "test-key");
    expect(await getBrowserProvider("browserbase")?.getAvailability()).toEqual({
      available: false,
      reason: "BROWSERBASE_PROJECT_ID is missing."
    });
    vi.stubEnv("BROWSERBASE_PROJECT_ID", "project");
    expect(await getBrowserProvider("browserbase")?.getAvailability()).toEqual({
      available: false,
      reason: "Browserbase provider is registered but not yet implemented."
    });

    expect(await getBrowserProvider("browser-use")?.getAvailability()).toEqual({
      available: false,
      reason: "BROWSER_USE_API_KEY is missing."
    });
    vi.stubEnv("BROWSER_USE_API_KEY", "test-key");
    expect(await getBrowserProvider("browser-use")?.getAvailability()).toEqual({
      available: false,
      reason: "browser-use provider is configured but not yet implemented."
    });

    expect(await getBrowserProvider("firecrawl")?.getAvailability()).toEqual({
      available: false,
      reason: "Firecrawl browser provider is registered for compatibility but not yet implemented; web research uses a separate provider."
    });
    expect(await getBrowserProvider("camofox")?.getAvailability()).toEqual({
      available: false,
      reason: "Camofox browser provider is registered but not yet implemented."
    });
  });

  it("provider stubs throw if createSession is called directly", async () => {
    registerDefaultBrowserProviders();

    await expect(getBrowserProvider("browserbase")?.createSession("task")).rejects.toThrow("not yet implemented");
    await expect(getBrowserProvider("browser-use")?.createSession("task")).rejects.toThrow("not yet implemented");
    await expect(getBrowserProvider("firecrawl")?.createSession("task")).rejects.toThrow("not yet implemented");
    await expect(getBrowserProvider("camofox")?.createSession("task")).rejects.toThrow("not yet implemented");
  });

  it("does not call createSession when selecting an unavailable provider", async () => {
    const createSession = vi.fn(async () => ({
      sessionName: "should-not-run",
      providerSessionId: "provider-session",
      cdpUrl: "wss://example.test/cdp",
      features: {}
    }));
    registerBrowserProvider(provider({
      name: "offline",
      getAvailability: () => ({ available: false, reason: "offline" }),
      createSession
    }));

    await expect(selectBrowserProvider({ cloudProvider: "offline" })).resolves.toMatchObject({
      providerName: "offline",
      availability: { available: false, reason: "offline" }
    });
    expect(createSession).not.toHaveBeenCalled();
  });
});
