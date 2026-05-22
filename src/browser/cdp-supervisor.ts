import type { BrowserSnapshot } from "../contracts/browser.js";
import { connectCdp, type CdpClient, type CdpWebSocketFactory } from "./cdp-client.js";

export type SupervisorSnapshot = BrowserSnapshot & {
  pendingDialogs: [];
  frameTree: [];
  consoleHistory: [];
};

export type CDPSupervisorOptions = {
  webSocketUrl: string;
  webSocketFactory?: CdpWebSocketFactory;
};

export class CDPSupervisor {
  readonly #webSocketUrl: string;
  readonly #webSocketFactory: CdpWebSocketFactory | undefined;
  #client: CdpClient | undefined;
  #startPromise: Promise<void> | undefined;

  constructor(options: CDPSupervisorOptions) {
    this.#webSocketUrl = options.webSocketUrl;
    this.#webSocketFactory = options.webSocketFactory;
  }

  async start(): Promise<void> {
    if (this.#client !== undefined) {
      return;
    }
    if (this.#startPromise !== undefined) {
      return this.#startPromise;
    }

    this.#startPromise = (async () => {
      const client = await connectCdp({
        webSocketUrl: this.#webSocketUrl,
        webSocketFactory: this.#webSocketFactory,
      });
      await client.send("Page.enable");
      await client.send("Runtime.enable");
      this.#client = client;
    })();

    try {
      await this.#startPromise;
    } finally {
      this.#startPromise = undefined;
    }
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.#requireClient().send(method, params);
  }

  async waitFor(method: string, timeoutMs: number): Promise<void> {
    await this.#requireClient().waitFor(method, timeoutMs);
  }

  async getSnapshot(sessionId = "cdp-supervisor"): Promise<SupervisorSnapshot> {
    const snapshot = await evaluateCdpSnapshot(this.#requireClient(), sessionId);
    return {
      ...snapshot,
      pendingDialogs: [],
      frameTree: [],
      consoleHistory: [],
    };
  }

  close(): void {
    if (this.#client === undefined) {
      return;
    }
    this.#client.close();
    this.#client = undefined;
  }

  #requireClient(): CdpClient {
    if (this.#client === undefined) {
      throw new Error("CDP supervisor is not started.");
    }
    return this.#client;
  }
}

export async function evaluateCdpSnapshot(client: CdpClient, sessionId: string): Promise<BrowserSnapshot> {
  const evaluated = await client.send("Runtime.evaluate", {
    expression: snapshotExpression(),
    returnByValue: true
  }) as { result?: { value?: unknown } };
  return parseCdpSnapshot(evaluated.result?.value, sessionId);
}

export function snapshotExpression(): string {
  return `(() => {
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')).slice(0, 120);
    window.__estacodaElements = candidates;
    const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('name') || el.id || '').trim().slice(0, 160);
    return JSON.stringify({
      url: location.href,
      title: document.title,
      text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 12000),
      elements: candidates.map((el, index) => ({
        ref: '@e' + (index + 1),
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        name: label(el)
      }))
    });
  })()`;
}

export function parseCdpSnapshot(value: unknown, sessionId: string): BrowserSnapshot {
  if (typeof value !== "string") {
    return { sessionId, url: "about:blank", text: "", elements: [] };
  }
  try {
    const parsed = JSON.parse(value) as BrowserSnapshot;
    return {
      sessionId,
      url: parsed.url,
      title: parsed.title,
      text: parsed.text,
      elements: Array.isArray(parsed.elements) ? parsed.elements : []
    };
  } catch {
    return { sessionId, url: "about:blank", text: value, elements: [] };
  }
}
