import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { FakeWorkflowStore } from "../../workflow/fake-workflow-store.js";
import { WorkflowLockService } from "../../workflow/workflow-lock-service.js";
import { WorkflowEngine } from "../../workflow/workflow-engine.js";
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

export const workflowEngineLifecycleCase: EvalCase = {
  id: "workflow-engine-lifecycle",
  name: "WorkflowEngine workflow run and step lifecycle methods",
  description: "Covers create, start, complete, fail, cancel, pause, resume, interrupt, wait, retry, skip, checkpoint.",
  tags: ["workflow", "engine", "lifecycle", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const assertions = [];

    const store = new FakeWorkflowStore({ now: makeNow() });
    const lockService = new WorkflowLockService({ store, now: makeNow(), defaultLeaseMs: 30_000 });
    const engine = new WorkflowEngine({ store, lockService, ownerId: "worker-1", now: makeNow() });

    // ─── Create workflow run ───
    const run = await engine.createWorkflowRun({
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
    assertions.push(assertEqual("workflow run created", run.status, "pending"));
    assertions.push(assertEqual("workflow run sessionId", run.sessionId, "session-1"));

    const steps = await store.listWorkflowSteps(run.id);
    assertions.push(assertEqual("2 steps created", steps.length, 2));
    assertions.push(assertEqual("step 0 name", steps[0].name, "Step A"));
    assertions.push(assertEqual("step 1 name", steps[1].name, "Step B"));

    // ─── Start workflow run ───
    const startResult = await engine.startWorkflowRun(run.id);
    assertions.push(assertTrue("start ok", startResult.ok));
    if (startResult.ok) {
      assertions.push(assertEqual("workflow run running after start", startResult.run.status, "running"));
      assertions.push(assertEqual("current step set", startResult.run.currentStepId, steps[0].id));
    }

    const step0AfterStart = await store.getWorkflowStep(steps[0].id);
    assertions.push(assertEqual("step 0 running", step0AfterStart?.status, "running"));

    // ─── Complete step 0 ───
    const complete0 = await engine.completeWorkflowStep(steps[0].id);
    assertions.push(assertTrue("complete0 ok", complete0.ok));
    if (complete0.ok) {
      assertions.push(assertEqual("step 0 completed", (await store.getWorkflowStep(steps[0].id))?.status, "completed"));
      assertions.push(assertEqual("step 1 running", (await store.getWorkflowStep(steps[1].id))?.status, "running"));
      assertions.push(assertEqual("current step updated", complete0.run.currentStepId, steps[1].id));
    }

    // ─── Complete step 1 ───
    const complete1 = await engine.completeWorkflowStep(steps[1].id);
    assertions.push(assertTrue("complete1 ok", complete1.ok));
    if (complete1.ok) {
      assertions.push(assertEqual("workflow run completed", complete1.run.status, "completed"));
    }

    // Verify lock released after completion
    const lockAfterComplete = await lockService.get(run.id);
    assertions.push(assertTrue("lock released after complete", lockAfterComplete === null));

    // ─── Cancel workflow run test (separate workflow run) ───
    const flow2 = await engine.createWorkflowRun({
      sessionId: "session-2",
      intent: makeIntent(),
      plan: {
        name: "Cancel Plan",
        description: "A plan to cancel",
        steps: [{ name: "Step C", description: "Cancellable step" }]
      }
    });
    const start2 = await engine.startWorkflowRun(flow2.id);
    assertions.push(assertTrue("workflow run 2 start ok", start2.ok));

    const cancelled = await engine.cancelWorkflowRun(flow2.id, "User request", "operator-1");
    assertions.push(assertEqual("workflow run 2 cancelled", cancelled.status, "cancelled"));
    const steps2 = await store.listWorkflowSteps(flow2.id);
    assertions.push(assertEqual("step C cancelled", steps2[0].status, "cancelled"));

    const cancelEvents = await store.listWorkflowEvents(flow2.id);
    assertions.push(assertTrue("cancel event recorded", cancelEvents.some((e) => e.kind === "flow-cancelled")));
    const cancelOpEvents = await store.listWorkflowOperatorEvents(flow2.id);
    assertions.push(assertTrue("operator cancel event recorded", cancelOpEvents.some((e) => e.kind === "operator-cancelled")));

    // ─── Pause / resume ───
    const flow3 = await engine.createWorkflowRun({
      sessionId: "session-3",
      intent: makeIntent(),
      plan: {
        name: "Pause Plan",
        description: "A plan to pause",
        steps: [{ name: "Step D", description: "Pausable step" }]
      }
    });
    await engine.startWorkflowRun(flow3.id);
    await engine.requestWorkflowPause(flow3.id, "Operator pause", "operator-1");
    const flow3AfterPauseReq = await store.getWorkflowRun(flow3.id);
    assertions.push(assertTrue("pause requested at set", flow3AfterPauseReq?.pauseRequestedAt !== undefined));

    await engine.applyWorkflowPauseAtBoundary(flow3.id);
    const flow3Paused = await store.getWorkflowRun(flow3.id);
    assertions.push(assertEqual("workflow run paused", flow3Paused?.status, "paused"));
    const stepD = (await store.listWorkflowSteps(flow3.id))[0];
    assertions.push(assertEqual("step paused", stepD.status, "paused"));

    await engine.resumeWorkflowRun(flow3.id, "operator-1");
    const flow3Resumed = await store.getWorkflowRun(flow3.id);
    assertions.push(assertEqual("workflow run resumed", flow3Resumed?.status, "running"));
    const stepDResumed = await store.getWorkflowStep(stepD.id);
    assertions.push(assertEqual("step resumed", stepDResumed?.status, "running"));

    // ─── Interrupt ───
    const flow4 = await engine.createWorkflowRun({
      sessionId: "session-4",
      intent: makeIntent(),
      plan: {
        name: "Interrupt Plan",
        description: "A plan to interrupt",
        steps: [{ name: "Step E", description: "Interruptible step" }]
      }
    });
    await engine.startWorkflowRun(flow4.id);
    await engine.interruptWorkflowRun(flow4.id, "Emergency stop", "operator-1");
    const flow4Interrupted = await store.getWorkflowRun(flow4.id);
    assertions.push(assertEqual("workflow run interrupted", flow4Interrupted?.status, "interrupted"));
    const stepE = (await store.listWorkflowSteps(flow4.id))[0];
    assertions.push(assertEqual("step interrupted", stepE.status, "interrupted"));

    // ─── Skip — only pending steps may be skipped ───
    // Auto-skip via #advanceToNextStepOrComplete: step 0 completes → step 1 (pending, allowSkip) → skipped → step 2 running
    const flow5 = await engine.createWorkflowRun({
      sessionId: "session-5",
      intent: makeIntent(),
      plan: {
        name: "Auto-skip Plan",
        description: "A plan with auto-skip",
        steps: [
          { name: "Step F", description: "First step" },
          { name: "Step G", description: "Auto-skipped step", skippable: true },
          { name: "Step H", description: "Third step" }
        ]
      }
    });
    await engine.startWorkflowRun(flow5.id);
    const steps5 = await store.listWorkflowSteps(flow5.id);
    await engine.completeWorkflowStep(steps5[0].id);
    const stepGSkipped = await store.getWorkflowStep(steps5[1].id);
    assertions.push(assertEqual("auto-skip step skipped", stepGSkipped?.status, "skipped"));
    const stepHRunning = await store.getWorkflowStep(steps5[2].id);
    assertions.push(assertEqual("next step running after auto-skip", stepHRunning?.status, "running"));

    // Running step cannot be skipped — skip means "never executed"
    const flow6 = await engine.createWorkflowRun({
      sessionId: "session-6",
      intent: makeIntent(),
      plan: {
        name: "Running-skip Plan",
        description: "A plan to test running→skipped forbidden",
        steps: [{ name: "Step I", description: "Running step", skippable: true }]
      }
    });
    await engine.startWorkflowRun(flow6.id);
    const stepI = (await store.listWorkflowSteps(flow6.id))[0];
    try {
      await engine.skipWorkflowStep(stepI.id, "Should fail");
      assertions.push(assertEqual("skip running step threw", "no-throw", "throw"));
    } catch {
      assertions.push(assertEqual("skip running step threw", "throw", "throw"));
    }

    // Non-skippable pending step throws
    const flow7 = await engine.createWorkflowRun({
      sessionId: "session-7",
      intent: makeIntent(),
      plan: {
        name: "Non-skip Plan",
        description: "A plan that cannot skip",
        steps: [
          { name: "Step J", description: "Non-skippable" },
          { name: "Step K", description: "Next" }
        ]
      }
    });
    const steps7 = await store.listWorkflowSteps(flow7.id);
    try {
      await engine.skipWorkflowStep(steps7[0].id, "Should throw");
      assertions.push(assertEqual("skip non-skippable pending threw", "no-throw", "throw"));
    } catch {
      assertions.push(assertEqual("skip non-skippable pending threw", "throw", "throw"));
    }

    // Paused step cannot be skipped (execution already started)
    const flow7b = await engine.createWorkflowRun({
      sessionId: "session-7b",
      intent: makeIntent(),
      plan: {
        name: "Paused-skip Plan",
        description: "A plan to test paused→skipped forbidden",
        steps: [{ name: "Step J2", description: "Paused step", skippable: true }]
      }
    });
    await engine.startWorkflowRun(flow7b.id);
    await engine.requestWorkflowPause(flow7b.id, "Test pause", "operator-1");
    await engine.applyWorkflowPauseAtBoundary(flow7b.id);
    const stepJ2 = (await store.listWorkflowSteps(flow7b.id))[0];
    try {
      await engine.skipWorkflowStep(stepJ2.id, "Should fail");
      assertions.push(assertEqual("skip paused step threw", "no-throw", "throw"));
    } catch {
      assertions.push(assertEqual("skip paused step threw", "throw", "throw"));
    }

    // Waiting-for-approval step cannot be skipped (execution already started)
    const flow7c = await engine.createWorkflowRun({
      sessionId: "session-7c",
      intent: makeIntent(),
      plan: {
        name: "Waiting-skip Plan",
        description: "A plan to test waiting→skipped forbidden",
        steps: [{ name: "Step J3", description: "Waiting step", skippable: true }]
      }
    });
    await engine.startWorkflowRun(flow7c.id);
    const stepJ3 = (await store.listWorkflowSteps(flow7c.id))[0];
    await engine.waitForApproval(stepJ3.id, {
      reason: "Risky",
      riskClass: "destructive-local" as ToolRiskClass,
      toolName: "terminal",
      toolExecutorDecision: "ask"
    });
    try {
      await engine.skipWorkflowStep(stepJ3.id, "Should fail");
      assertions.push(assertEqual("skip waiting step threw", "no-throw", "throw"));
    } catch {
      assertions.push(assertEqual("skip waiting step threw", "throw", "throw"));
    }

    // ─── Retry ───
    const flow8 = await engine.createWorkflowRun({
      sessionId: "session-8",
      intent: makeIntent(),
      plan: {
        name: "Retry Plan",
        description: "A plan to retry",
        steps: [{ name: "Step L", description: "Retryable step", idempotent: true, maxRetries: 2 }]
      }
    });
    await engine.startWorkflowRun(flow8.id);
    const stepL = (await store.listWorkflowSteps(flow8.id))[0];
    await engine.failWorkflowStep(stepL.id, "Temporary error");
    const stepLFailed = await store.getWorkflowStep(stepL.id);
    assertions.push(assertEqual("step L failed", stepLFailed?.status, "failed"));

    const retryWorkflowStep = await engine.retryWorkflowStep(stepL.id, "operator-1");
    assertions.push(assertEqual("retry step created", retryWorkflowStep.status, "running"));
    assertions.push(assertEqual("retry step has retryOfStepId", retryWorkflowStep.retryOfStepId, stepL.id));
    assertions.push(assertEqual("retry step attempt", retryWorkflowStep.attemptNumber, 2));

    const flow8AfterRetry = await store.getWorkflowRun(flow8.id);
    assertions.push(assertEqual("workflow run current step is retry", flow8AfterRetry?.currentStepId, retryWorkflowStep.id));

    // Retry non-idempotent should fail
    const flow9 = await engine.createWorkflowRun({
      sessionId: "session-9",
      intent: makeIntent(),
      plan: {
        name: "No-retry Plan",
        description: "A plan that cannot retry",
        steps: [{ name: "Step M", description: "Non-retryable step" }]
      }
    });
    await engine.startWorkflowRun(flow9.id);
    const stepM = (await store.listWorkflowSteps(flow9.id))[0];
    await engine.failWorkflowStep(stepM.id, "Error");
    try {
      await engine.retryWorkflowStep(stepM.id);
      assertions.push(assertEqual("retry non-idempotent threw", "no-throw", "throw"));
    } catch {
      assertions.push(assertEqual("retry non-idempotent threw", "throw", "throw"));
    }

    // ─── WorkflowCheckpoint ───
    const flow10 = await engine.createWorkflowRun({
      sessionId: "session-10",
      intent: makeIntent(),
      plan: {
        name: "WorkflowCheckpoint Plan",
        description: "A plan to checkpoint",
        steps: [
          { name: "Step N", description: "First" },
          { name: "Step O", description: "Second" }
        ]
      }
    });
    await engine.startWorkflowRun(flow10.id);
    const checkpoint = await engine.createWorkflowCheckpoint(flow10.id, "before-step-o", "Taken before step O", "operator-1");
    assertions.push(assertEqual("checkpoint name", checkpoint.name, "before-step-o"));
    assertions.push(assertEqual("checkpoint workflow run state", checkpoint.snapshot.runState, "running"));

    const checkpoints = await store.listWorkflowCheckpoints(flow10.id);
    assertions.push(assertEqual("1 checkpoint", checkpoints.length, 1));

    const flow10AfterCheckpoint = await store.getWorkflowRun(flow10.id);
    assertions.push(assertEqual("checkpoint count updated", flow10AfterCheckpoint?.checkpointCount, 1));

    // ─── Approval gate ───
    const flow11 = await engine.createWorkflowRun({
      sessionId: "session-11",
      intent: makeIntent(),
      plan: {
        name: "Approval Plan",
        description: "A plan needing approval",
        steps: [{ name: "Step P", description: "Risky step" }]
      }
    });
    await engine.startWorkflowRun(flow11.id);
    const stepP = (await store.listWorkflowSteps(flow11.id))[0];
    await engine.waitForApproval(stepP.id, {
      reason: "High-risk action",
      riskClass: "destructive-local" as ToolRiskClass,
      toolName: "terminal",
      toolExecutorDecision: "ask"
    });
    const stepPAfterWait = await store.getWorkflowStep(stepP.id);
    assertions.push(assertEqual("step waiting for approval", stepPAfterWait?.status, "waiting_for_approval"));

    await engine.approveStep(stepP.id, "operator-1", "grant-1");
    const stepPAfterApprove = await store.getWorkflowStep(stepP.id);
    assertions.push(assertEqual("step running after approve", stepPAfterApprove?.status, "running"));

    const gatesAfterApprove = await store.listWorkflowApprovalGates(flow11.id, { status: "approved" });
    assertions.push(assertEqual("1 approved gate", gatesAfterApprove.length, 1));

    // Reject approval
    const flow12 = await engine.createWorkflowRun({
      sessionId: "session-12",
      intent: makeIntent(),
      plan: {
        name: "Reject Plan",
        description: "A plan to reject",
        steps: [{ name: "Step Q", description: "Another risky step" }]
      }
    });
    await engine.startWorkflowRun(flow12.id);
    const stepQ = (await store.listWorkflowSteps(flow12.id))[0];
    await engine.waitForApproval(stepQ.id, {
      reason: "Another high-risk action",
      riskClass: "destructive-local" as ToolRiskClass,
      toolName: "terminal",
      toolExecutorDecision: "ask"
    });
    await engine.rejectStep(stepQ.id, "operator-1", "Too risky");
    const stepQAfterReject = await store.getWorkflowStep(stepQ.id);
    assertions.push(assertEqual("step failed after reject", stepQAfterReject?.status, "failed"));
    const flow12AfterReject = await store.getWorkflowRun(flow12.id);
    assertions.push(assertEqual("workflow run failed after reject", flow12AfterReject?.status, "failed"));

    return buildResult("workflow-engine-lifecycle", "WorkflowEngine workflow run and step lifecycle methods", assertions, Date.now() - startedAt);
  }
};
