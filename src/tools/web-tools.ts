import type { RegisteredTool } from "../contracts/tool.js";
import type { BrowserActionInput, BrowserBackend, BrowserSnapshot, WebExtractionResult } from "../contracts/browser.js";
import { createUnconfiguredBrowserBackend } from "../browser/browser-backend.js";

export type WebToolOptions = {
  fetch?: FetchLike;
  browserBackend?: BrowserBackend;
  enableNetwork?: boolean;
  maxContentChars?: number;
};

export type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}>;

const DEFAULT_MAX_CONTENT_CHARS = 24_000;

export function createWebTools(options: WebToolOptions = {}): readonly RegisteredTool[] {
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const browserBackend = options.browserBackend ?? createUnconfiguredBrowserBackend();

  return [
    {
      name: "web.extract",
      description: "Fetch and extract readable text from a URL for research workflows.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          text: { type: "string" },
          maxContentChars: { type: "number" }
        }
      },
      riskClass: "read-only-network",
      toolsets: ["web", "research"],
      progressLabel: "extracting web content",
      maxResultSizeChars: maxContentChars,
      isAvailable: () => true,
      run: async (input: { url?: string; text?: string; maxContentChars?: number }, context) => {
        const url = normalizeUrl(input.url ?? extractFirstUrl(input.text ?? ""));

        if (url === undefined) {
          return {
            ok: false,
            content: "No URL found for web.extract.",
            metadata: {
              reason: "missing-url"
            }
          };
        }

        if (options.enableNetwork !== true) {
          return {
            ok: false,
            content: `web.extract is ready for ${url}, but network fetching is not enabled for this runtime.`,
            metadata: {
              url,
              reason: "network-disabled"
            }
          };
        }

        return extractWithFetch({
          url,
          fetch: options.fetch ?? globalThis.fetch,
          maxContentChars: Math.min(input.maxContentChars ?? maxContentChars, maxContentChars),
          signal: context?.signal
        });
      }
    },
    {
      name: "browser.status",
      description: "Check configured browser backend availability and endpoint details.",
      inputSchema: {
        type: "object",
        properties: {}
      },
      riskClass: "read-only-network",
      toolsets: ["browser", "core"],
      progressLabel: "checking browser backend",
      maxResultSizeChars: 3000,
      isAvailable: () => true,
      run: async () => {
        const status = await browserBackend.status();

        return {
          ok: true,
          content: [
            `Browser backend: ${status.backend}`,
            `Available: ${status.available ? "yes" : "no"}`,
            status.endpoint === undefined ? undefined : `Endpoint: ${status.endpoint}`,
            status.browser === undefined ? undefined : `Browser: ${status.browser}`,
            status.version === undefined ? undefined : `Protocol: ${status.version}`,
            status.reason === undefined ? undefined : `Reason: ${status.reason}`
          ].filter((line) => line !== undefined).join("\n"),
          metadata: status
        };
      }
    },
    createBrowserSnapshotTool(browserBackend),
    createBrowserActionTool({
      name: "browser.click",
      description: "Click an interactive browser element by ref from browser.snapshot.",
      progressLabel: "clicking browser element",
      browserBackend,
      method: "click",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          sessionId: { type: "string" }
        },
        required: ["ref"]
      }
    }),
    createBrowserActionTool({
      name: "browser.type",
      description: "Type text into an input element by ref from browser.snapshot.",
      progressLabel: "typing in browser",
      browserBackend,
      method: "type",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          text: { type: "string" },
          sessionId: { type: "string" }
        },
        required: ["ref", "text"]
      }
    }),
    createBrowserActionTool({
      name: "browser.scroll",
      description: "Scroll the current browser page up or down.",
      progressLabel: "scrolling browser",
      browserBackend,
      method: "scroll",
      inputSchema: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"] },
          amount: { type: "number" },
          sessionId: { type: "string" }
        }
      }
    }),
    createBrowserActionTool({
      name: "browser.press",
      description: "Press a keyboard key in the current browser page.",
      progressLabel: "pressing browser key",
      browserBackend,
      method: "press",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          sessionId: { type: "string" }
        }
      }
    }),
    createBrowserActionTool({
      name: "browser.back",
      description: "Navigate the current browser page back in history.",
      progressLabel: "going back in browser",
      browserBackend,
      method: "back",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" }
        }
      }
    }),
    {
      name: "browser.get_images",
      description: "List images on the current browser page with source URLs and alt text.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" }
        }
      },
      riskClass: "read-only-network",
      toolsets: ["browser", "web", "research"],
      progressLabel: "listing browser images",
      maxResultSizeChars: 5000,
      isAvailable: () => browserBackend.isAvailable(),
      run: async (input: BrowserActionInput) => {
        if (browserBackend.getImages === undefined) {
          return unsupportedBrowserTool(browserBackend, "browser.get_images");
        }
        const images = await browserBackend.getImages(input).catch((error: unknown) => ({ error }));
        if ("error" in images) {
          return {
            ok: false,
            content: images.error instanceof Error ? images.error.message : "Browser image listing failed.",
            metadata: { backend: browserBackend.kind }
          };
        }
        return {
          ok: true,
          content: images.length === 0
            ? "No images found on the current browser page."
            : images.map((image, index) => `${index + 1}. ${image.src}${image.alt === undefined ? "" : ` — ${image.alt}`}`).join("\n"),
          metadata: { backend: browserBackend.kind, images }
        };
      }
    },
    {
      name: "browser.navigate",
      description: "Navigate a browser backend to a URL and return a first snapshot when a backend is configured.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          text: { type: "string" }
        }
      },
      riskClass: "read-only-network",
      toolsets: ["browser", "web", "research"],
      progressLabel: "navigating browser",
      maxResultSizeChars: 4000,
      isAvailable: () => browserBackend.isAvailable(),
      run: async (input: { url?: string; text?: string }, context) => {
        const url = normalizeUrl(input.url ?? extractFirstUrl(input.text ?? ""));

        if (url === undefined) {
          return {
            ok: false,
            content: "No URL found for browser.navigate.",
            metadata: {
              reason: "missing-url",
              backend: "unconfigured"
            }
          };
        }

        if (!(await browserBackend.isAvailable())) {
          return {
            ok: false,
            content: [
              `Browser navigation requested for ${url}.`,
              "No browser backend is configured yet. Next backends to wire: local CDP, Firecrawl, Browserbase/Camofox."
            ].join("\n"),
            metadata: {
              url,
              backend: browserBackend.kind
            }
          };
        }

        if (context?.signal?.aborted === true) {
          return {
            ok: false,
            content: "Browser navigation cancelled.",
            metadata: {
              url,
              backend: browserBackend.kind,
              reason: "cancelled"
            }
          };
        }

        const result = await browserBackend.navigate({ url, signal: context?.signal }).catch((error: unknown) => ({
          error
        }));

        if ("error" in result) {
          return {
            ok: false,
            content: result.error instanceof Error ? result.error.message : "Browser navigation failed.",
            metadata: {
              url,
              backend: browserBackend.kind,
              reason: "navigation-failed"
            }
          };
        }

        return {
          ok: true,
          content: [
            `Browser: ${result.session.backend}`,
            `Session: ${result.session.id}`,
            `URL: ${result.snapshot.url}`,
            result.snapshot.title === undefined ? undefined : `Title: ${result.snapshot.title}`,
            "",
            renderBrowserSnapshot(result.snapshot)
          ].filter((line) => line !== undefined).join("\n"),
          metadata: {
            url,
            backend: result.session.backend,
            session: result.session,
            snapshot: result.snapshot
          }
        };
      }
    }
  ];
}

