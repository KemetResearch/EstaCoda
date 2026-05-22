import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserBackend } from "../contracts/browser.js";
import { createMockBrowserBackend, createUnconfiguredBrowserBackend } from "../browser/browser-backend.js";
import { createWebTools, type FetchLike } from "./web-tools.js";

const expectedToolNames = [
  "web.extract",
  "browser.status",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.scroll",
  "browser.press",
  "browser.back",
  "browser.get_images",
  "browser.console",
  "browser.cdp",
  "browser.screenshot",
  "browser.vision",
  "browser.dialog",
  "browser.navigate"
];

function tool(name: string, tools = createWebTools()) {
  const found = tools.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`Missing tool ${name}`);
  }
  return found;
}

function createFetchResponse(input: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string | null;
  body: string;
}): Awaited<ReturnType<FetchLike>> {
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    statusText: input.statusText ?? "OK",
    headers: {
      get: (name) => name.toLowerCase() === "content-type" ? input.contentType ?? "text/html" : null
    },
    text: async () => input.body
  };
}

function createInvalidRefBackend(): BrowserBackend {
  const backend = createMockBrowserBackend();
  return {
    ...backend,
    click: async (input) => {
      throw new Error(`Invalid browser element ref: ${input.ref ?? ""}`);
    }
  };
}

describe("web and browser tools baselines", () => {
  let tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
    tempRoots = [];
  });

  it("exposes the expected browser and web tool names", () => {
    expect(createWebTools().map((candidate) => candidate.name)).toEqual(expectedToolNames);
  });

  it("extracts readable content with the fetch fallback", async () => {
    const fetch = vi.fn(async () => createFetchResponse({
      body: "<html><head><title>Example Title</title></head><body><main>Hello world.</main></body></html>"
    }));
    const extract = tool("web.extract", createWebTools({ fetch, enableNetwork: true }));

    const result = await extract.run({ url: "https://example.com/article" });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("URL: https://example.com/article");
    expect(result.content).toContain("Title: Example Title");
    expect(result.content).toContain("Status: 200 OK");
    expect(result.content).toContain("Hello world.");
    expect(result.metadata).toEqual({
      url: "https://example.com/article",
      title: "Example Title",
      content: "Example Title Hello world.",
      contentType: "text/html",
      status: 200,
      source: "fetch"
    });
    expect(fetch).toHaveBeenCalledWith("https://example.com/article", expect.objectContaining({ method: "GET" }));
  });

  it("returns deterministic metadata when web.extract network is disabled", async () => {
    const extract = tool("web.extract", createWebTools({ enableNetwork: false }));

    const result = await extract.run({ url: "https://example.com/private" });

    expect(result.ok).toBe(false);
    expect(result.metadata).toEqual({
      url: "https://example.com/private",
      reason: "network-disabled"
    });
  });

  it("returns deterministic metadata when web.extract has no URL", async () => {
    const extract = tool("web.extract", createWebTools({ enableNetwork: true }));

    const result = await extract.run({ text: "there is nothing to fetch here" });

    expect(result.ok).toBe(false);
    expect(result.metadata).toEqual({ reason: "missing-url" });
  });

  it("navigates with the mock browser backend and includes backend metadata", async () => {
    const navigate = tool("browser.navigate", createWebTools({
      browserBackend: createMockBrowserBackend({ sessionId: "nav-session", title: "Nav Title", text: "Nav text." })
    }));

    const result = await navigate.run({ url: "https://example.com/app" });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Browser: mock");
    expect(result.content).toContain("Session: nav-session");
    expect(result.content).toContain("URL: https://example.com/app");
    expect(result.metadata).toMatchObject({
      url: "https://example.com/app",
      backend: "mock",
      session: {
        id: "nav-session",
        backend: "mock",
        currentUrl: "https://example.com/app"
      }
    });
  });

  it("reports unconfigured browser.navigate without calling a backend", async () => {
    const navigate = tool("browser.navigate", createWebTools({
      browserBackend: createUnconfiguredBrowserBackend()
    }));

    const result = await navigate.run({ url: "https://example.com/app" });

    expect(result.ok).toBe(false);
    expect(result.metadata).toEqual({
      url: "https://example.com/app",
      backend: "unconfigured"
    });
  });

  it("renders browser snapshot text and interactive elements", async () => {
    const snapshot = tool("browser.snapshot", createWebTools({
      browserBackend: createMockBrowserBackend({ title: "Snapshot Title", text: "Snapshot text." })
    }));

    const result = await snapshot.run({});

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Snapshot text.");
    expect(result.content).toContain("Interactive elements:");
    expect(result.content).toContain("@e1 button Mock Button");
    expect(result.metadata).toMatchObject({
      backend: "mock",
      snapshot: {
        title: "Snapshot Title",
        text: "Snapshot text.",
        elements: [{ ref: "@e1", role: "button", name: "Mock Button" }]
      }
    });
  });

  it("returns ok false for browser.click with an invalid ref", async () => {
    const click = tool("browser.click", createWebTools({
      browserBackend: createInvalidRefBackend()
    }));

    const result = await click.run({ ref: "invalid-ref" });

    expect(result.ok).toBe(false);
    expect(result.content).toBe("Invalid browser element ref: invalid-ref");
    expect(result.metadata).toEqual({ backend: "mock" });
  });

  it("writes browser.screenshot under a temp workspace root", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "estacoda-web-tools-test-"));
    tempRoots.push(workspaceRoot);
    const screenshot = tool("browser.screenshot", createWebTools({
      browserBackend: createMockBrowserBackend(),
      workspaceRoot
    }));

    const result = await screenshot.run({});

    expect(result.ok).toBe(true);
    expect(result.metadata).toMatchObject({
      backend: "mock",
      mimeType: "image/png",
      bytes: 8
    });
    const path = result.metadata?.path;
    expect(typeof path).toBe("string");
    expect((path as string).startsWith(join(workspaceRoot, ".estacoda", "browser", "screenshots"))).toBe(true);
    expect(relative(process.cwd(), path as string).startsWith("..")).toBe(true);
    await expect(readFile(path as string)).resolves.toEqual(Buffer.from("iVBORw0KGgo=", "base64"));
  });

  it("returns unavailable for browser.vision without an analyzer", async () => {
    const vision = tool("browser.vision", createWebTools({
      browserBackend: createMockBrowserBackend()
    }));

    const result = await vision.run({});

    expect(result.ok).toBe(false);
    expect(result.metadata).toEqual({
      backend: "mock",
      reason: "vision-unavailable"
    });
  });
});
