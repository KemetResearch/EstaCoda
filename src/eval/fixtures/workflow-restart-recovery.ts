import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { FakeWorkflowStore } from "../../workflow/fake-workflow-store.js";
import { WorkflowLockService } from "../../workflow/workflow-lock-service.js";
import { WorkflowRestartRecovery } from "../../workflow/workflow-restart-recovery.js";
import { assertTrue, assertEqual, buildResult } from "../eval-runner.js";
import type { IntentRoute } from "../../contracts/intent.js";

function makeIntent(): IntentRoute {
  return {
    nativeIntent: "general",
    labels: ["test"],
    confidence: 1,
    suggestedToolsets: [],
    suggestedSkills: [],
    confirmationRequired: false,
    evidence: [],
    rationale: "test intent"
  };
}

export const workflowRestartRecoveryCase: EvalCase = {
  id: "workflow-restart-recovery",
  name: "WorkflowRestartRecovery marks running workflow runs and steps interrupted and releases stale locks",
  description: "After restart: running→interrupted, paused/waiting preserved, stale locks recovered.",
  tags: ["workflow", "restart", "recovery", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const assertions = [];

    const now = new Date("2024-01-01T00:00:00Z");
    const store = new FakeWorkflowStore({ now: () => new Date(now) });
    const lockService = new WorkflowLockService({ store, now: () => new Date(now), defaultLeaseMs: 30_000 });

    // Create workflow runs in different states by directly manipulating store
    const runningRunId = "run-running";
    const pausedRunId = "run-paused";
    const waitingRunId = "run-waiting";

    await store.createWorkflowRun({
      id: runningRunId,
      sessionId: "session-1",
      status: "running",
      intent: makeIntent(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      checkpointCount: 0,
      stepCount: 1,
      retryCount: 0,
      metadata: {}
    });
    await store.createWorkflowStep({
      id: "step-running",
      runId: runningRunId,
      index: 0,
      status: "running",
      name: "Running Step",
      description: "...",
      toolPlans: [],
      executions: [],
      retryPolicy: { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1, retryableFailureClasses: [], nonRetryableFailureClasses: [], requireIdempotent: true },
      retryCount: 0,
      maxRetries: 1,
      idempotent: false,
      safeToRetry: false,
      failurePolicy: { defaultAction: "stop", stopOnNonRetryable: true, allowSkipIfSkippable: false },
      attemptNumber: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    await lockService.acquire(runningRunId, "old-worker");

    await store.createWorkflowRun({
      id: pausedRunId,
      sessionId: "session-2",
      status: "paused",
      intent: makeIntent(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      checkpointCount: 0,
      stepCount: 0,
      retryCount: 0,
      metadata: {}
    });
    await lockService.acquire(pausedRunId, "old-worker");

    await store.createWorkflowRun({
      id: waitingRunId,
      sessionId: "session-3",
      status: "waiting",
      intent: makeIntent(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      checkpointCount: 0,
      stepCount: 0,
      retryCount: 0,
      metadata: {}
    });

    // Advance time so locks are stale
    now.setMinutes(now.getMinutes() + 10);

    const recovery = new WorkflowRestartRecovery({ store, lockService, now: () => new Date(now) });
    const result = await recovery.recover();

    assertions.push(assertEqual("recovered count", result.recovered, 3));
    assertions.push(assertEqual("interrupted count", result.interrupted, 1));
    assertions.push(assertEqual("stale locks released", result.staleLocksReleased, 2));
    assertions.push(assertTrue("has restart warning", result.warnings.some((w) => w.includes("interrupted"))));

    const runningFlowAfter = await store.getWorkflowRun(runningRunId);
    assertions.push(assertEqual("running workflow run interrupted", runningFlowAfter?.status, "interrupted"));

    const runningStepAfter = await store.getWorkflowStep("step-running");
    assertions.push(assertEqual("running step interrupted", runningStepAfter?.status, "interrupted"));

    const pausedFlowAfter = await store.getWorkflowRun(pausedRunId);
    assertions.push(assertEqual("paused workflow run preserved", pausedFlowAfter?.status, "paused"));

    const waitingFlowAfter = await store.getWorkflowRun(waitingRunId);
    assertions.push(assertEqual("waiting workflow run preserved", waitingFlowAfter?.status, "waiting"));

    const events = await store.listWorkflowEvents(runningRunId);
    assertions.push(assertTrue("workflow run state changed event", events.some((e) => e.kind === "flow-state-changed")));
    assertions.push(assertTrue("step-interrupted event", events.some((e) => e.kind === "step-interrupted")));

    return buildResult("workflow-restart-recovery", "WorkflowRestartRecovery marks running workflow runs and steps interrupted and releases stale locks", assertions, Date.now() - startedAt);
  }
};