function createBrowserSnapshotTool(browserBackend: BrowserBackend): RegisteredTool {
  return {
    name: "browser.snapshot",
    description: "Get a text snapshot of the current browser page with interactive element refs like @e1.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      }
    },
    riskClass: "read-only-network",
    toolsets: ["browser", "web", "research"],
    progressLabel: "snapshotting browser",
    maxResultSizeChars: 8000,
    isAvailable: () => browserBackend.isAvailable(),
    run: async (input: BrowserActionInput) => {
      if (browserBackend.snapshot === undefined) {
        return unsupportedBrowserTool(browserBackend, "browser.snapshot");
      }
      const snapshot = await browserBackend.snapshot(input).catch((error: unknown) => ({ error }));
      if ("error" in snapshot) {
        return {
          ok: false,
          content: snapshot.error instanceof Error ? snapshot.error.message : "Browser snapshot failed.",
          metadata: { backend: browserBackend.kind }
        };
      }
      return {
        ok: true,
        content: renderBrowserSnapshot(snapshot),
        metadata: { backend: browserBackend.kind, snapshot }
      };
    }
  };
}

function createBrowserActionTool(input: {
  name: string;
  description: string;
  progressLabel: string;
  browserBackend: BrowserBackend;
  method: "click" | "type" | "scroll" | "press" | "back";
  inputSchema: RegisteredTool["inputSchema"];
}): RegisteredTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    riskClass: "read-only-network",
    toolsets: ["browser", "web", "research"],
    progressLabel: input.progressLabel,
    maxResultSizeChars: 8000,
    isAvailable: () => input.browserBackend.isAvailable(),
    run: async (toolInput: BrowserActionInput) => {
      const method = input.browserBackend[input.method];
      if (method === undefined) {
        return unsupportedBrowserTool(input.browserBackend, input.name);
      }
      const snapshot = await method(toolInput).catch((error: unknown) => ({ error }));
      if ("error" in snapshot) {
        return {
          ok: false,
          content: snapshot.error instanceof Error ? snapshot.error.message : `${input.name} failed.`,
          metadata: { backend: input.browserBackend.kind }
        };
      }
      return {
        ok: true,
        content: renderBrowserSnapshot(snapshot),
        metadata: { backend: input.browserBackend.kind, snapshot }
      };
    }
  };
}

