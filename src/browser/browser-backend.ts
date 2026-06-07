import type { BrowserActionInput, BrowserBackend, BrowserBackendStatus, BrowserConsoleEntry, BrowserNavigateInput, BrowserNavigateResult, BrowserScreenshotResult, BrowserSnapshot } from "../contracts/browser.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import { connectCdp, type CdpClient, type CdpFetchLike, type CdpWebSocketFactory } from "./cdp-client.js";
import { evaluateCdpSnapshot } from "./cdp-supervisor.js";
import { registerDefaultBrowserProviders, selectBrowserProvider } from "./browser-registry.js";
import { createSupervisedLocalCdpBrowserBackend } from "./supervised-local-cdp-backend.js";
import type { ResolveHostnameFn } from "./url-safety.js";

export type { CdpFetchLike, CdpWebSocketEvent, CdpWebSocketFactory, CdpWebSocketLike } from "./cdp-client.js";

export type UnconfiguredBrowserBackendOptions = {
  reason?: string;
};

export function createUnconfiguredBrowserBackend(options: UnconfiguredBrowserBackendOptions = {}): BrowserBackend {
  return {
    kind: "unconfigured",
    isAvailable: () => false,
    status: () => ({
      backend: "unconfigured",
      available: false,
      reason: options.reason ?? "No browser backend is configured."
    }),
    async navigate(input: BrowserNavigateInput): Promise<BrowserNavigateResult> {
      throw new Error(options.reason ?? `No browser backend is configured for ${input.url}.`);
    }
  };
}

export function createMockBrowserBackend(input: {
  sessionId?: string;
  title?: string;
  text?: string;
} = {}): BrowserBackend {
  const sessionId = input.sessionId ?? "mock-browser-session";
  const snapshot = (url = "mock://browser"): BrowserSnapshot => ({
    sessionId,
    url,
    title: input.title ?? "Mock Browser Page",
    text: input.text ?? `Mock browser snapshot for ${url}.`,
    elements: [{ ref: "@e1", role: "button", name: "Mock Button" }]
  });

  return {
    kind: "mock",
    isAvailable: () => true,
    status: () => ({
      backend: "mock",
      available: true,
      browser: input.title ?? "Mock Browser"
    }),
    async navigate(request) {
      return {
        session: {
          id: request.sessionId ?? sessionId,
          backend: "mock",
          currentUrl: request.url,
          createdAt: new Date("2026-04-18T00:00:00.000Z").toISOString()
        },
        snapshot: snapshot(request.url)
      };
    },
    snapshot: async () => snapshot(),
    click: async () => snapshot(),
    type: async () => snapshot(),
    scroll: async () => snapshot(),
    press: async () => snapshot(),
    back: async () => snapshot(),
    getImages: async () => [{ src: "https://example.com/mock.png", alt: "Mock image" }],
    console: async () => [{ level: "log", text: "Mock console entry", timestamp: "2026-04-18T00:00:00.000Z" }],
    cdp: async (request) => ({ method: request.method ?? "Mock.method", params: request.params ?? {} }),
    screenshot: async () => ({
      mimeType: "image/png",
      base64: "iVBORw0KGgo="
    }),
    dialog: async () => snapshot()
  };
}

export type LocalCdpBrowserBackendOptions = {
  cdpUrl?: string;
  launchCommand?: string;
  launchExecutable?: string;
  launchArgs?: string[];
  chromeFlags?: string[];
  autoLaunch?: boolean;
  fetch?: CdpFetchLike;
  webSocketFactory?: CdpWebSocketFactory;
};

