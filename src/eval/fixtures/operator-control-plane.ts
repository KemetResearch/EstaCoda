import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { FakeWorkflowStore } from "../../workflow/fake-workflow-store.js";
import { WorkflowLockService } from "../../workflow/workflow-lock-service.js";
import { WorkflowEngine } from "../../workflow/workflow-engine.js";
import { WorkflowProcessRegistry } from "../../workflow/workflow-process-registry.js";
import {
  WorkflowCommandDispatcher,
  type OperatorCommand,
} from "../../workflow/workflow-command-dispatcher.js";
import {
  WorkflowEventSummaryService,
  DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG,
} from "../../workflow/workflow-event-summary-service.js";
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
    rationale: "test intent",
  };
}

function makeNow(): () => Date {
  let t = 0;
  return () => {
    t += 1000;
    return new Date(t);
  };
}

export const operatorControlPlaneCase: EvalCase = {
  id: "operator-control-plane",
  name: "WorkflowCommandDispatcher routes and validates all slash commands",
  description:
    "Covers /status, /pause, /resume, /interrupt, /cancel, /steer, /approve, /reject, /retry, /skip, /checkpoint, /trace.",
  tags: ["taskflow", "operator", "commands", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const assertions = [];

    const store = new FakeWorkflowStore({ now: makeNow() });
    const lockService = new WorkflowLockService({
      store,
      now: makeNow(),
      defaultLeaseMs: 30_000,
    });
    const engine = new WorkflowEngine({
      store,
      lockService,
      ownerId: "worker-1",
      now: makeNow(),
    });
    const processRegistry = new WorkflowProcessRegistry({ store });
    const compactionService = new WorkflowEventSummaryService({
      store,
      config: { ...DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG, enabled: false },
      now: makeNow(),
    });
    const dispatcher = new WorkflowCommandDispatcher({
      engine,
      store,
      processRegistry,
      compactionService,
    });

    // ─── Create and start a flow ───
    const flow = await engine.createFlow({
      sessionId: "session-1",
      intent: makeIntent(),
      plan: {
        name: "Test Plan",
        description: "A test plan",
        steps: [
          { name: "Step A", description: "First step", skippable: true, idempotent: true },
          { name: "Step B", description: "Second step" },
          { name: "Step C", description: "Third step", requiresApproval: true },
        ],
      },
    });
    await engine.startFlow(flow.id);

    const stepA = (await store.listSteps(flow.id)).find((s) => s.name === "Step A")!;

    // ═════════════════════════════════════════════════════════════════
    // Track 3.1  /status
    // ═════════════════════════════════════════════════════════════════
    {
      const r = await dispatcher.dispatch({
        command: "/status",
        flowId: flow.id,
      });
      assertions.push(assertTrue("status-ok", r.ok));
      if (r.ok) {
        assertions.push(assertEqual("status-flowId", (r.data as any)?.view?.flowId, flow.id));
        assertions.push(assertTrue("status-canPause", (r.data as any)?.view?.canPause));
      }
    }

    // status for non-existent flow
    {
      const r = await dispatcher.dispatch({
        command: "/status",
        flowId: "no-such-flow",
      });
      assertions.push(assertTrue("status-notfound-fails", !r.ok));
      if (!r.ok) {
        assertions.push(assertTrue("status-notfound-error", r.error.includes("not found")));
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.2  /pause
    // ═════════════════════════════════════════════════════════════════
    {
      const r = await dispatcher.dispatch({
        command: "/pause",
        flowId: flow.id,
        reason: "maintenance",
        operator: "op-1",
      });
      assertions.push(assertTrue("pause-ok", r.ok));
      const pausedReq = await store.getFlow(flow.id);
      assertions.push(assertTrue("pause-requestedAt-set", !!pausedReq?.pauseRequestedAt));
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.3  /resume
    // ═════════════════════════════════════════════════════════════════
    {
      // First apply pause so flow is in paused state
      await engine.applyPauseAtBoundary(flow.id);

      const r = await dispatcher.dispatch({
        command: "/resume",
        flowId: flow.id,
        operator: "op-1",
      });
      assertions.push(assertTrue("resume-ok", r.ok));
      const resumed = await store.getFlow(flow.id);
      assertions.push(assertEqual("resume-status", resumed?.status, "running"));
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.4  /steer
    // ═════════════════════════════════════════════════════════════════
    {
      const r = await dispatcher.dispatch({
        command: "/steer",
        flowId: flow.id,
        guidance: "Switch to plan B",
        operator: "op-1",
      });
      assertions.push(assertTrue("steer-ok", r.ok));
      const opEvents = await store.listOperatorEvents(flow.id);
      assertions.push(assertTrue("steer-event-recorded", opEvents.some((e) => e.command === "/steer")));
    }

    // steer on terminal flow fails
    {
      await engine.cancelFlow(flow.id);
      const r = await dispatcher.dispatch({
        command: "/steer",
        flowId: flow.id,
        guidance: "Should fail",
        operator: "op-1",
      });
      assertions.push(assertTrue("steer-terminal-fails", !r.ok));

      // restore flow for subsequent tests
      const newFlow = await engine.createFlow({
        sessionId: "session-2",
        intent: makeIntent(),
        plan: {
          name: "Resume Plan",
          description: "For remaining tests",
          steps: [
            { name: "Step X", description: "X step", skippable: true, idempotent: true },
            { name: "Step Y", description: "Y step", requiresApproval: true },
          ],
        },
      });
      await engine.startFlow(newFlow.id);
      (flow as any).id = newFlow.id; // reuse flow var for remaining tests
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.5  /skip
    // ═════════════════════════════════════════════════════════════════
    {
      // Create a new flow and start it so step 1 is running; step 2 remains pending
      const skipFlow = await engine.createFlow({
        sessionId: "session-skip",
        intent: makeIntent(),
        plan: {
          name: "Skip Plan",
          description: "For skip test",
          steps: [
            { name: "Step S1", description: "S1 step" },
            { name: "Step S2", description: "S2 step", skippable: true, idempotent: true },
          ],
        },
      });
      await engine.startFlow(skipFlow.id);
      const stepS2 = (await store.listSteps(skipFlow.id)).find((s) => s.name === "Step S2")!;

      const r = await dispatcher.dispatch({
        command: "/skip",
        stepId: stepS2.id,
        reason: "not needed",
        operator: "op-1",
      });
      assertions.push(assertTrue("skip-ok", r.ok));
      const skipped = await store.getStep(stepS2.id);
      assertions.push(assertEqual("skip-status", skipped?.status, "skipped"));
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.6  /approve
    // ═════════════════════════════════════════════════════════════════
    {
      const steps2 = await store.listSteps(flow.id);
      const stepY = steps2.find((s) => s.name === "Step Y")!;
      // Manually set gate to pending
      await store.createApprovalGate({
        id: crypto.randomUUID(),
        stepId: stepY.id,
        flowId: flow.id,
        status: "pending",
        requestedAt: new Date().toISOString(),
        reason: "Awaiting operator approval",
        riskClass: "read-only-local",
        toolExecutorDecision: "ask",
      });
      await store.updateStep({ ...stepY, status: "waiting_for_approval" });
      await store.atomicTransition(flow.id, async (tx) => {
        await tx.appendFlowEvent({
          id: crypto.randomUUID(),
          flowId: flow.id,
          kind: "approval-requested",
          stepId: stepY.id,
          data: {},
          timestamp: new Date().toISOString(),
        });
      });

      const r = await dispatcher.dispatch({
        command: "/approve",
        stepId: stepY.id,
        operator: "op-1",
      });
      assertions.push(assertTrue("approve-ok", r.ok));
      if (r.ok) {
        // approveStep resolves wait and resumes the step -> running
        assertions.push(assertEqual("approve-status", (r.data as any)?.stepStatus, "running"));
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.7  /reject
    // ═════════════════════════════════════════════════════════════════
    {
      const newFlow = await engine.createFlow({
        sessionId: "session-3",
        intent: makeIntent(),
        plan: {
          name: "Reject Plan",
          description: "For reject test",
          steps: [
            { name: "Step Z", description: "Z step", requiresApproval: true },
          ],
        },
      });
      await engine.startFlow(newFlow.id);
      const stepZ = (await store.listSteps(newFlow.id)).find((s) => s.name === "Step Z")!;

      await store.createApprovalGate({
        id: crypto.randomUUID(),
        stepId: stepZ.id,
        flowId: newFlow.id,
        status: "pending",
        requestedAt: new Date().toISOString(),
        reason: "Awaiting operator approval",
        riskClass: "read-only-local",
        toolExecutorDecision: "ask",
      });
      await store.updateStep({ ...stepZ, status: "waiting_for_approval" });

      const r = await dispatcher.dispatch({
        command: "/reject",
        stepId: stepZ.id,
        operator: "op-1",
        reason: "Unsafe",
      });
      assertions.push(assertTrue("reject-ok", r.ok));
      if (r.ok) {
        assertions.push(assertEqual("reject-status", (r.data as any)?.stepStatus, "failed"));
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.8  /retry
    // ═════════════════════════════════════════════════════════════════
    {
      const newFlow = await engine.createFlow({
        sessionId: "session-4",
        intent: makeIntent(),
        plan: {
          name: "Retry Plan",
          description: "For retry test",
          steps: [
            { name: "Step R", description: "R step", idempotent: true },
          ],
        },
      });
      await engine.startFlow(newFlow.id);
      const stepR = (await store.listSteps(newFlow.id)).find((s) => s.name === "Step R")!;
      await engine.failStep(stepR.id, "transient error");

      const r = await dispatcher.dispatch({
        command: "/retry",
        stepId: stepR.id,
        operator: "op-1",
      });
      assertions.push(assertTrue("retry-ok", r.ok));
      if (r.ok) {
        assertions.push(assertTrue("retry-stepId", !!(r.data as any)?.retryStepId));
        const retryStep = await store.getStep((r.data as any)?.retryStepId);
        assertions.push(assertEqual("retry-attempt", retryStep?.attemptNumber, 2));
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.9  /checkpoint
    // ═════════════════════════════════════════════════════════════════
    {
      const r = await dispatcher.dispatch({
        command: "/checkpoint",
        flowId: flow.id,
        name: "mid-flight",
        operator: "op-1",
      });
      assertions.push(assertTrue("checkpoint-ok", r.ok));
      if (r.ok) {
        assertions.push(assertTrue("checkpoint-id", !!(r.data as any)?.checkpointId));
      }
      const checkpoints = await store.listCheckpoints(flow.id);
      assertions.push(assertTrue("checkpoint-saved", checkpoints.length > 0));
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.10 /trace
    // ═════════════════════════════════════════════════════════════════
    {
      const r = await dispatcher.dispatch({
        command: "/trace",
        flowId: flow.id,
        limit: 10,
      });
      assertions.push(assertTrue("trace-ok", r.ok));
      if (r.ok) {
        assertions.push(assertTrue("trace-has-timeline", (r.data as any)?.timeline?.length > 0));
      }
    }

    // trace on non-existent flow fails
    {
      const r = await dispatcher.dispatch({
        command: "/trace",
        flowId: "no-such-flow",
      });
      assertions.push(assertTrue("trace-notfound-fails", !r.ok));
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.11 /cancel
    // ═════════════════════════════════════════════════════════════════
    {
      const cancelFlow = await engine.createFlow({
        sessionId: "session-5",
        intent: makeIntent(),
        plan: {
          name: "Cancel Plan",
          description: "For cancel test",
          steps: [{ name: "Step C1", description: "C1 step" }],
        },
      });
      await engine.startFlow(cancelFlow.id);

      const r = await dispatcher.dispatch({
        command: "/cancel",
        flowId: cancelFlow.id,
        operator: "op-1",
      });
      assertions.push(assertTrue("cancel-ok", r.ok));
      const cancelled = await store.getFlow(cancelFlow.id);
      assertions.push(assertEqual("cancel-status", cancelled?.status, "cancelled"));
    }

    // ═════════════════════════════════════════════════════════════════
    // Track 3.12 /interrupt
    // ═════════════════════════════════════════════════════════════════
    {
      const intFlow = await engine.createFlow({
        sessionId: "session-6",
        intent: makeIntent(),
        plan: {
          name: "Interrupt Plan",
          description: "For interrupt test",
          steps: [{ name: "Step I1", description: "I1 step" }],
        },
      });
      await engine.startFlow(intFlow.id);

      // Register a fake running process
      await processRegistry.register({
        id: crypto.randomUUID(),
        flowId: intFlow.id,
        stepId: (await store.listSteps(intFlow.id))[0].id,
        processManagerId: "pm-1",
        processType: "process",
        status: "running",
      });

      const r = await dispatcher.dispatch({
        command: "/interrupt",
        flowId: intFlow.id,
        reason: "Operator requested",
        operator: "op-1",
      });
      assertions.push(assertTrue("interrupt-ok", r.ok));
      if (r.ok) {
        const interrupted = await store.getFlow(intFlow.id);
        assertions.push(assertEqual("interrupt-status", interrupted?.status, "interrupted"));
        assertions.push(assertEqual("interrupt-procs", (r.data as any)?.terminatedProcesses, 1));
        // Verify cleanup audit events were recorded
        const flowEvents = await store.listFlowEvents(intFlow.id);
        const cleanupEvents = flowEvents.filter((e) => e.data?.reason === "interrupt-cleanup");
        assertions.push(assertTrue("interrupt-cleanup-events", cleanupEvents.length > 0));
        assertions.push(assertTrue("interrupt-cleanup-success", cleanupEvents.every((e) => e.data?.success === true)));
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Track 3.13 Unknown command
    // ═════════════════════════════════════════════════════════════════
    {
      const r = await dispatcher.dispatch({ command: "/bogus" } as unknown as OperatorCommand);
      assertions.push(assertTrue("unknown-cmd-fails", !r.ok));
    }

    return buildResult(
      "operator-control-plane",
      "WorkflowCommandDispatcher routes and validates all slash commands",
      assertions,
      Date.now() - startedAt
    );
  },
};
