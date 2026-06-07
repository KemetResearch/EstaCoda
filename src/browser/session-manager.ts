import type { BrowserSessionLifecycle } from "./session-lifecycle.js";
import type { CdpTargetManager, ManagedCdpTarget } from "./cdp-target-manager.js";

export interface BrowserManagedSession {
  key: string;
  browserContextId: string;
  targetId: string;
  pageWebSocketDebuggerUrl: string;
  supervisor: ManagedCdpTarget["supervisor"];
  lastActiveAt: number;
  touch: () => void;
  close: () => Promise<void>;
}

export interface BrowserSessionManagerOptions {
  targetManager: Pick<CdpTargetManager, "createTarget">;
  lifecycle?: Pick<BrowserSessionLifecycle, "register" | "touch" | "unregister">;
  now?: () => number;
}

type StoredBrowserSession = BrowserManagedSession & {
  target: ManagedCdpTarget;
};

export class BrowserSessionManager {
  readonly #targetManager: Pick<CdpTargetManager, "createTarget">;
  readonly #lifecycle: Pick<BrowserSessionLifecycle, "register" | "touch" | "unregister"> | undefined;
  readonly #now: () => number;
  readonly #sessions = new Map<string, StoredBrowserSession>();

  constructor(options: BrowserSessionManagerOptions) {
    this.#targetManager = options.targetManager;
    this.#lifecycle = options.lifecycle;
    this.#now = options.now ?? Date.now;
  }

  async acquire(key: string): Promise<BrowserManagedSession> {
    const sessionKey = validateSessionKey(key);
    const existing = this.#sessions.get(sessionKey);
    if (existing !== undefined) {
      this.#touch(existing);
      return existing;
    }

    let target: ManagedCdpTarget;
    try {
      target = await this.#targetManager.createTarget();
    } catch (error) {
      throw new Error(`Failed to create browser session for key ${sessionKey}: ${errorMessage(error)}`, {
        cause: error
      });
    }

    const session: StoredBrowserSession = {
      key: sessionKey,
      browserContextId: target.browserContextId,
      targetId: target.targetId,
      pageWebSocketDebuggerUrl: target.pageWebSocketDebuggerUrl,
      supervisor: target.supervisor,
      lastActiveAt: this.#now(),
      target,
      touch: () => {
        this.#touch(session);
      },
      close: async () => {
        await this.close(sessionKey);
      }
    };

    this.#sessions.set(sessionKey, session);
    this.#lifecycle?.register(sessionKey, {
      browserContextId: target.browserContextId,
      targetId: target.targetId,
      pageWebSocketDebuggerUrl: target.pageWebSocketDebuggerUrl
    });
    this.#lifecycle?.touch(sessionKey);
    return session;
  }

  async close(key: string): Promise<void> {
    const sessionKey = validateSessionKey(key);
    const session = this.#sessions.get(sessionKey);
    if (session === undefined) {
      this.#lifecycle?.unregister(sessionKey);
      return;
    }

    this.#sessions.delete(sessionKey);
    this.#lifecycle?.unregister(sessionKey);
    try {
      await session.target.close();
    } catch (error) {
      throw new Error(`Failed to close browser session for key ${sessionKey}: ${errorMessage(error)}`, {
        cause: error
      });
    }
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    const failures: { key: string; error: unknown }[] = [];

    for (const session of sessions) {
      this.#lifecycle?.unregister(session.key);
      try {
        await session.target.close();
      } catch (error) {
        failures.push({ key: session.key, error });
      }
    }

    if (failures.length > 0) {
      const keys = failures.map((failure) => failure.key).join(", ");
      throw new Error(`Failed to close ${failures.length} browser session(s): ${keys}`, {
        cause: failures[0]?.error
      });
    }
  }

  has(key: string): boolean {
    const sessionKey = validateSessionKey(key);
    return this.#sessions.has(sessionKey);
  }

  #touch(session: StoredBrowserSession): void {
    session.lastActiveAt = this.#now();
    this.#lifecycle?.touch(session.key);
  }
}

function validateSessionKey(key: string): string {
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("Browser session key must be a non-empty string.");
  }
  return key;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
