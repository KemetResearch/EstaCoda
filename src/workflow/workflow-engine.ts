// WorkflowEngine — core orchestrator for durable workflow run execution
// Track 2: Engine — workflow run/step lifecycle, pause/resume, interrupt, wait, retry, checkpoint

import type {
  WorkflowRun,
  WorkflowRunId,
  WorkflowPlan,
  WorkflowPlanStep,
  WorkflowRunState,
  WorkflowStep,
  WorkflowStepId,
  WorkflowStepState,
  WorkflowEvent,
  WorkflowOperatorEvent,
  WorkflowCheckpoint,
  WorkflowCheckpointSnapshot,
  WorkflowApprovalGate,
  WaitReason,
  WorkflowProcess
} from "./types.js";
import {
  validateWorkflowRunTransition,
  validateWorkflowStepTransition,
  isWorkflowRunStateTerminal,
  isWorkflowStepStateTerminal,
  isRetryAllowed,
  defaultRetryPolicy,
  defaultFailurePolicy,
  IllegalTransitionError
} from "./types.js";
import type { WorkflowStore } from "./workflow-store.js";
import type { WorkflowLockService } from "./workflow-lock-service.js";
import type { IntentRoute } from "../contracts/intent.js";
import type { ToolCallPlan } from "../contracts/tool-plan.js";
import type { ToolRiskClass } from "../contracts/tool.js";

export type WorkflowEngineOptions = {
  store: WorkflowStore;
  lockService: WorkflowLockService;
  ownerId: string;
  now?: () => Date;
  id?: () => string;
};

export type CreateWorkflowRunInput = {
  sessionId: string;
  intent: IntentRoute;
  plan: WorkflowPlan;
  selectedSkill?: string;
  metadata?: Record<string, unknown>;
};

export type StartWorkflowRunResult =
  | { ok: true; run: WorkflowRun }
  | { ok: false; error: string };

export type WorkflowStepCompletionResult =
  | { ok: true; run: WorkflowRun; nextStep?: WorkflowStep }
  | { ok: false; error: string };