export function createLocalCdpBrowserBackend(options: LocalCdpBrowserBackendOptions = {}): BrowserBackend {
  const endpoint = normalizeCdpUrl(options.cdpUrl);
  const sessions = new Map<string, {
    id: string;
    webSocketDebuggerUrl: string;
  }>();
  let latestSessionId: string | undefined;

  return {
    kind: "local-cdp",
    isAvailable: async () => (await checkLocalCdpStatus(endpoint, options.fetch)).available,
    status: () => checkLocalCdpStatus(endpoint, options.fetch),
    async navigate(input) {
      return navigateWithLocalCdp({
        endpoint,
        input,
        fetch: options.fetch,
        webSocketFactory: options.webSocketFactory,
        sessions,
        setLatestSessionId: (sessionId) => {
          latestSessionId = sessionId;
        }
      });
    },
    snapshot: (input) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client, sessionId) => evaluateCdpSnapshot(client, sessionId)
    }),
    click: (input) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client, sessionId) => {
        await client.send("Runtime.evaluate", {
          expression: refActionExpression(input.ref, "click"),
          awaitPromise: true
        });
        return evaluateCdpSnapshot(client, sessionId);
      }
    }),
    type: (input) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client, sessionId) => {
        await client.send("Runtime.evaluate", {
          expression: refActionExpression(input.ref, "type", input.text ?? ""),
          awaitPromise: true
        });
        return evaluateCdpSnapshot(client, sessionId);
      }
    }),
    scroll: (input) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client, sessionId) => {
        const amount = input.amount ?? 700;
        const delta = input.direction === "up" ? -amount : amount;
        await client.send("Runtime.evaluate", {
          expression: `window.scrollBy(0, ${JSON.stringify(delta)}); "ok";`,
          returnByValue: true
        });
        return evaluateCdpSnapshot(client, sessionId);
      }
    }),
    press: (input) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client, sessionId) => {
        const key = input.key ?? "Enter";
        await client.send("Input.dispatchKeyEvent", { type: "keyDown", key });
        await client.send("Input.dispatchKeyEvent", { type: "keyUp", key });
        return evaluateCdpSnapshot(client, sessionId);
      }
    }),
    back: (input = {}) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client, sessionId) => {
        await client.send("Runtime.evaluate", {
          expression: "history.back(); 'ok';",
          returnByValue: true
        });
        await client.waitFor("Page.loadEventFired", 2_000).catch(() => undefined);
        return evaluateCdpSnapshot(client, sessionId);
      }
    }),
    getImages: (input = {}) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client) => {
        const evaluated = await client.send("Runtime.evaluate", {
          expression: "JSON.stringify(Array.from(document.images).slice(0, 100).map((img) => ({ src: img.currentSrc || img.src, alt: img.alt || undefined })))",
          returnByValue: true
        }) as { result?: { value?: unknown } };
        return parseJsonArray(evaluated.result?.value);
      }
    }),
    console: (input = {}) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client) => {
        await ensureConsoleCapture(client);
        const evaluated = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const logs = Array.isArray(window.__estacodaConsoleLogs) ? window.__estacodaConsoleLogs : [];
            ${input.clear === true ? "window.__estacodaConsoleLogs = [];" : ""}
            return JSON.stringify(logs.slice(-200));
          })()`,
          returnByValue: true
        }) as { result?: { value?: unknown } };
        return parseConsoleEntries(evaluated.result?.value);
      }
    }),
    cdp: (input) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client) => {
        if (input.method === undefined || input.method.trim().length === 0) {
          throw new Error("browser.cdp requires a CDP method.");
        }
        return await client.send(input.method, input.params);
      }
    }),
    screenshot: (input = {}) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client) => {
        const result = await client.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true
        }) as { data?: unknown };
        if (typeof result.data !== "string") {
          throw new Error("CDP screenshot did not return image data.");
        }
        return {
          mimeType: "image/png",
          base64: result.data
        } satisfies BrowserScreenshotResult;
      }
    }),
    dialog: (input = {}) => runCdpSessionAction({
      sessions,
      latestSessionId,
      input,
      webSocketFactory: options.webSocketFactory,
      action: async (client, sessionId) => {
        await client.send("Page.handleJavaScriptDialog", {
          accept: input.action !== "dismiss",
          promptText: input.promptText ?? ""
        });
        return evaluateCdpSnapshot(client, sessionId);
      }
    })
  };
}

async function runCdpSessionAction<T>(input: {
  sessions: Map<string, { id: string; webSocketDebuggerUrl: string }>;
  latestSessionId: string | undefined;
  input: BrowserActionInput | undefined;
  webSocketFactory: CdpWebSocketFactory | undefined;
  action(client: CdpClient, sessionId: string): Promise<T>;
}): Promise<T> {
  const sessionId = input.input?.sessionId ?? input.latestSessionId;
  if (sessionId === undefined) {
    throw new Error("No active browser session. Call browser.navigate first.");
  }
  const session = input.sessions.get(sessionId);
  if (session === undefined) {
    throw new Error(`Browser session not found: ${sessionId}`);
  }
  const client = await connectCdp({
    webSocketUrl: session.webSocketDebuggerUrl,
    webSocketFactory: input.webSocketFactory
  });
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await ensureConsoleCapture(client);
    return await input.action(client, session.id);
  } finally {
    client.close();
  }
}

async function ensureConsoleCapture(client: CdpClient): Promise<void> {
  await client.send("Runtime.evaluate", {
    expression: `(() => {
      if (window.__estacodaConsoleInstalled) return 'already-installed';
      window.__estacodaConsoleInstalled = true;
      window.__estacodaConsoleLogs = window.__estacodaConsoleLogs || [];
      for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const original = console[level]?.bind(console);
        if (!original) continue;
        console[level] = (...args) => {
          try {
            window.__estacodaConsoleLogs.push({
              level,
              text: args.map((arg) => {
                if (typeof arg === 'string') return arg;
                try { return JSON.stringify(arg); } catch { return String(arg); }
              }).join(' '),
              timestamp: new Date().toISOString()
            });
          } catch {}
          return original(...args);
        };
      }
      return 'installed';
    })()`,
    returnByValue: true
  });
}

function refActionExpression(ref: string | undefined, action: "click" | "type", text = ""): string {
  const index = refToIndex(ref);
  if (action === "click") {
    return `(() => { const el = window.__estacodaElements?.[${index}]; if (!el) throw new Error('Browser element ref not found: ${ref ?? ""}'); el.click(); return 'clicked'; })()`;
  }
  return `(() => { const el = window.__estacodaElements?.[${index}]; if (!el) throw new Error('Browser element ref not found: ${ref ?? ""}'); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'typed'; })()`;
}

function refToIndex(ref: string | undefined): number {
  const match = /^@?e(\d+)$/u.exec(ref ?? "");
  if (match === null) {
    throw new Error(`Invalid browser element ref: ${ref ?? ""}`);
  }
  return Number(match[1]) - 1;
}

function parseJsonArray(value: unknown): Array<{ src: string; alt?: string }> {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as Array<{ src?: string; alt?: string }>;
    return parsed.flatMap((entry) => entry.src === undefined ? [] : [{ src: entry.src, alt: entry.alt }]);
  } catch {
    return [];
  }
}

function parseConsoleEntries(value: unknown): BrowserConsoleEntry[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as Array<Partial<BrowserConsoleEntry>>;
    return parsed.map((entry) => ({
      level: entry.level ?? "log",
      text: entry.text ?? "",
      timestamp: entry.timestamp
    }));
  } catch {
    return [];
  }
}

async function navigateWithLocalCdp(input: {
  endpoint: string | undefined;
  input: BrowserNavigateInput;
  fetch: CdpFetchLike | undefined;
  webSocketFactory: CdpWebSocketFactory | undefined;
  sessions: Map<string, { id: string; webSocketDebuggerUrl: string }>;
  setLatestSessionId(sessionId: string): void;
}): Promise<BrowserNavigateResult> {
  if (input.endpoint === undefined) {
    throw new Error("CDP URL is not configured.");
  }

  const target = await createCdpTarget({
    endpoint: input.endpoint,
    url: input.input.url,
    fetch: input.fetch
  });
  const client = await connectCdp({
    webSocketUrl: target.webSocketDebuggerUrl,
    webSocketFactory: input.webSocketFactory
  });

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await ensureConsoleCapture(client);
    await client.send("Page.navigate", {
      url: input.input.url
    });
    await client.waitFor("Page.loadEventFired", 5_000).catch(() => undefined);

    const sessionId = input.input.sessionId ?? target.id ?? `cdp-${Date.now()}`;
    const snapshot = await evaluateCdpSnapshot(client, sessionId);
    input.sessions.set(sessionId, {
      id: sessionId,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl
    });
    input.setLatestSessionId(sessionId);

    return {
      session: {
        id: sessionId,
        backend: "local-cdp",
        currentUrl: snapshot.url,
        createdAt: new Date().toISOString()
      },
      snapshot
    };
  } finally {
    client.close();
  }
}

async function createCdpTarget(input: {
  endpoint: string;
  url: string;
  fetch: CdpFetchLike | undefined;
}): Promise<{
  id?: string;
  url?: string;
  webSocketDebuggerUrl: string;
}> {
  const fetchLike = input.fetch ?? globalThis.fetch;
  const encodedUrl = encodeURIComponent(input.url);
  const created = await fetchLike(`${input.endpoint}/json/new?${encodedUrl}`, {
    method: "PUT"
  });

  if (created.ok) {
    const payload = await created.json() as {
      id?: string;
      url?: string;
      webSocketDebuggerUrl?: string;
    };

    if (payload.webSocketDebuggerUrl !== undefined) {
      return {
        id: payload.id,
        url: payload.url,
        webSocketDebuggerUrl: payload.webSocketDebuggerUrl
      };
    }
  }

  const listed = await fetchLike(`${input.endpoint}/json/list`, {
    method: "GET"
  });

  if (!listed.ok) {
    throw new Error(`CDP target discovery failed with ${listed.status} ${listed.statusText}`);
  }

  const targets = await listed.json() as Array<{
    id?: string;
    url?: string;
    type?: string;
    webSocketDebuggerUrl?: string;
  }>;
  const target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl !== undefined)
    ?? targets.find((candidate) => candidate.webSocketDebuggerUrl !== undefined);

  if (target?.webSocketDebuggerUrl === undefined) {
    throw new Error("CDP target discovery did not return a debuggable page target.");
  }

  return {
    id: target.id,
    url: target.url,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl
  };
}

async function checkLocalCdpStatus(endpoint: string | undefined, fetchLike: CdpFetchLike | undefined): Promise<BrowserBackendStatus> {
  if (endpoint === undefined) {
    return {
      backend: "local-cdp",
      available: false,
      reason: "CDP URL is not configured."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  try {
    const response = await (fetchLike ?? globalThis.fetch)(`${endpoint}/json/version`, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        backend: "local-cdp",
        available: false,
        endpoint,
        reason: `CDP endpoint returned ${response.status} ${response.statusText}`
      };
    }

    const payload = await response.json() as {
      Browser?: string;
      "Protocol-Version"?: string;
    };

    return {
      backend: "local-cdp",
      available: true,
      endpoint,
      browser: payload.Browser,
      version: payload["Protocol-Version"]
    };
  } catch (error) {
    return {
      backend: "local-cdp",
      available: false,
      endpoint,
      reason: error instanceof Error ? error.message : "CDP status check failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCdpUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value.trim().replace(/\/$/, "");
}

export function createBrowserBackendFromConfig(config: {
  backend: "local-cdp" | "browserbase" | "firecrawl" | "camofox" | "mock" | "unconfigured";
  cloudProvider?: string;
  cdpUrl?: string;
  launchCommand?: string;
  launchExecutable?: string;
  launchArgs?: string[];
  chromeFlags?: string[];
  autoLaunch?: boolean;
  fetch?: CdpFetchLike;
  webSocketFactory?: CdpWebSocketFactory;
  supervised?: boolean;
  securityConfig?: Pick<LoadedRuntimeConfig["security"], "allowPrivateUrls" | "websiteBlocklist">;
  resolveHostname?: ResolveHostnameFn;
}): BrowserBackend {
  switch (config.backend) {
    case "local-cdp":
      if (config.supervised === true) {
        return createSupervisedLocalCdpBrowserBackend({
          cdpUrl: config.cdpUrl,
          launchCommand: config.launchCommand,
          launchExecutable: config.launchExecutable,
          launchArgs: config.launchArgs,
          chromeFlags: config.chromeFlags,
          autoLaunch: config.autoLaunch,
          fetch: config.fetch,
          webSocketFactory: config.webSocketFactory,
          securityConfig: config.securityConfig,
          resolveHostname: config.resolveHostname
        });
      }
      return createLocalCdpBrowserBackend({
        cdpUrl: config.cdpUrl,
        launchCommand: config.launchCommand,
        launchExecutable: config.launchExecutable,
        launchArgs: config.launchArgs,
        chromeFlags: config.chromeFlags,
        autoLaunch: config.autoLaunch,
        fetch: config.fetch,
        webSocketFactory: config.webSocketFactory
      });
    case "unconfigured":
      if (config.cloudProvider !== undefined) {
        return createCloudProviderStatusBackend({
          backend: "unconfigured",
          cloudProvider: config.cloudProvider
        });
      }
      return createUnconfiguredBrowserBackend();
    case "browserbase":
    case "firecrawl":
    case "camofox":
      return createCloudProviderStatusBackend({
        backend: config.backend,
        cloudProvider: config.cloudProvider ?? config.backend
      });
    default:
      return createUnconfiguredBrowserBackend({
        reason: `${config.backend} browser backend is recognized but not implemented in this release.`
      });
  }
}

function createCloudProviderStatusBackend(config: {
  backend: "browserbase" | "firecrawl" | "camofox" | "unconfigured";
  cloudProvider: string;
}): BrowserBackend {
  registerDefaultBrowserProviders();

  const status = async (): Promise<BrowserBackendStatus> => {
    const selection = await selectBrowserProvider({
      backend: config.backend,
      cloudProvider: config.cloudProvider
    });
    const providerLabel = selection.providerName ?? config.cloudProvider;
    const reason = selection.availability.available
      ? `${providerLabel} browser provider is available, but cloud browser sessions are not implemented in this release.`
      : selection.availability.reason ?? `${providerLabel} browser provider is unavailable.`;

    return {
      backend: config.backend,
      available: false,
      reason
    };
  };

  return {
    kind: config.backend,
    isAvailable: async () => false,
    status,
    async navigate(input) {
      const current = await status();
      throw new Error(current.reason ?? `No cloud browser backend is configured for ${input.url}.`);
    }
  };
}
