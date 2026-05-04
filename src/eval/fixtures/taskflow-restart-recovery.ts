import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { FakeTaskFlowStore } from "../../taskflow/fake-taskflow-store.js";
import { FlowLockService } from "../../taskflow/flow-lock-service.js";
import { FlowRestartRecovery } from "../../taskflow/flow-restart-recovery.js";
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

export const taskflowRestartRecoveryCase: EvalCase = {
  id: "taskflow-restart-recovery",
  name: "FlowRestartRecovery marks running flows/steps interrupted and releases stale locks",
  description: "After restart: running→interrupted, paused/waiting preserved, stale locks recovered.",
  tags: ["taskflow", "restart", "recovery", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const assertions = [];

    const now = new Date("2024-01-01T00:00:00Z");
    const store = new FakeTaskFlowStore({ now: () => new Date(now) });
    const lockService = new FlowLockService({ store, now: () => new Date(now), defaultLeaseMs: 30_000 });

    // Create flows in different states by directly manipulating store
    const runningFlowId = "flow-running";
    const pausedFlowId = "flow-paused";
    const waitingFlowId = "flow-waiting";

    await store.createFlow({
      id: runningFlowId,
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
    await store.createStep({
      id: "step-running",
      flowId: runningFlowId,
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
    await lockService.acquire(runningFlowId, "old-worker");

    await store.createFlow({
      id: pausedFlowId,
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
    await lockService.acquire(pausedFlowId, "old-worker");

    await store.createFlow({
      id: waitingFlowId,
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

    const recovery = new FlowRestartRecovery({ store, lockService, now: () => new Date(now) });
    const result = await recovery.recover();

    assertions.push(assertEqual("recovered count", result.recovered, 3));
    assertions.push(assertEqual("interrupted count", result.interrupted, 1));
    assertions.push(assertEqual("stale locks released", result.staleLocksReleased, 2));
    assertions.push(assertTrue("has restart warning", result.warnings.some((w) => w.includes("interrupted"))));

    const runningFlowAfter = await store.getFlow(runningFlowId);
    assertions.push(assertEqual("running flow interrupted", runningFlowAfter?.status, "interrupted"));

    const runningStepAfter = await store.getStep("step-running");
    assertions.push(assertEqual("running step interrupted", runningStepAfter?.status, "interrupted"));

    const pausedFlowAfter = await store.getFlow(pausedFlowId);
    assertions.push(assertEqual("paused flow preserved", pausedFlowAfter?.status, "paused"));

    const waitingFlowAfter = await store.getFlow(waitingFlowId);
    assertions.push(assertEqual("waiting flow preserved", waitingFlowAfter?.status, "waiting"));

    const events = await store.listFlowEvents(runningFlowId);
    assertions.push(assertTrue("flow-state-changed event", events.some((e) => e.kind === "flow-state-changed")));
    assertions.push(assertTrue("step-interrupted event", events.some((e) => e.kind === "step-interrupted")));

    return buildResult("taskflow-restart-recovery", "FlowRestartRecovery marks running flows/steps interrupted and releases stale locks", assertions, Date.now() - startedAt);
  }
};
