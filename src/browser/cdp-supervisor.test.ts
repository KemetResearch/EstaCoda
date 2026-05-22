import { describe, expect, it } from "vitest";
import { CDPSupervisor } from "./cdp-supervisor.js";
import type { CdpWebSocketEvent, CdpWebSocketLike } from "./cdp-client.js";

class FakeCdpSocket implements CdpWebSocketLike {
  readonly readyState = 1;
  readonly sent: Array<{ id: number; method: string; params?: Record<string, unknown> }> = [];
  closed = false;
  readonly #listeners = new Map<string, Array<(event: CdpWebSocketEvent) => void>>();

  constructor(
    readonly url: string,
    private readonly snapshot = {
      url: "https://example.com/page",
      title: "Example",
      text: "Readable text",
      elements: [{ ref: "@e1", role: "button", name: "Continue" }]
    }
  ) {}

  send(data: string): void {
    const message = JSON.parse(data) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    this.sent.push(message);
    const result = message.method === "Runtime.evaluate"
      ? { result: { value: JSON.stringify(this.snapshot) } }
      : { ok: true, method: message.method };
    this.#emit("message", {
      data: JSON.stringify({
        id: message.id,
        result
      })
    });
  }

  close(): void {
    this.closed = true;
    this.#emit("close", {});
  }

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: CdpWebSocketEvent) => void): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  #emit(type: string, event: CdpWebSocketEvent): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("CDPSupervisor", () => {
  it("start() connects once and enables Page and Runtime", async () => {
    const sockets: FakeCdpSocket[] = [];
    const supervisor = new CDPSupervisor({
      webSocketUrl: "ws://cdp/page-1",
      webSocketFactory: (url) => {
        const socket = new FakeCdpSocket(url);
        sockets.push(socket);
        return socket;
      }
    });

    await supervisor.start();
    await supervisor.start();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.sent.map((message) => message.method)).toEqual([
      "Page.enable",
      "Runtime.enable"
    ]);
  });

  it("send() delegates to the persistent CDP client", async () => {
    const sockets: FakeCdpSocket[] = [];
    const supervisor = new CDPSupervisor({
      webSocketUrl: "ws://cdp/page-1",
      webSocketFactory: (url) => {
        const socket = new FakeCdpSocket(url);
        sockets.push(socket);
        return socket;
      }
    });

    await supervisor.start();
    await expect(supervisor.send("Page.navigate", { url: "https://example.com" })).resolves.toEqual({
      ok: true,
      method: "Page.navigate"
    });

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.sent.at(-1)).toMatchObject({
      method: "Page.navigate",
      params: { url: "https://example.com" }
    });
  });

  it("getSnapshot() returns page content plus scaffold-only empty event arrays", async () => {
    const supervisor = new CDPSupervisor({
      webSocketUrl: "ws://cdp/page-1",
      webSocketFactory: (url) => new FakeCdpSocket(url)
    });

    await supervisor.start();
    await expect(supervisor.getSnapshot("session-1")).resolves.toEqual({
      sessionId: "session-1",
      url: "https://example.com/page",
      title: "Example",
      text: "Readable text",
      elements: [{ ref: "@e1", role: "button", name: "Continue" }],
      pendingDialogs: [],
      frameTree: [],
      consoleHistory: []
    });
  });

  it("close() closes the socket and is safe to call more than once", async () => {
    const socket = new FakeCdpSocket("ws://cdp/page-1");
    const supervisor = new CDPSupervisor({
      webSocketUrl: "ws://cdp/page-1",
      webSocketFactory: () => socket
    });

    await supervisor.start();
    supervisor.close();
    supervisor.close();

    expect(socket.closed).toBe(true);
  });

  it("multiple supervisors keep independent client state", async () => {
    const first = new FakeCdpSocket("ws://cdp/first", { url: "https://first.test", title: "First", text: "One", elements: [] });
    const second = new FakeCdpSocket("ws://cdp/second", { url: "https://second.test", title: "Second", text: "Two", elements: [] });

    const firstSupervisor = new CDPSupervisor({
      webSocketUrl: "ws://cdp/first",
      webSocketFactory: () => first
    });
    const secondSupervisor = new CDPSupervisor({
      webSocketUrl: "ws://cdp/second",
      webSocketFactory: () => second
    });

    await firstSupervisor.start();
    await secondSupervisor.start();

    await expect(firstSupervisor.getSnapshot("first")).resolves.toMatchObject({ url: "https://first.test" });
    await expect(secondSupervisor.getSnapshot("second")).resolves.toMatchObject({ url: "https://second.test" });
    expect(first.sent).not.toBe(second.sent);
  });

  it("methods before start() fail deterministically", async () => {
    const supervisor = new CDPSupervisor({
      webSocketUrl: "ws://cdp/page-1",
      webSocketFactory: (url) => new FakeCdpSocket(url)
    });

    await expect(supervisor.send("Page.navigate", { url: "https://example.com" })).rejects.toThrow("CDP supervisor is not started.");
    await expect(supervisor.getSnapshot("session-1")).rejects.toThrow("CDP supervisor is not started.");
  });
});
