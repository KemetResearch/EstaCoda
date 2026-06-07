import { describe, expect, it, vi, afterEach } from "vitest";
import { BrowserSessionManager } from "./session-manager.js";
import { BrowserSessionLifecycle } from "./session-lifecycle.js";
import type { CdpTargetSupervisor, ManagedCdpTarget } from "./cdp-target-manager.js";

class FakeSupervisor implements CdpTargetSupervisor {
  close = vi.fn();
}

class FakeManagedTarget implements ManagedCdpTarget {
  readonly browserContextId: string;
  readonly targetId: string;
  readonly pageWebSocketDebuggerUrl: string;
  readonly supervisor = new FakeSupervisor();
  readonly close = vi.fn(async () => {
    this.events.push(`target:${this.targetId}:close`);
    if (this.closeError !== undefined) {
      throw this.closeError;
    }
  });

  closeError: Error | undefined;

  constructor(
    index: number,
    private readonly events: string[]
  ) {
    this.browserContextId = `context-${index}`;
    this.targetId = `target-${index}`;
    this.pageWebSocketDebuggerUrl = `ws://page-${index}`;
  }
}

class FakeTargetManager {
  readonly targets: FakeManagedTarget[] = [];
  readonly createTarget = vi.fn(async (): Promise<ManagedCdpTarget> => {
    if (this.createError !== undefined) {
      throw this.createError;
    }
    const target = new FakeManagedTarget(this.targets.length + 1, this.events);
    this.targets.push(target);
    return target;
  });

  createError: Error | undefined;

  constructor(private readonly events: string[] = []) {}
}

class FakeLifecycle {
  readonly registered = new Set<string>();
  readonly calls: string[] = [];
  readonly register = vi.fn((key: string) => {
    this.calls.push(`register:${key}`);
    this.registered.add(key);
  });
  readonly touch = vi.fn((key: string) => {
    this.calls.push(`touch:${key}`);
  });
  readonly unregister = vi.fn((key: string) => {
    this.calls.push(`unregister:${key}`);
    this.registered.delete(key);
  });
}

