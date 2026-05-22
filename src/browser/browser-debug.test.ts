import { describe, expect, it } from "vitest";
import { BrowserDebugSession, createBrowserDebugSession, isBrowserDebugEnabled } from "./browser-debug.js";

describe("browser debug session", () => {
  it("log() accumulates events and flush() returns them", () => {
    const debug = new BrowserDebugSession({ enabled: true });

    debug.log("start", { status: 200 });
    debug.log("finish", { ok: true });

    expect(debug.flush()).toEqual([
      { event: "start", data: { status: 200 } },
      { event: "finish", data: { ok: true } }
    ]);
    expect(debug.flush()).toEqual([]);
  });

  it("does not accumulate events when disabled", () => {
    const debug = createBrowserDebugSession({ enabled: false });

    debug.log("start", { status: 200 });

    expect(debug.flush()).toEqual([]);
  });

  it("isBrowserDebugEnabled() respects browser and web debug env vars", () => {
    expect(isBrowserDebugEnabled({})).toBe(false);
    expect(isBrowserDebugEnabled({ ESTACODA_BROWSER_DEBUG: "false", ESTACODA_WEB_TOOLS_DEBUG: "false" })).toBe(false);
    expect(isBrowserDebugEnabled({ ESTACODA_BROWSER_DEBUG: "true" })).toBe(true);
    expect(isBrowserDebugEnabled({ ESTACODA_WEB_TOOLS_DEBUG: "true" })).toBe(true);
  });

  it("redacts token-bearing URLs", () => {
    const debug = createBrowserDebugSession({ enabled: true });

    debug.log("request", {
      url: "https://example.com/path?token=super-secret",
      nested: ["see https://example.com/?api_key=another-secret now"]
    });

    const flushed = JSON.stringify(debug.flush());
    expect(flushed).toContain("[REDACTED_URL_WITH_SECRET]");
    expect(flushed).not.toContain("super-secret");
    expect(flushed).not.toContain("another-secret");
  });

  it("redacts auth headers and cookies", () => {
    const debug = createBrowserDebugSession({ enabled: true });

    debug.log("headers", {
      headers: {
        Authorization: "Bearer secret-token",
        Cookie: "session=secret-cookie",
        "x-api-key": "secret-key",
        Accept: "text/html"
      }
    });

    expect(debug.flush()).toEqual([{
      event: "headers",
      data: {
        headers: {
          Authorization: "[REDACTED_SECRET]",
          Cookie: "[REDACTED_SECRET]",
          "x-api-key": "[REDACTED_SECRET]",
          Accept: "text/html"
        }
      }
    }]);
  });

  it("redacts request bodies and runtime expressions", () => {
    const debug = createBrowserDebugSession({ enabled: true });

    debug.log("payload", {
      body: "secret request body",
      expression: "fetch('https://example.com/?token=runtime-secret')"
    });

    const flushed = JSON.stringify(debug.flush());
    expect(flushed).toContain("[REDACTED_BODY]");
    expect(flushed).toContain("[REDACTED_EXPRESSION]");
    expect(flushed).not.toContain("runtime-secret");
    expect(flushed).not.toContain("secret request body");
  });

  it("truncates large strings and page text", () => {
    const debug = createBrowserDebugSession({ enabled: true });

    debug.log("page", {
      pageText: "A".repeat(1000),
      other: "B".repeat(1000)
    });

    const [event] = debug.flush();
    expect((event.data as { pageText: string }).pageText.length).toBeLessThan(320);
    expect((event.data as { other: string }).other.length).toBeLessThan(900);
  });
});