function renderBrowserSnapshot(snapshot: BrowserSnapshot): string {
  const elements = snapshot.elements ?? [];
  return [
    snapshot.text,
    elements.length === 0 ? undefined : "",
    elements.length === 0 ? undefined : "Interactive elements:",
    ...elements.map((element) => `${element.ref} ${element.role ?? "element"} ${element.name ?? ""}`.trim())
  ].filter((line) => line !== undefined).join("\n");
}

function unsupportedBrowserTool(browserBackend: BrowserBackend, tool: string) {
  return {
    ok: false,
    content: `${tool} is not supported by the ${browserBackend.kind} browser backend yet.`,
    metadata: {
      backend: browserBackend.kind,
      reason: "unsupported-browser-tool"
    }
  };
}

async function extractWithFetch(input: {
  url: string;
  fetch: FetchLike;
  maxContentChars: number;
  signal?: AbortSignal;
}) {
  const { signal, cleanup } = createTimeoutSignal(30_000, input.signal);

  try {
    const response = await input.fetch(input.url, {
      method: "GET",
      headers: {
        "user-agent": "EstaCoda/2 web.extract"
      },
      signal
    });
    const raw = await response.text();
    const contentType = response.headers.get("content-type") ?? undefined;
    const extracted = extractReadableText(raw, contentType);
    const result: WebExtractionResult = {
      url: input.url,
      title: extractTitle(raw),
      content: truncate(extracted, input.maxContentChars),
      contentType,
      status: response.status,
      source: "fetch"
    };

    return {
      ok: response.ok,
      content: [
        `URL: ${result.url}`,
        result.title === undefined ? undefined : `Title: ${result.title}`,
        `Status: ${response.status} ${response.statusText}`,
        "",
        result.content
      ].filter((line) => line !== undefined).join("\n"),
      metadata: result
    };
  } catch (error) {
    return {
      ok: false,
      content: error instanceof Error ? error.message : "web.extract failed.",
      metadata: {
        url: input.url,
        reason: "fetch-failed"
      }
    };
  } finally {
    cleanup();
  }
}

export function extractFirstUrl(text: string): string | undefined {
  return /https?:\/\/[^\s<>"')]+/iu.exec(text)?.[0];
}

function normalizeUrl(url: string | undefined): string | undefined {
  if (url === undefined || url.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = new URL(url.trim());

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }

    return parsed.toString();
  } catch {
    return undefined;
  }
}

function createTimeoutSignal(timeoutMs: number, parentSignal: AbortSignal | undefined): {
  signal: AbortSignal;
  cleanup(): void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason);
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);

  if (parentSignal?.aborted === true) {
    abort();
  } else {
    parentSignal?.addEventListener("abort", abort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    }
  };
}

function extractReadableText(raw: string, contentType: string | undefined): string {
  if (contentType !== undefined && !/html|text|json|xml/i.test(contentType)) {
    return truncate(raw, DEFAULT_MAX_CONTENT_CHARS);
  }

  return raw
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractTitle(raw: string): string | undefined {
  const title = /<title[^>]*>(?<title>[\s\S]*?)<\/title>/iu.exec(raw)?.groups?.title
    ?.replace(/\s+/gu, " ")
    .trim();

  return title === undefined || title.length === 0 ? undefined : title;
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