describe("BrowserSessionManager", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("acquire() creates one context/target for a new key", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });

    const session = await manager.acquire("session-1");

    expect(targetManager.createTarget).toHaveBeenCalledTimes(1);
    expect(session.key).toBe("session-1");
    expect(session.browserContextId).toBe("context-1");
    expect(session.targetId).toBe("target-1");
    expect(session.pageWebSocketDebuggerUrl).toBe("ws://page-1");
    expect(session.supervisor).toBe(targetManager.targets[0]?.supervisor);
    expect(manager.has("session-1")).toBe(true);
  });

  it("acquire() reuses an existing session for the same key", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });

    const first = await manager.acquire("session-1");
    const second = await manager.acquire("session-1");

    expect(second).toBe(first);
    expect(targetManager.createTarget).toHaveBeenCalledTimes(1);
  });

  it("acquire() updates lastActiveAt for an existing session", async () => {
    const targetManager = new FakeTargetManager();
    let now = 10;
    const manager = new BrowserSessionManager({
      targetManager,
      now: () => now
    });

    const session = await manager.acquire("session-1");
    expect(session.lastActiveAt).toBe(10);

    now = 20;
    const reused = await manager.acquire("session-1");

    expect(reused).toBe(session);
    expect(reused.lastActiveAt).toBe(20);
  });

  it("touch() updates lastActiveAt and the lifecycle activity record", async () => {
    const targetManager = new FakeTargetManager();
    const lifecycle = new FakeLifecycle();
    let now = 10;
    const manager = new BrowserSessionManager({
      targetManager,
      lifecycle,
      now: () => now
    });

    const session = await manager.acquire("session-1");
    now = 30;
    session.touch();

    expect(session.lastActiveAt).toBe(30);
    expect(lifecycle.touch).toHaveBeenLastCalledWith("session-1");
  });

  it("different keys create different contexts/targets", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });

    const first = await manager.acquire("session-1");
    const second = await manager.acquire("session-2");

    expect(first.browserContextId).toBe("context-1");
    expect(second.browserContextId).toBe("context-2");
    expect(first.targetId).toBe("target-1");
    expect(second.targetId).toBe("target-2");
    expect(targetManager.createTarget).toHaveBeenCalledTimes(2);
  });

  it("invalid or empty keys throw deterministic errors", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });

    await expect(manager.acquire("")).rejects.toThrow("Browser session key must be a non-empty string.");
    await expect(manager.acquire("   ")).rejects.toThrow("Browser session key must be a non-empty string.");
    await expect(manager.close("")).rejects.toThrow("Browser session key must be a non-empty string.");
    expect(() => manager.has("")).toThrow("Browser session key must be a non-empty string.");
    expect(targetManager.createTarget).not.toHaveBeenCalled();
  });

  it("target creation failure does not store a session", async () => {
    const targetManager = new FakeTargetManager();
    targetManager.createError = new Error("target failed");
    const manager = new BrowserSessionManager({ targetManager });

    await expect(manager.acquire("session-1")).rejects.toThrow(
      "Failed to create browser session for key session-1: target failed"
    );

    expect(manager.has("session-1")).toBe(false);
  });

  it("close(key) closes the target and removes the session", async () => {
    const targetManager = new FakeTargetManager();
    const lifecycle = new FakeLifecycle();
    const manager = new BrowserSessionManager({ targetManager, lifecycle });
    await manager.acquire("session-1");

    await manager.close("session-1");

    expect(targetManager.targets[0]?.close).toHaveBeenCalledTimes(1);
    expect(manager.has("session-1")).toBe(false);
    expect(lifecycle.unregister).toHaveBeenCalledWith("session-1");
  });

  it("session.close() closes through the manager", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });
    const session = await manager.acquire("session-1");

    await session.close();

    expect(targetManager.targets[0]?.close).toHaveBeenCalledTimes(1);
    expect(manager.has("session-1")).toBe(false);
  });

  it("close(key) is idempotent for missing or already closed sessions", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });

    await manager.close("missing-session");
    await manager.acquire("session-1");
    await manager.close("session-1");
    await manager.close("session-1");

    expect(targetManager.targets[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("close(key) removes the session even when target cleanup fails", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });
    await manager.acquire("session-1");
    targetManager.targets[0]!.closeError = new Error("close failed");

    await expect(manager.close("session-1")).rejects.toThrow(
      "Failed to close browser session for key session-1: close failed"
    );

    expect(manager.has("session-1")).toBe(false);
  });

  it("closeAll() closes every stored session and clears the map", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });
    await manager.acquire("session-1");
    await manager.acquire("session-2");

    await manager.closeAll();

    expect(targetManager.targets[0]?.close).toHaveBeenCalledTimes(1);
    expect(targetManager.targets[1]?.close).toHaveBeenCalledTimes(1);
    expect(manager.has("session-1")).toBe(false);
    expect(manager.has("session-2")).toBe(false);
  });

  it("closeAll() is idempotent", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });
    await manager.acquire("session-1");

    await manager.closeAll();
    await manager.closeAll();

    expect(targetManager.targets[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("closeAll() continues cleanup after failures and reports failed keys", async () => {
    const targetManager = new FakeTargetManager();
    const manager = new BrowserSessionManager({ targetManager });
    await manager.acquire("session-1");
    await manager.acquire("session-2");
    targetManager.targets[0]!.closeError = new Error("close failed");

    await expect(manager.closeAll()).rejects.toThrow("Failed to close 1 browser session(s): session-1");

    expect(targetManager.targets[0]?.close).toHaveBeenCalledTimes(1);
    expect(targetManager.targets[1]?.close).toHaveBeenCalledTimes(1);
    expect(manager.has("session-1")).toBe(false);
    expect(manager.has("session-2")).toBe(false);
  });

  it("delegates cleanup order to ManagedCdpTarget.close()", async () => {
    const events: string[] = [];
    const targetManager = new FakeTargetManager(events);
    const manager = new BrowserSessionManager({ targetManager });
    await manager.acquire("session-1");

    await manager.close("session-1");

    expect(events).toEqual(["target:target-1:close"]);
  });

  it("registers, touches, and unregisters lifecycle sessions", async () => {
    const targetManager = new FakeTargetManager();
    const lifecycle = new FakeLifecycle();
    const manager = new BrowserSessionManager({ targetManager, lifecycle });

    await manager.acquire("session-1");
    await manager.acquire("session-1");
    await manager.close("session-1");

    expect(lifecycle.calls).toEqual([
      "register:session-1",
      "touch:session-1",
      "touch:session-1",
      "unregister:session-1"
    ]);
  });

  it("lifecycle inactivity cleanup closes the session and removes it from the manager map", async () => {
    vi.useFakeTimers();
    let manager: BrowserSessionManager;
    const targetManager = new FakeTargetManager();
    const lifecycle = new BrowserSessionLifecycle({
      inactivityTimeoutMs: 1_000,
      onCleanup: async (key) => {
        await manager.close(key);
      }
    });
    manager = new BrowserSessionManager({ targetManager, lifecycle });

    lifecycle.start();
    await manager.acquire("session-1");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(targetManager.targets[0]?.close).toHaveBeenCalledTimes(1);
    expect(manager.has("session-1")).toBe(false);
    lifecycle.stop();
  });
});
