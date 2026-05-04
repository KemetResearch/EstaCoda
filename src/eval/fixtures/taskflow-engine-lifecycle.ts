import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { FakeTaskFlowStore } from "../../taskflow/fake-taskflow-store.js";
import { FlowLockService } from "../../taskflow/flow-lock-service.js";
import { TaskFlowEngine } from "../../taskflow/taskflow-engine.js";
import { assertTrue, assertEqual, buildResult } from "../eval-runner.js";
import type { IntentRoute } from "../../contracts/intent.js";

import type { ToolRiskClass } from "../../contracts/tool.js";

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

function makeNow(): () => Date {
  let t = 0;
  return () => {
    t += 1000;
    return new Date(t);
  };
}

export const taskflowEngineLifecycleCase: EvalCase = {
  id: "taskflow-engine-lifecycle",
  name: "TaskFlowEngine flow and step lifecycle methods",
  description: "Covers create, start, complete, fail, cancel, pause, resume, interrupt, wait, retry, skip, checkpoint.",
  tags: ["taskflow", "engine", "lifecycle", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const assertions = [];

    const store = new FakeTaskFlowStore({ now: makeNow() });
    const lockService = new FlowLockService({ store, now: makeNow(), defaultLeaseMs: 30_000 });
    const engine = new TaskFlowEngine({ store, lockService, ownerId: "worker-1", now: makeNow() });

    // ─── Create flow ───
    const flow = await engine.createFlow({
      sessionId: "session-1",
      intent: makeIntent(),
      plan: {
        name: "Test Plan",
        description: "A test plan",
        steps: [
          { name: "Step A", description: "First step", skippable: true, idempotent: true },
          { name: "Step B", description: "Second step" }
        ]
      }
    });
    assertions.push(assertEqual("flow created", flow.status, "pending"));
    assertions.push(assertEqual("flow sessionId", flow.sessionId, "session-1"));

    const steps = await store.listSteps(flow.id);
    assertions.push(assertEqual("2 steps created", steps.length, 2));
    assertions.push(assertEqual("step 0 name", steps[0].name, "Step A"));
    assertions.push(assertEqual("step 1 name", steps[1].name, "Step B"));

    // ─── Start flow ───
    const startResult = await engine.startFlow(flow.id);
    assertions.push(assertTrue("start ok", startResult.ok));
    if (startResult.ok) {
      assertions.push(assertEqual("flow running after start", startResult.flow.status, "running"));
      assertions.push(assertEqual("current step set", startResult.flow.currentStepId, steps[0].id));
    }

    const step0AfterStart = await store.getStep(steps[0].id);
    assertions.push(assertEqual("step 0 running", step0AfterStart?.status, "running"));

    // ─── Complete step 0 ───
    const complete0 = await engine.completeStep(steps[0].id);
    assertions.push(assertTrue("complete0 ok", complete0.ok));
    if (complete0.ok) {
      assertions.push(assertEqual("step 0 completed", (await store.getStep(steps[0].id))?.status, "completed"));
      assertions.push(assertEqual("step 1 running", (await store.getStep(steps[1].id))?.status, "running"));
      assertions.push(assertEqual("current step updated", complete0.flow.currentStepId, steps[1].id));
    }

    // ─── Complete step 1 ───
    const complete1 = await engine.completeStep(steps[1].id);
    assertions.push(assertTrue("complete1 ok", complete1.ok));
    if (complete1.ok) {
      assertions.push(assertEqual("flow completed", complete1.flow.status, "completed"));
    }

    // Verify lock released after completion
    const lockAfterComplete = await lockService.get(flow.id);
    assertions.push(assertTrue("lock released after complete", lockAfterComplete === null));

    // ─── Cancel flow test (separate flow) ───
    const flow2 = await engine.createFlow({
      sessionId: "session-2",
      intent: makeIntent(),
      plan: {
        name: "Cancel Plan",
        description: "A plan to cancel",
        steps: [{ name: "Step C", description: "Cancellable step" }]
      }
    });
    const start2 = await engine.startFlow(flow2.id);
    assertions.push(assertTrue("flow2 start ok", start2.ok));

    const cancelled = await engine.cancelFlow(flow2.id, "User request", "operator-1");
    assertions.push(assertEqual("flow2 cancelled", cancelled.status, "cancelled"));
    const steps2 = await store.listSteps(flow2.id);
    assertions.push(assertEqual("step C cancelled", steps2[0].status, "cancelled"));

    const cancelEvents = await store.listFlowEvents(flow2.id);
    assertions.push(assertTrue("cancel event recorded", cancelEvents.some((e) => e.kind === "flow-cancelled")));
    const cancelOpEvents = await store.listOperatorEvents(flow2.id);
    assertions.push(assertTrue("operator cancel event recorded", cancelOpEvents.some((e) => e.kind === "operator-cancelled")));

    // ─── Pause / resume ───
    const flow3 = await engine.createFlow({
      sessionId: "session-3",
      intent: makeIntent(),
      plan: {
        name: "Pause Plan",
        description: "A plan to pause",
        steps: [{ name: "Step D", description: "Pausable step" }]
      }
    });
    await engine.startFlow(flow3.id);
    await engine.requestPause(flow3.id, "Operator pause", "operator-1");
    const flow3AfterPauseReq = await store.getFlow(flow3.id);
    assertions.push(assertTrue("pause requested at set", flow3AfterPauseReq?.pauseRequestedAt !== undefined));

    await engine.applyPauseAtBoundary(flow3.id);
    const flow3Paused = await store.getFlow(flow3.id);
    assertions.push(assertEqual("flow paused", flow3Paused?.status, "paused"));
    const stepD = (await store.listSteps(flow3.id))[0];
    assertions.push(assertEqual("step paused", stepD.status, "paused"));

    await engine.resumeFlow(flow3.id, "operator-1");
    const flow3Resumed = await store.getFlow(flow3.id);
    assertions.push(assertEqual("flow resumed", flow3Resumed?.status, "running"));
    const stepDResumed = await store.getStep(stepD.id);
    assertions.push(assertEqual("step resumed", stepDResumed?.status, "running"));

    // ─── Interrupt ───
    const flow4 = await engine.createFlow({
      sessionId: "session-4",
      intent: makeIntent(),
      plan: {
        name: "Interrupt Plan",
        description: "A plan to interrupt",
        steps: [{ name: "Step E", description: "Interruptible step" }]
      }
    });
    await engine.startFlow(flow4.id);
    await engine.interruptFlow(flow4.id, "Emergency stop", "operator-1");
    const flow4Interrupted = await store.getFlow(flow4.id);
    assertions.push(assertEqual("flow interrupted", flow4Interrupted?.status, "interrupted"));
    const stepE = (await store.listSteps(flow4.id))[0];
    assertions.push(assertEqual("step interrupted", stepE.status, "interrupted"));

    // ─── Skip ───
    const flow5 = await engine.createFlow({
      sessionId: "session-5",
      intent: makeIntent(),
      plan: {
        name: "Skip Plan",
        description: "A plan to skip",
        steps: [
          { name: "Step F", description: "Skippable step", skippable: true },
          { name: "Step G", description: "Next step" }
        ]
      }
    });
    await engine.startFlow(flow5.id);
    const stepF = (await store.listSteps(flow5.id))[0];
    await engine.skipStep(stepF.id, "Skip reason", "operator-1");
    const stepFSkipped = await store.getStep(stepF.id);
    assertions.push(assertEqual("step skipped", stepFSkipped?.status, "skipped"));
    const stepGRunning = await store.getStep((await store.listSteps(flow5.id))[1].id);
    assertions.push(assertEqual("next step running after skip", stepGRunning?.status, "running"));

    // Skip non-skippable should fail
    const flow6 = await engine.createFlow({
      sessionId: "session-6",
      intent: makeIntent(),
      plan: {
        name: "Non-skip Plan",
        description: "A plan that cannot skip",
        steps: [{ name: "Step H", description: "Non-skippable step" }]
      }
    });
    await engine.startFlow(flow6.id);
    const stepH = (await store.listSteps(flow6.id))[0];
    try {
      await engine.skipStep(stepH.id, "Should fail");
      assertions.push(assertEqual("skip non-skippable threw", "no-throw", "throw"));
    } catch {
      assertions.push(assertEqual("skip non-skippable threw", "throw", "throw"));
    }

    // ─── Retry ───
    const flow7 = await engine.createFlow({
      sessionId: "session-7",
      intent: makeIntent(),
      plan: {
        name: "Retry Plan",
        description: "A plan to retry",
        steps: [{ name: "Step I", description: "Retryable step", idempotent: true, maxRetries: 2 }]
      }
    });
    await engine.startFlow(flow7.id);
    const stepI = (await store.listSteps(flow7.id))[0];
    await engine.failStep(stepI.id, "Temporary error");
    const stepIFailed = await store.getStep(stepI.id);
    assertions.push(assertEqual("step I failed", stepIFailed?.status, "failed"));

    const retryStep = await engine.retryStep(stepI.id, "operator-1");
    assertions.push(assertEqual("retry step created", retryStep.status, "running"));
    assertions.push(assertEqual("retry step has retryOfStepId", retryStep.retryOfStepId, stepI.id));
    assertions.push(assertEqual("retry step attempt", retryStep.attemptNumber, 2));

    const flow7AfterRetry = await store.getFlow(flow7.id);
    assertions.push(assertEqual("flow current step is retry", flow7AfterRetry?.currentStepId, retryStep.id));

    // Retry non-idempotent should fail
    const flow8 = await engine.createFlow({
      sessionId: "session-8",
      intent: makeIntent(),
      plan: {
        name: "No-retry Plan",
        description: "A plan that cannot retry",
        steps: [{ name: "Step J", description: "Non-retryable step" }]
      }
    });
    await engine.startFlow(flow8.id);
    const stepJ = (await store.listSteps(flow8.id))[0];
    await engine.failStep(stepJ.id, "Error");
    try {
      await engine.retryStep(stepJ.id);
      assertions.push(assertEqual("retry non-idempotent threw", "no-throw", "throw"));
    } catch {
      assertions.push(assertEqual("retry non-idempotent threw", "throw", "throw"));
    }

    // ─── Checkpoint ───
    const flow9 = await engine.createFlow({
      sessionId: "session-9",
      intent: makeIntent(),
      plan: {
        name: "Checkpoint Plan",
        description: "A plan to checkpoint",
        steps: [
          { name: "Step K", description: "First" },
          { name: "Step L", description: "Second" }
        ]
      }
    });
    await engine.startFlow(flow9.id);
    const checkpoint = await engine.createCheckpoint(flow9.id, "before-step-l", "Taken before step L", "operator-1");
    assertions.push(assertEqual("checkpoint name", checkpoint.name, "before-step-l"));
    assertions.push(assertEqual("checkpoint flow state", checkpoint.snapshot.flowState, "running"));

    const checkpoints = await store.listCheckpoints(flow9.id);
    assertions.push(assertEqual("1 checkpoint", checkpoints.length, 1));

    const flow9AfterCheckpoint = await store.getFlow(flow9.id);
    assertions.push(assertEqual("checkpoint count updated", flow9AfterCheckpoint?.checkpointCount, 1));

    // ─── Approval gate ───
    const flow10 = await engine.createFlow({
      sessionId: "session-10",
      intent: makeIntent(),
      plan: {
        name: "Approval Plan",
        description: "A plan needing approval",
        steps: [{ name: "Step M", description: "Risky step" }]
      }
    });
    await engine.startFlow(flow10.id);
    const stepM = (await store.listSteps(flow10.id))[0];
    await engine.waitForApproval(stepM.id, {
      reason: "High-risk action",
      riskClass: "destructive-local" as ToolRiskClass,
      toolName: "terminal",
      toolExecutorDecision: "ask"
    });
    const stepMAfterWait = await store.getStep(stepM.id);
    assertions.push(assertEqual("step waiting for approval", stepMAfterWait?.status, "waiting_for_approval"));

    await engine.approveStep(stepM.id, "operator-1", "grant-1");
    const stepMAfterApprove = await store.getStep(stepM.id);
    assertions.push(assertEqual("step running after approve", stepMAfterApprove?.status, "running"));

    const gatesAfterApprove = await store.listApprovalGates(flow10.id, { status: "approved" });
    assertions.push(assertEqual("1 approved gate", gatesAfterApprove.length, 1));

    // Reject approval
    const flow11 = await engine.createFlow({
      sessionId: "session-11",
      intent: makeIntent(),
      plan: {
        name: "Reject Plan",
        description: "A plan to reject",
        steps: [{ name: "Step N", description: "Another risky step" }]
      }
    });
    await engine.startFlow(flow11.id);
    const stepN = (await store.listSteps(flow11.id))[0];
    await engine.waitForApproval(stepN.id, {
      reason: "Another high-risk action",
      riskClass: "destructive-local" as ToolRiskClass,
      toolName: "terminal",
      toolExecutorDecision: "ask"
    });
    await engine.rejectStep(stepN.id, "operator-1", "Too risky");
    const stepNAfterReject = await store.getStep(stepN.id);
    assertions.push(assertEqual("step failed after reject", stepNAfterReject?.status, "failed"));
    const flow11AfterReject = await store.getFlow(flow11.id);
    assertions.push(assertEqual("flow failed after reject", flow11AfterReject?.status, "failed"));

    return buildResult("taskflow-engine-lifecycle", "TaskFlowEngine flow and step lifecycle methods", assertions, Date.now() - startedAt);
  }
};
