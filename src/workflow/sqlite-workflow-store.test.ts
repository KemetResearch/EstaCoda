import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteSessionDB } from "../session/sqlite-session-db.js";
import { SQLiteWorkflowStore } from "./sqlite-workflow-store.js";
import type { Flow, FlowEvent, FlowStep } from "./types.js";

describe("SQLiteWorkflowStore", () => {
  let tmpDir: string;
  let sessionDb: SQLiteSessionDB;
  let store: SQLiteWorkflowStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-workflow-test-"));
    sessionDb = new SQLiteSessionDB({ path: join(tmpDir, "sessions.sqlite") });
    store = new SQLiteWorkflowStore({ db: sessionDb.db });
  });

  afterEach(() => {
    sessionDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("commits atomic transitions through the internal SQLite adapter", async () => {
    await store.atomicTransition("flow-1", async (tx) => {
      await tx.createFlow(makeFlow("flow-1"));
      await tx.createStep(makeStep("step-1", "flow-1"));
      await tx.appendFlowEvent(makeEvent("event-1", "flow-1", "step-1"));
    });

    await expect(store.getFlow("flow-1")).resolves.toMatchObject({ id: "flow-1" });
    await expect(store.getStep("step-1")).resolves.toMatchObject({ id: "step-1" });
    await expect(store.listFlowEvents("flow-1")).resolves.toHaveLength(1);
  });

  it("rolls back failed atomic transitions through the internal SQLite adapter", async () => {
    await expect(
      store.atomicTransition("flow-2", async (tx) => {
        await tx.createFlow(makeFlow("flow-2"));
        await tx.createStep(makeStep("step-2", "flow-2"));
        throw new Error("simulated failure");
      })
    ).rejects.toThrow("simulated failure");

    await expect(store.getFlow("flow-2")).resolves.toBeNull();
    await expect(store.getStep("step-2")).resolves.toBeNull();
  });
});

function makeFlow(id: string): Flow {
  return {
    id,
    sessionId: "session-1",
    status: "pending",
    intent: {
      nativeIntent: "general",
      labels: ["test"],
      confidence: 1,
      suggestedToolsets: [],
      suggestedSkills: [],
      confirmationRequired: false,
      evidence: [],
      rationale: "test"
    },
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    checkpointCount: 0,
    stepCount: 0,
    retryCount: 0,
    metadata: {}
  };
}

function makeStep(id: string, flowId: string): FlowStep {
  return {
    id,
    flowId,
    index: 0,
    status: "pending",
    name: "test step",
    description: "test step",
    toolPlans: [],
    executions: [],
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      backoffMultiplier: 1,
      retryableFailureClasses: [],
      nonRetryableFailureClasses: [],
      requireIdempotent: true
    },
    retryCount: 0,
    maxRetries: 1,
    idempotent: false,
    safeToRetry: false,
    failurePolicy: {
      defaultAction: "stop",
      stopOnNonRetryable: true,
      allowSkipIfSkippable: false
    },
    attemptNumber: 1,
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z"
  };
}

function makeEvent(id: string, flowId: string, stepId: string): FlowEvent {
  return {
    id,
    flowId,
    stepId,
    kind: "flow-created",
    data: { test: true },
    timestamp: "2030-01-01T00:00:00.000Z"
  };
}