export class WorkflowEngine {
  readonly #store: WorkflowStore;
  readonly #lockService: WorkflowLockService;
  readonly #ownerId: string;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: WorkflowEngineOptions) {
    this.#store = options.store;
    this.#lockService = options.lockService;
    this.#ownerId = options.ownerId;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? (() => crypto.randomUUID());
  }

  // ─── WorkflowRun lifecycle ───

  async createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
    const now = this.#now().toISOString();
    const run: WorkflowRun = {
      id: this.#id(),
      sessionId: input.sessionId,
      status: "pending",
      intent: input.intent,
      selectedSkill: input.selectedSkill,
      createdAt: now,
      updatedAt: now,
      checkpointCount: 0,
      stepCount: 0,
      retryCount: 0,
      metadata: input.metadata ?? {}
    };

    await this.#store.atomicTransition(run.id, async (tx) => {
      await tx.createWorkflowRun(run);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(run.id, "flow-created", { planName: input.plan.name }));
    });

    // Create steps from plan
    for (let i = 0; i < input.plan.steps.length; i++) {
      await this.#createStepFromPlan(run.id, input.plan.steps[i], i);
    }

    // Update step count
    const updatedFlow = await this.#store.getWorkflowRun(run.id);
    if (updatedFlow) {
      updatedFlow.stepCount = input.plan.steps.length;
      updatedFlow.updatedAt = this.#now().toISOString();
      await this.#store.updateWorkflowRun(updatedFlow);
    }

    return (await this.#store.getWorkflowRun(run.id)) ?? run;
  }

  async startWorkflowRun(runId: WorkflowRunId): Promise<StartWorkflowRunResult> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) return { ok: false, error: "Workflow run not found" };
    if (run.status !== "pending") return { ok: false, error: `Cannot start workflow run in state ${run.status}` };

    const acquired = await this.#lockService.acquire(runId, this.#ownerId);
    if (!acquired) return { ok: false, error: "Could not acquire workflow run lock" };

    try {
      await this.#transitionWorkflowRun(runId, "running", { from: "pending" });

      const steps = await this.#store.listWorkflowSteps(runId);
      if (steps.length === 0) {
        await this.#transitionWorkflowRun(runId, "completed", { from: "running" });
        const completedFlow = await this.#store.getWorkflowRun(runId);
        return { ok: true, run: completedFlow! };
      }

      const firstStep = steps[0];
      await this.#transitionStep(firstStep.id, "running", { from: "pending" });

      const updatedFlow = await this.#store.getWorkflowRun(runId);
      if (updatedFlow) {
        updatedFlow.currentStepId = firstStep.id;
        updatedFlow.updatedAt = this.#now().toISOString();
        await this.#store.updateWorkflowRun(updatedFlow);
      }

      return { ok: true, run: (await this.#store.getWorkflowRun(runId))! };
    } catch (error) {
      await this.#lockService.release(runId, this.#ownerId);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async completeWorkflowRun(runId: WorkflowRunId): Promise<WorkflowRun> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    await this.#transitionWorkflowRun(runId, "completed", { from: run.status as WorkflowRunState });
    await this.#lockService.release(runId, this.#ownerId);

    const updated = await this.#store.getWorkflowRun(runId);
    return updated!;
  }

  async failWorkflowRun(runId: WorkflowRunId, reason?: string): Promise<WorkflowRun> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    await this.#transitionWorkflowRun(runId, "failed", { from: run.status as WorkflowRunState, reason });
    await this.#lockService.release(runId, this.#ownerId);

    const updated = await this.#store.getWorkflowRun(runId);
    return updated!;
  }

  async cancelWorkflowRun(runId: WorkflowRunId, reason?: string, operator?: string): Promise<WorkflowRun> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    if (isWorkflowRunStateTerminal(run.status)) {
      return run;
    }

    await this.#store.atomicTransition(runId, async (tx) => {
      // Cancel all active steps
      const steps = await tx.listWorkflowSteps(runId);
      for (const step of steps) {
        if (!isWorkflowStepStateTerminal(step.status)) {
          await this.#cancelStepInTx(tx, step.id, reason);
        }
      }

      await this.#transitionWorkflowRunInTx(tx, runId, "cancelled", { from: run.status as WorkflowRunState, reason });

      if (operator) {
        await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, undefined, "operator-cancelled", operator, "/cancel", "Workflow run cancelled", run.status, "cancelled", { reason }));
      }
    });

    await this.#lockService.release(runId, this.#ownerId);

    const updated = await this.#store.getWorkflowRun(runId);
    return updated!;
  }

  // ─── Step lifecycle ───

  async createWorkflowStep(runId: WorkflowRunId, name: string, description: string, options?: {
    requiresApproval?: boolean;
    skippable?: boolean;
    maxRetries?: number;
    idempotent?: boolean;
    onFailure?: "stop" | "retry" | "skip" | "escalate";
  }): Promise<WorkflowStep> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    const steps = await this.#store.listWorkflowSteps(runId);
    const index = steps.length;

    const now = this.#now().toISOString();
    const step: WorkflowStep = {
      id: this.#id(),
      runId,
      index,
      status: "pending",
      name,
      description,
      toolPlans: [],
      executions: [],
      retryPolicy: defaultRetryPolicy(),
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 1,
      idempotent: options?.idempotent ?? false,
      safeToRetry: options?.idempotent ?? false,
      failurePolicy: {
        ...defaultFailurePolicy(),
        defaultAction: options?.onFailure ?? "stop",
        allowSkipIfSkippable: options?.skippable ?? false
      },
      attemptNumber: 1,
      createdAt: now,
      updatedAt: now
    };

    await this.#store.atomicTransition(runId, async (tx) => {
      await tx.createWorkflowStep(step);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "step-created", { stepId: step.id, stepName: name, stepIndex: index }, step.id));
    });

    return step;
  }

  async startWorkflowStep(stepId: WorkflowStepId): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    await this.#transitionStep(stepId, "running", { from: step.status });

    const updated = await this.#store.getWorkflowStep(stepId);
    return updated!;
  }

  async completeWorkflowStep(stepId: WorkflowStepId): Promise<WorkflowStepCompletionResult> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) return { ok: false, error: "Step not found" };

    const runId = step.runId;

    await this.#transitionStep(stepId, "completed", { from: step.status });

    // Advance to next step or complete workflow run
    const steps = await this.#store.listWorkflowSteps(runId);
    const currentIndex = steps.findIndex((s) => s.id === stepId);
    let nextStep = steps[currentIndex + 1];

    // Auto-skip consecutive skippable pending steps
    while (nextStep && nextStep.status === "pending" && nextStep.failurePolicy.allowSkipIfSkippable) {
      await this.#transitionStep(nextStep.id, "skipped", { from: "pending", reason: "Auto-skip by policy" });
      const nextIndex = steps.findIndex((s) => s.id === nextStep!.id) + 1;
      nextStep = steps[nextIndex];
    }

    if (nextStep && nextStep.status === "pending") {
      await this.#transitionStep(nextStep.id, "running", { from: "pending" });
      const run = await this.#store.getWorkflowRun(runId);
      if (run) {
        run.currentStepId = nextStep.id;
        run.updatedAt = this.#now().toISOString();
        await this.#store.updateWorkflowRun(run);
      }
      return { ok: true, run: (await this.#store.getWorkflowRun(runId))!, nextStep: (await this.#store.getWorkflowStep(nextStep.id))! };
    }

    // No more pending steps — check if workflow run should complete
    const allTerminal = steps.every((s) => isWorkflowStepStateTerminal(s.status));
    if (allTerminal) {
      const run = await this.#store.getWorkflowRun(runId);
      if (run && !isWorkflowRunStateTerminal(run.status)) {
        await this.#transitionWorkflowRun(runId, "completed", { from: run.status as WorkflowRunState });
        await this.#lockService.release(runId, this.#ownerId);
      }
    }

    return { ok: true, run: (await this.#store.getWorkflowRun(runId))! };
  }

  async failWorkflowStep(stepId: WorkflowStepId, error?: string): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    const runId = step.runId;

    await this.#store.atomicTransition(runId, async (tx) => {
      await this.#transitionStepInTx(tx, stepId, "failed", { from: step.status, reason: error });

      // Apply failure policy
      const updatedStep = await tx.getWorkflowStep(stepId);
      if (updatedStep) {
        if (updatedStep.failurePolicy.defaultAction === "stop") {
          const run = await tx.getWorkflowRun(runId);
          if (run && !isWorkflowRunStateTerminal(run.status)) {
            await this.#transitionWorkflowRunInTx(tx, runId, "failed", { from: run.status as WorkflowRunState, reason: `Step ${updatedStep.name} failed: ${error ?? "unknown error"}` });
          }
        }
      }
    });

    const updated = await this.#store.getWorkflowStep(stepId);
    return updated!;
  }

  async skipWorkflowStep(stepId: WorkflowStepId, reason?: string, operator?: string): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    if (!step.failurePolicy.allowSkipIfSkippable) {
      throw new Error("Step is not skippable");
    }

    // Skip means "never executed". A step that has already started execution
    // cannot be skipped — it must be interrupted or cancelled.
    if (step.startedAt) {
      throw new IllegalTransitionError("step", step.status, "skipped");
    }

    const runId = step.runId;

    await this.#store.atomicTransition(runId, async (tx) => {
      await this.#transitionStepInTx(tx, stepId, "skipped", { from: step.status, reason });
      if (operator) {
        await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, stepId, "operator-skipped", operator, "/skip", "Step skipped", step.status, "skipped", { reason }));
      }
    });

    // Advance workflow run after skip
    const steps = await this.#store.listWorkflowSteps(runId);
    const currentIndex = steps.findIndex((s) => s.id === stepId);
    const nextStep = steps[currentIndex + 1];

    if (nextStep && nextStep.status === "pending") {
      await this.#transitionStep(nextStep.id, "running", { from: "pending" });
      const run = await this.#store.getWorkflowRun(runId);
      if (run) {
        run.currentStepId = nextStep.id;
        run.updatedAt = this.#now().toISOString();
        await this.#store.updateWorkflowRun(run);
      }
    } else {
      const allTerminal = steps.every((s) => isWorkflowStepStateTerminal(s.status));
      if (allTerminal) {
        const run = await this.#store.getWorkflowRun(runId);
        if (run && !isWorkflowRunStateTerminal(run.status)) {
          await this.#transitionWorkflowRun(runId, "completed", { from: run.status as WorkflowRunState });
          await this.#lockService.release(runId, this.#ownerId);
        }
      }
    }

    return (await this.#store.getWorkflowStep(stepId))!;
  }

  // ─── Pause / resume ───

  async requestWorkflowPause(runId: WorkflowRunId, reason?: string, operator?: string): Promise<WorkflowRun> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    if (run.status !== "running") {
      throw new Error(`Cannot pause workflow run in state ${run.status}`);
    }

    await this.#store.atomicTransition(runId, async (tx) => {
      const f = await tx.getWorkflowRun(runId);
      if (!f) return;
      f.pauseRequestedAt = this.#now().toISOString();
      f.pauseReason = reason;
      f.updatedAt = this.#now().toISOString();
      await tx.updateWorkflowRun(f);

      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "pause-requested", { reason }));
      if (operator) {
        await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, undefined, "operator-pause-requested", operator, "/pause", "Pause requested", run.status, run.status, { reason }));
      }
    });

    return (await this.#store.getWorkflowRun(runId))!;
  }

  async applyWorkflowPauseAtBoundary(runId: WorkflowRunId): Promise<WorkflowRun> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    await this.#transitionWorkflowRun(runId, "paused", { from: "running", reason: run.pauseReason ?? "Paused at safe boundary" });

    // Pause current step too
    const steps = await this.#store.listWorkflowSteps(runId);
    for (const step of steps) {
      if (step.status === "running") {
        await this.#transitionStep(step.id, "paused", { from: "running" });
      }
    }

    return (await this.#store.getWorkflowRun(runId))!;
  }

  async resumeWorkflowRun(runId: WorkflowRunId, operator?: string): Promise<WorkflowRun> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    if (run.status !== "paused" && run.status !== "interrupted" && run.status !== "waiting") {
      throw new Error(`Cannot resume workflow run in state ${run.status}`);
    }

    await this.#store.atomicTransition(runId, async (tx) => {
      await this.#transitionWorkflowRunInTx(tx, runId, "running", { from: run.status as WorkflowRunState });

      // Resume current step if paused
      const steps = await tx.listWorkflowSteps(runId);
      for (const step of steps) {
        if (step.status === "paused") {
          step.status = "running";
          step.resumedAt = this.#now().toISOString();
          step.updatedAt = this.#now().toISOString();
          await tx.updateWorkflowStep(step);
          await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "step-started", { stepId: step.id, resumed: true }, step.id));
        }
      }

      if (operator) {
        await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, undefined, "operator-resumed", operator, "/resume", "Workflow run resumed", run.status, "running"));
      }
    });

    return (await this.#store.getWorkflowRun(runId))!;
  }

  // ─── Interrupt ───

  async interruptWorkflowRun(runId: WorkflowRunId, reason?: string, operator?: string): Promise<WorkflowRun> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    if (run.status !== "running" && run.status !== "paused" && run.status !== "waiting") {
      throw new Error(`Cannot interrupt workflow run in state ${run.status}`);
    }

    await this.#store.atomicTransition(runId, async (tx) => {
      // Interrupt active steps
      const steps = await tx.listWorkflowSteps(runId);
      for (const step of steps) {
        if (step.status === "running" || step.status === "paused" || step.status === "waiting_for_approval" || step.status === "waiting_for_input") {
          await this.#transitionStepInTx(tx, step.id, "interrupted", { from: step.status, reason });
        }
      }

      await this.#transitionWorkflowRunInTx(tx, runId, "interrupted", { from: run.status as WorkflowRunState, reason });

      if (operator) {
        await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, undefined, "operator-interrupted", operator, "/interrupt", "Workflow run interrupted", run.status, "interrupted", { reason }));
      }
    });

    return (await this.#store.getWorkflowRun(runId))!;
  }

  // ─── Wait ───

  async waitForApproval(stepId: WorkflowStepId, gate: Omit<WorkflowApprovalGate, "id" | "stepId" | "runId" | "requestedAt" | "status">): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    const runId = step.runId;
    const now = this.#now().toISOString();

    const fullGate: WorkflowApprovalGate = {
      id: this.#id(),
      stepId,
      runId,
      status: "pending",
      requestedAt: now,
      ...gate
    };

    await this.#store.atomicTransition(runId, async (tx) => {
      await tx.createWorkflowApprovalGate(fullGate);
      await this.#transitionStepInTx(tx, stepId, "waiting_for_approval", { from: step.status });
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "approval-requested", { stepId, gateId: fullGate.id }, stepId));
    });

    return (await this.#store.getWorkflowStep(stepId))!;
  }

  async waitForInput(stepId: WorkflowStepId, waitReason: WaitReason): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    const runId = step.runId;

    await this.#store.atomicTransition(runId, async (tx) => {
      const s = await tx.getWorkflowStep(stepId);
      if (!s) return;
      s.status = "waiting_for_input";
      s.waitReason = waitReason;
      s.waitStartedAt = this.#now().toISOString();
      s.updatedAt = this.#now().toISOString();
      await tx.updateWorkflowStep(s);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "wait-started", { stepId, kind: waitReason.kind, description: waitReason.description }, stepId));
    });

    // Transition workflow run to waiting
    const run = await this.#store.getWorkflowRun(runId);
    if (run && run.status === "running") {
      await this.#transitionWorkflowRun(runId, "waiting", { from: "running" });
    }

    return (await this.#store.getWorkflowStep(stepId))!;
  }

  async resolveWait(stepId: WorkflowStepId): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    if (step.status !== "waiting_for_input" && step.status !== "waiting_for_approval") {
      throw new Error(`Step is not waiting (status: ${step.status})`);
    }

    const runId = step.runId;

    await this.#store.atomicTransition(runId, async (tx) => {
      const s = await tx.getWorkflowStep(stepId);
      if (!s) return;
      const fromStatus = s.status;
      s.status = "running";
      s.waitReason = undefined;
      s.waitEndedAt = this.#now().toISOString();
      s.updatedAt = this.#now().toISOString();
      await tx.updateWorkflowStep(s);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "wait-ended", { stepId, previousStatus: fromStatus }, stepId));

      // If workflow run was waiting, resume it
      const run = await tx.getWorkflowRun(runId);
      if (run && run.status === "waiting") {
        await this.#transitionWorkflowRunInTx(tx, runId, "running", { from: "waiting" });
      }
    });

    return (await this.#store.getWorkflowStep(stepId))!;
  }

  async approveStep(stepId: WorkflowStepId, operator: string, grantId?: string): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    const runId = step.runId;
    const gates = await this.#store.listWorkflowApprovalGates(runId, { stepId, status: "pending" });
    if (gates.length === 0) throw new Error("No pending approval gate found for step");

    const gate = gates[0];
    const now = this.#now().toISOString();

    await this.#store.atomicTransition(runId, async (tx) => {
      gate.status = "approved";
      gate.resolvedAt = now;
      gate.resolvedBy = operator;
      gate.controllerGrantId = grantId;
      await tx.updateWorkflowApprovalGate(gate);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "approval-granted", { stepId, gateId: gate.id, operator }, stepId));
      await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, stepId, "operator-approved", operator, "/approve", "Approval granted", "waiting_for_approval", "running", { gateId: gate.id }));
      await this.#resolveWaitInTx(tx, stepId);
    });

    return (await this.#store.getWorkflowStep(stepId))!;
  }

  async rejectStep(stepId: WorkflowStepId, operator: string, rejectionReason?: string): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    const runId = step.runId;
    const gates = await this.#store.listWorkflowApprovalGates(runId, { stepId, status: "pending" });
    if (gates.length === 0) throw new Error("No pending approval gate found for step");

    const gate = gates[0];
    const now = this.#now().toISOString();

    await this.#store.atomicTransition(runId, async (tx) => {
      gate.status = "rejected";
      gate.resolvedAt = now;
      gate.resolvedBy = operator;
      await tx.updateWorkflowApprovalGate(gate);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "approval-denied", { stepId, gateId: gate.id, operator, reason: rejectionReason }, stepId));
      await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, stepId, "operator-rejected", operator, "/reject", "Approval denied", "waiting_for_approval", "failed", { gateId: gate.id, reason: rejectionReason }));

      // Apply failure policy
      const updatedStep = await tx.getWorkflowStep(stepId);
      if (updatedStep) {
        updatedStep.status = "failed";
        updatedStep.failedAt = now;
        updatedStep.updatedAt = now;
        await tx.updateWorkflowStep(updatedStep);
        await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "step-failed", { stepId, reason: rejectionReason ?? "Approval denied by operator" }, stepId));

        if (updatedStep.failurePolicy.defaultAction === "stop") {
          const run = await tx.getWorkflowRun(runId);
          if (run && !isWorkflowRunStateTerminal(run.status)) {
            await this.#transitionWorkflowRunInTx(tx, runId, "failed", { from: run.status as WorkflowRunState, reason: `Step ${updatedStep.name} rejected` });
          }
        }
      }
    });

    return (await this.#store.getWorkflowStep(stepId))!;
  }

  // ─── Retry ───

  async retryWorkflowStep(stepId: WorkflowStepId, operator?: string): Promise<WorkflowStep> {
    const step = await this.#store.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    if (!isRetryAllowed(step)) {
      throw new Error("Retry not allowed for this step (not idempotent or safeToRetry)");
    }

    if (step.retryCount >= step.maxRetries) {
      throw new Error(`Max retries (${step.maxRetries}) exceeded`);
    }

    const runId = step.runId;
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    const now = this.#now().toISOString();
    const retryWorkflowStep: WorkflowStep = {
      id: this.#id(),
      runId,
      index: step.index,
      status: "pending",
      name: step.name,
      description: step.description,
      toolPlans: step.toolPlans,
      executions: [],
      retryPolicy: step.retryPolicy,
      retryCount: step.retryCount + 1,
      maxRetries: step.maxRetries,
      idempotent: step.idempotent,
      safeToRetry: step.safeToRetry,
      failurePolicy: step.failurePolicy,
      retryOfStepId: step.id,
      attemptNumber: step.attemptNumber + 1,
      createdAt: now,
      updatedAt: now
    };

    await this.#store.atomicTransition(runId, async (tx) => {
      await tx.createWorkflowStep(retryWorkflowStep);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "step-retried", { originalStepId: stepId, retryStepId: retryWorkflowStep.id, attempt: retryWorkflowStep.attemptNumber }, stepId));
      if (operator) {
        await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, stepId, "operator-retried", operator, "/retry", "Step retried", "failed", "pending", { retryStepId: retryWorkflowStep.id }));
      }

      // Update workflow run retry count
      const f = await tx.getWorkflowRun(runId);
      if (f) {
        f.retryCount = (f.retryCount ?? 0) + 1;
        f.updatedAt = now;
        await tx.updateWorkflowRun(f);
      }
    });

    // Start the retry step immediately
    await this.#transitionStep(retryWorkflowStep.id, "running", { from: "pending" });

    // Update workflow run current step
    const updatedFlow = await this.#store.getWorkflowRun(runId);
    if (updatedFlow) {
      updatedFlow.currentStepId = retryWorkflowStep.id;
      updatedFlow.updatedAt = now;
      await this.#store.updateWorkflowRun(updatedFlow);
    }

    return (await this.#store.getWorkflowStep(retryWorkflowStep.id))!;
  }

  // ─── WorkflowCheckpoint ───

  async createWorkflowCheckpoint(runId: WorkflowRunId, name: string, description?: string, operator?: string): Promise<WorkflowCheckpoint> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    const steps = await this.#store.listWorkflowSteps(runId);
    const stepStates: Record<WorkflowStepId, WorkflowStepState> = {};
    const waitReasons: Record<WorkflowStepId, WaitReason> = {};
    const retryCounts: Record<WorkflowStepId, number> = {};
    const pendingApprovals: string[] = [];

    for (const step of steps) {
      stepStates[step.id] = step.status;
      if (step.waitReason) waitReasons[step.id] = step.waitReason;
      retryCounts[step.id] = step.retryCount;
    }

    const gates = await this.#store.listWorkflowApprovalGates(runId, { status: "pending" });
    for (const gate of gates) {
      pendingApprovals.push(gate.id);
    }

    const snapshot: WorkflowCheckpointSnapshot = {
      runState: run.status,
      currentStepId: run.currentStepId,
      stepStates,
      pendingApprovals,
      waitReasons,
      workflowOperatorEvents: [],
      retryCounts
    };

    const checkpoint: WorkflowCheckpoint = {
      id: this.#id(),
      runId,
      stepId: run.currentStepId,
      name,
      description,
      snapshot,
      createdAt: this.#now().toISOString(),
      createdBy: operator ?? "system"
    };

    await this.#store.atomicTransition(runId, async (tx) => {
      await tx.createWorkflowCheckpoint(checkpoint);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "checkpoint-created", { checkpointId: checkpoint.id, name }, run.currentStepId));
      if (operator) {
        await tx.appendWorkflowOperatorEvent(this.#makeWorkflowOperatorEvent(runId, undefined, "operator-checkpointed", operator, "/checkpoint", "Checkpoint created", run.status, run.status, { checkpointId: checkpoint.id, name }));
      }

      const f = await tx.getWorkflowRun(runId);
      if (f) {
        f.checkpointCount = (f.checkpointCount ?? 0) + 1;
        f.updatedAt = this.#now().toISOString();
        await tx.updateWorkflowRun(f);
      }
    });

    return checkpoint;
  }

  // ─── Process registry helpers ───

  async registerWorkflowProcess(runId: WorkflowRunId, stepId: WorkflowStepId, process: Omit<WorkflowProcess, "id" | "runId" | "stepId" | "startedAt">): Promise<WorkflowProcess> {
    const run = await this.#store.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    const fullProcess: WorkflowProcess = {
      id: this.#id(),
      runId,
      stepId,
      ...process,
      startedAt: this.#now().toISOString()
    };

    await this.#store.atomicTransition(runId, async (tx) => {
      await tx.registerWorkflowProcess(fullProcess);
      await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, "process-registered", { stepId, processId: fullProcess.id, processType: process.processType }, stepId));
    });

    return fullProcess;
  }

  async updateWorkflowProcess(process: WorkflowProcess): Promise<void> {
    await this.#store.updateWorkflowProcess(process);
  }

  // ─── Internal helpers ───

  async #createStepFromPlan(runId: WorkflowRunId, planStep: WorkflowPlanStep, index: number): Promise<WorkflowStep> {
    return this.createWorkflowStep(runId, planStep.name, planStep.description, {
      requiresApproval: planStep.requiresApproval,
      skippable: planStep.skippable,
      maxRetries: planStep.maxRetries,
      idempotent: planStep.idempotent,
      onFailure: planStep.onFailure
    });
  }

  async #transitionWorkflowRun(runId: WorkflowRunId, to: WorkflowRunState, options: { from: WorkflowRunState; reason?: string }): Promise<void> {
    await this.#store.atomicTransition(runId, async (tx) => {
      await this.#transitionWorkflowRunInTx(tx, runId, to, options);
    });
  }

  async #transitionWorkflowRunInTx(tx: WorkflowStore, runId: WorkflowRunId, to: WorkflowRunState, options: { from: WorkflowRunState; reason?: string }): Promise<void> {
    validateWorkflowRunTransition(options.from, to);
    const run = await tx.getWorkflowRun(runId);
    if (!run) throw new Error("Workflow run not found");

    // Double-check current state hasn't changed
    if (run.status !== options.from) {
      throw new IllegalTransitionError("workflow run", run.status, to);
    }

    const now = this.#now().toISOString();
    run.status = to;
    run.updatedAt = now;

    if (to === "completed") run.completedAt = now;
    if (to === "cancelled") run.cancelledAt = now;
    if (to === "failed") run.failedAt = now;
    if (to === "interrupted") run.interruptReason = options.reason;
    if (to === "cancelled") run.cancelReason = options.reason;
    if (to === "failed") {
      run.failedAt = now;
      run.operatorSummary = options.reason;
    }

    await tx.updateWorkflowRun(run);

    const eventKind = to === "completed" ? "flow-completed"
      : to === "cancelled" ? "flow-cancelled"
      : to === "failed" ? "flow-failed"
      : "flow-state-changed";
    await tx.appendWorkflowEvent(this.#makeWorkflowEvent(runId, eventKind, { from: options.from, to, reason: options.reason }));
  }

  async #transitionStep(stepId: WorkflowStepId, to: WorkflowStepState, options: { from: WorkflowStepState; reason?: string }): Promise<void> {
    await this.#store.atomicTransition((await this.#store.getWorkflowStep(stepId))!.runId, async (tx) => {
      await this.#transitionStepInTx(tx, stepId, to, options);
    });
  }

  async #transitionStepInTx(tx: WorkflowStore, stepId: WorkflowStepId, to: WorkflowStepState, options: { from: WorkflowStepState; reason?: string }): Promise<void> {
    validateWorkflowStepTransition(options.from, to);
    const step = await tx.getWorkflowStep(stepId);
    if (!step) throw new Error("Step not found");

    if (step.status !== options.from) {
      throw new IllegalTransitionError("step", step.status, to);
    }

    const now = this.#now().toISOString();
    step.status = to;
    step.updatedAt = now;

    if (to === "running") step.startedAt = now;
    if (to === "completed") step.completedAt = now;
    if (to === "failed") {
      step.failedAt = now;
      step.pauseReason = options.reason;
    }
    if (to === "cancelled") step.cancelledAt = now;
    if (to === "paused") step.pausedAt = now;
    if (to === "interrupted") step.interruptReason = options.reason;
    if (to === "skipped") step.skipReason = options.reason;

    await tx.updateWorkflowStep(step);

    const eventKind = to === "completed" ? "step-completed"
      : to === "failed" ? "step-failed"
      : to === "cancelled" ? "step-cancelled"
      : to === "interrupted" ? "step-interrupted"
      : to === "skipped" ? "step-skipped"
      : "step-started";
    await tx.appendWorkflowEvent(this.#makeWorkflowEvent(step.runId, eventKind, { stepId, from: options.from, to, reason: options.reason }, stepId));
  }

  async #cancelStepInTx(tx: WorkflowStore, stepId: WorkflowStepId, reason?: string): Promise<void> {
    const step = await tx.getWorkflowStep(stepId);
    if (!step) return;
    if (isWorkflowStepStateTerminal(step.status)) return;
    await this.#transitionStepInTx(tx, stepId, "cancelled", { from: step.status, reason });
  }

  async #resolveWaitInTx(tx: WorkflowStore, stepId: WorkflowStepId): Promise<void> {
    const step = await tx.getWorkflowStep(stepId);
    if (!step) return;
    const fromStatus = step.status;
    step.status = "running";
    step.waitReason = undefined;
    step.waitEndedAt = this.#now().toISOString();
    step.updatedAt = this.#now().toISOString();
    await tx.updateWorkflowStep(step);
    await tx.appendWorkflowEvent(this.#makeWorkflowEvent(step.runId, "wait-ended", { stepId, previousStatus: fromStatus }, stepId));

    const run = await tx.getWorkflowRun(step.runId);
    if (run && run.status === "waiting") {
      await this.#transitionWorkflowRunInTx(tx, run.id, "running", { from: "waiting" });
    }
  }

  #makeWorkflowEvent(runId: WorkflowRunId, kind: WorkflowEvent["kind"], data?: Record<string, unknown>, stepId?: WorkflowStepId): WorkflowEvent {
    return {
      id: this.#id(),
      runId,
      stepId,
      kind,
      data: data ?? {},
      timestamp: this.#now().toISOString()
    };
  }

  #makeWorkflowOperatorEvent(
    runId: WorkflowRunId,
    stepId: WorkflowStepId | undefined,
    kind: WorkflowOperatorEvent["kind"],
    operator: string,
    command: string,
    effect: string,
    previousState: WorkflowRunState | WorkflowStepState,
    newState: WorkflowRunState | WorkflowStepState,
    metadata?: Record<string, unknown>
  ): WorkflowOperatorEvent {
    return {
      id: this.#id(),
      runId,
      stepId,
      kind,
      operator,
      command,
      effect,
      previousState,
      newState,
      metadata,
      timestamp: this.#now().toISOString()
    };
  }
}
