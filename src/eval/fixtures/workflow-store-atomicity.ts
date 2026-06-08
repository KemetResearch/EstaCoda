import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { SQLiteSessionDB } from "../../session/sqlite-session-db.js";
import { SQLiteWorkflowStore } from "../../workflow/sqlite-workflow-store.js";
import type { WorkflowEvent, WorkflowOperatorEvent, WorkflowRun, WorkflowStep } from "../../workflow/types.js";
import { assertTrue, assertEqual, buildResult } from "../eval-runner.js";
import { rmSync } from "node:fs";

export const workflowStoreAtomicityCase: EvalCase = {
  id: "workflow-store-atomicity",
  name: "SQLiteWorkflowStore atomic transitions and round-trip integrity",
  description: "Atomic transition writes workflow run+step+events in one transaction; rollback on error.",
  tags: ["workflow", "atomicity", "sqlite", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const dbPath = `/tmp/estacoda-eval-atomicity-${Date.now()}.db`;
    const assertions = [];

    try {
      const sessionDb = new SQLiteSessionDB({ path: dbPath });
      const store = new SQLiteWorkflowStore({ db: sessionDb.db });

      // Atomic transition: create workflow run + step + event together
      await store.atomicTransition("run-1", async (tx) => {
        await tx.createWorkflowRun(makeTestRun("run-1"));
        await tx.createWorkflowStep(makeTestStep("step-1", "run-1", 0));
        await tx.appendWorkflowEvent(makeTestEvent("evt-1", "run-1", "step-1", "flow-created"));
        return "committed";
      });

      const run = await store.getWorkflowRun("run-1");
      const step = await store.getWorkflowStep("step-1");
      const events = await store.listWorkflowEvents("run-1");

      assertions.push(assertTrue("workflow run exists after atomic transition", run !== null));
      assertions.push(assertTrue("step exists after atomic transition", step !== null));
      assertions.push(assertEqual("events count after atomic transition", events.length, 1));

      // Atomic transition with error should roll back
      let threw = false;
      try {
        await store.atomicTransition("run-2", async (tx) => {
          await tx.createWorkflowRun(makeTestRun("run-2"));
          await tx.createWorkflowStep(makeTestStep("step-2", "run-2", 0));
          throw new Error("simulated failure");
        });
      } catch {
        threw = true;
      }
      assertions.push(assertTrue("atomic transition throws on error", threw));

      // The adapter-backed transaction should roll back completely, so workflow run run-2 should not exist.
      const flow2 = await store.getWorkflowRun("run-2");
      assertions.push(assertTrue("workflow run rolled back on atomic failure", flow2 === null));

      // Step update round-trip
      if (step) {
        const updatedStep = { ...step, status: "running" as const, startedAt: "2024-01-01T00:01:00.000Z", updatedAt: "2024-01-01T00:01:00.000Z" };
        await store.updateWorkflowStep(updatedStep);
        const reloaded = await store.getWorkflowStep("step-1");
        assertions.push(assertEqual("step status updated", reloaded?.status, "running"));
        assertions.push(assertEqual("step startedAt updated", reloaded?.startedAt, "2024-01-01T00:01:00.000Z"));
      }

      // Operator event
      await store.appendWorkflowOperatorEvent(makeTestOpEvent("op-1", "run-1", "step-1", "operator-paused"));
      const opEvents = await store.listWorkflowOperatorEvents("run-1");
      assertions.push(assertEqual("operator event appended", opEvents.length, 1));

      // Lock lifecycle
      const acquired = await store.acquireLock("run-1", "worker-1", 5000);
      assertions.push(assertTrue("lock acquired", acquired));
      const lock = await store.getLock("run-1");
      assertions.push(assertEqual("lock owner", lock?.ownerId, "worker-1"));
      await store.releaseLock("run-1", "worker-1");
      const afterRelease = await store.getLock("run-1");
      assertions.push(assertTrue("lock released", afterRelease === null));

      // WorkflowCheckpoint
      await store.createWorkflowCheckpoint(makeTestCheckpoint("cp-1", "run-1"));
      const cp = await store.getWorkflowCheckpoint("cp-1");
      assertions.push(assertTrue("checkpoint round-trip", cp !== null));
      assertions.push(assertEqual("checkpoint workflow run id", cp?.runId, "run-1"));

      sessionDb.close();
    } finally {
      try { rmSync(dbPath); } catch { /* ignore */ }
    }

    return buildResult("workflow-store-atomicity", "SQLiteWorkflowStore atomic transitions and round-trip integrity", assertions, Date.now() - startedAt);
  }
};

function makeTestRun(id: string) {
  return {
    id,
    sessionId: "session-1",
    status: "pending" as const,
    intent: {
      nativeIntent: "general" as const,
      labels: ["test"],
      confidence: 1,
      suggestedToolsets: [],
      suggestedSkills: [],
      confirmationRequired: false,
      evidence: [],
      rationale: "test"
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    checkpointCount: 0,
    stepCount: 0,
    retryCount: 0,
    metadata: {}
  };
}

function makeTestStep(id: string, runId: string, index: number) {
  return {
    id,
    runId,
    index,
    status: "pending" as const,
    name: `step-${index}`,
    description: "test step",
    toolPlans: [],
    executions: [],
    retryPolicy: { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1, retryableFailureClasses: [], nonRetryableFailureClasses: [], requireIdempotent: true },
    retryCount: 0,
    maxRetries: 1,
    idempotent: false,
    safeToRetry: false,
    failurePolicy: { defaultAction: "stop" as const, stopOnNonRetryable: true, allowSkipIfSkippable: false },
    attemptNumber: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z"
  };
}

function makeTestEvent(id: string, runId: string, stepId: string, kind: string) {
  return { id, runId, stepId, kind: kind as WorkflowEvent["kind"], data: { test: true }, timestamp: "2024-01-01T00:00:00.000Z" };
}

function makeTestOpEvent(id: string, runId: string, stepId: string, kind: string) {
  return { id, runId, stepId, kind: kind as WorkflowOperatorEvent["kind"], operator: "test", command: "/pause", effect: "paused", previousState: "running" as WorkflowRun["status"] | WorkflowStep["status"], newState: "paused" as WorkflowRun["status"] | WorkflowStep["status"], timestamp: "2024-01-01T00:00:00.000Z" };
}

function makeTestCheckpoint(id: string, runId: string) {
  return {
    id,
    runId,
    name: "test-cp",
    snapshot: {
      runState: "pending" as const,
      stepStates: {},
      pendingApprovals: [],
      waitReasons: {},
      workflowOperatorEvents: [],
      retryCounts: {}
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    createdBy: "test"
  };
}
