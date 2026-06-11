import { describe, expect, it } from "vitest";
import { SubagentRegistry } from "./subagent-registry.js";

describe("SubagentRegistry", () => {
  it("tracks active subagents and returns bounded snapshots", () => {
    const registry = new SubagentRegistry();
    const controller = new AbortController();

    registry.registerSubagent({
      subagentId: "sub-1",
      childSessionId: "child-1",
      parentSessionId: "parent-1",
      depth: 1,
      role: "leaf",
      goal: "Inspect\nthis\tthing",
      model: "model",
      provider: "provider",
      startedAt: "2026-01-01T00:00:00.000Z",
      toolCount: 2,
      abortController: controller
    });

    expect(registry.listActiveSubagents()).toEqual([
      expect.objectContaining({
        subagentId: "sub-1",
        childSessionId: "child-1",
        parentSessionId: "parent-1",
        goal: "Inspect this thing",
        status: "starting",
        signalAborted: false
      })
    ]);
    expect(registry.listActiveSubagents()[0]).not.toHaveProperty("abortController");
  });

  it("redacts obvious secrets from goal previews", () => {
    const registry = new SubagentRegistry();

    registry.registerSubagent({
      ...record("sub-1", "parent-1"),
      goal: "Use api_key=sk-testsecret123 and token ghp_secret456"
    });

    expect(registry.listActiveSubagents()[0]?.goal).toBe("Use [REDACTED] and token [REDACTED]");
  });

  it("updates active subagent status", () => {
    const registry = new SubagentRegistry();
    registry.registerSubagent(record("sub-1", "parent-1"));

    expect(registry.updateSubagent("sub-1", {
      status: "running",
      toolCount: 3,
      lastActivityAt: "2026-01-01T00:01:00.000Z"
    })).toMatchObject({
      status: "running",
      toolCount: 3,
      lastActivityAt: "2026-01-01T00:01:00.000Z"
    });
  });

  it("filters active subagents by parent session id", () => {
    const registry = new SubagentRegistry();
    registry.registerSubagent(record("sub-1", "parent-1"));
    registry.registerSubagent(record("sub-2", "parent-2"));

    expect(registry.listActiveSubagents("parent-1").map((item) => item.subagentId)).toEqual(["sub-1"]);
    expect(registry.hasActiveSubagents("parent-1")).toBe(true);
    expect(registry.hasActiveSubagents("parent-missing")).toBe(false);
  });

  it("unregisters active subagents", () => {
    const registry = new SubagentRegistry();
    registry.registerSubagent(record("sub-1", "parent-1"));

    expect(registry.unregisterSubagent("sub-1")).toBe(true);
    expect(registry.unregisterSubagent("sub-1")).toBe(false);
    expect(registry.listActiveSubagents()).toEqual([]);
  });

  it("interrupts one subagent and aborts its signal", () => {
    const registry = new SubagentRegistry();
    const controller = new AbortController();
    registry.registerSubagent(record("sub-1", "parent-1", controller));
    registry.registerSubagent(record("sub-2", "parent-1"));

    expect(registry.interruptSubagent("sub-1", "stop now")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(registry.listActiveSubagents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ subagentId: "sub-1", status: "cancelling", signalAborted: true }),
      expect.objectContaining({ subagentId: "sub-2", status: "starting", signalAborted: false })
    ]));
  });

  it("returns false when interrupting an unknown subagent", () => {
    const registry = new SubagentRegistry();

    expect(registry.interruptSubagent("missing", "stop")).toBe(false);
  });

  it("interrupts all active children for a parent", () => {
    const registry = new SubagentRegistry();
    const first = new AbortController();
    const second = new AbortController();
    const other = new AbortController();
    registry.registerSubagent(record("sub-1", "parent-1", first));
    registry.registerSubagent(record("sub-2", "parent-1", second));
    registry.registerSubagent(record("sub-3", "parent-2", other));

    expect(registry.interruptChildrenForParent("parent-1", "parent cancelled")).toBe(2);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });

  it("pauses and resumes future spawns without interrupting active subagents", () => {
    const registry = new SubagentRegistry();
    const controller = new AbortController();
    registry.registerSubagent(record("sub-1", "parent-1", controller));

    registry.pauseSpawns("operator pause");
    expect(registry.isSpawnPaused()).toBe(true);
    expect(registry.spawnPausedReason()).toBe("operator pause");
    expect(controller.signal.aborted).toBe(false);

    registry.resumeSpawns();
    expect(registry.isSpawnPaused()).toBe(false);
  });

  it("keeps active subagent state instance scoped", () => {
    const first = new SubagentRegistry();
    const second = new SubagentRegistry();
    first.registerSubagent(record("sub-1", "parent-1"));

    expect(first.listActiveSubagents()).toHaveLength(1);
    expect(second.listActiveSubagents()).toEqual([]);
  });

  it("returns bounded operator snapshots without mutable internals or goal text", () => {
    const registry = new SubagentRegistry();
    const controller = new AbortController();
    registry.registerSubagent({
      ...record("sub-1", "parent-1", controller),
      batchId: "batch-1",
      taskIndex: 2,
      depth: 2,
      role: "orchestrator",
      provider: "provider-with-a-very-long-name".repeat(8),
      model: "model-with-a-very-long-name".repeat(8),
      goal: "Read file excerpt with password=short-secret and report it back",
      status: "running"
    });

    const status = registry.operatorStatus({
      parentSessionId: "parent-1",
      now: "2026-01-01T00:00:05.250Z"
    });

    expect(status.activeCount).toBe(1);
    expect(status.omittedCount).toBe(0);
    expect(status.subagents[0]).toMatchObject({
      childSessionId: "child-1",
      parentSessionId: "parent-1",
      role: "orchestrator",
      depth: 2,
      status: "running",
      durationMs: 5250,
      batchId: "batch-1",
      taskIndex: 2
    });
    expect(status.subagents[0]?.provider.length).toBeLessThanOrEqual(120);
    expect(status.subagents[0]?.model.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(status)).not.toContain("abortController");
    expect(JSON.stringify(status)).not.toContain("signalAborted");
    expect(JSON.stringify(status)).not.toContain("Read file excerpt");
    expect(JSON.stringify(status)).not.toContain("short-secret");
  });

  it("filters and limits operator snapshots while preserving total active count", () => {
    const registry = new SubagentRegistry();
    registry.registerSubagent(record("sub-1", "parent-1"));
    registry.registerSubagent(record("sub-2", "parent-1"));
    registry.registerSubagent(record("sub-3", "parent-2"));

    const status = registry.operatorStatus({ parentSessionId: "parent-1", limit: 1 });

    expect(status.activeCount).toBe(2);
    expect(status.subagents).toHaveLength(1);
    expect(status.omittedCount).toBe(1);
    expect(status.subagents.map((item) => item.childSessionId)).toEqual(["child-1"]);
  });

  it("reports timeout and cancellation state in operator snapshots", () => {
    const registry = new SubagentRegistry();
    const aborted = new AbortController();
    aborted.abort("cancelled");
    registry.registerSubagent({ ...record("sub-1", "parent-1", aborted), status: "running" });
    registry.registerSubagent({ ...record("sub-2", "parent-1"), status: "cancelling" });
    registry.registerSubagent({ ...record("sub-3", "parent-1"), status: "timeout" });

    expect(registry.operatorStatus({ parentSessionId: "parent-1" }).subagents.map((item) => item.cancellationState)).toEqual([
      "aborted",
      "cancelling",
      "timeout"
    ]);
  });
});

function record(subagentId: string, parentSessionId: string, abortController = new AbortController()) {
  return {
    subagentId,
    childSessionId: subagentId.replace("sub", "child"),
    parentSessionId,
    depth: 1,
    role: "leaf" as const,
    goal: `Goal for ${subagentId}`,
    model: "model",
    provider: "provider",
    startedAt: "2026-01-01T00:00:00.000Z",
    toolCount: 0,
    abortController
  };
}
