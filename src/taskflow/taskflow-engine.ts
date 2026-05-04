// TaskFlowEngine — core orchestrator for durable flow execution
// Track 2: Engine — flow/step lifecycle, pause/resume, interrupt, wait, retry, checkpoint

import type {
  Flow,
  FlowId,
  FlowPlan,
  FlowPlanStep,
  FlowState,
  FlowStep,
  StepId,
  StepState,
  FlowEvent,
  OperatorEvent,
  Checkpoint,
  CheckpointSnapshot,
  ApprovalGate,
  WaitReason,
  FlowProcess
} from "./types.js";
import {
  validateFlowTransition,
  validateStepTransition,
  isFlowStateTerminal,
  isStepStateTerminal,
  isRetryAllowed,
  defaultRetryPolicy,
  defaultFailurePolicy,
  IllegalTransitionError
} from "./types.js";
import type { TaskFlowStore } from "./taskflow-store.js";
import type { FlowLockService } from "./flow-lock-service.js";
import type { IntentRoute } from "../contracts/intent.js";
import type { ToolCallPlan } from "../contracts/tool-plan.js";
import type { ToolRiskClass } from "../contracts/tool.js";

export type TaskFlowEngineOptions = {
  store: TaskFlowStore;
  lockService: FlowLockService;
  ownerId: string;
  now?: () => Date;
  id?: () => string;
};

export type CreateFlowInput = {
  sessionId: string;
  intent: IntentRoute;
  plan: FlowPlan;
  selectedSkill?: string;
};

export type StartFlowResult =
  | { ok: true; flow: Flow }
  | { ok: false; error: string };

export type StepCompletionResult =
  | { ok: true; flow: Flow; nextStep?: FlowStep }
  | { ok: false; error: string };

export class TaskFlowEngine {
  readonly #store: TaskFlowStore;
  readonly #lockService: FlowLockService;
  readonly #ownerId: string;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: TaskFlowEngineOptions) {
    this.#store = options.store;
    this.#lockService = options.lockService;
    this.#ownerId = options.ownerId;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? (() => crypto.randomUUID());
  }

  // ─── Flow lifecycle ───

  async createFlow(input: CreateFlowInput): Promise<Flow> {
    const now = this.#now().toISOString();
    const flow: Flow = {
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
      metadata: {}
    };

    await this.#store.atomicTransition(flow.id, async (tx) => {
      await tx.createFlow(flow);
      await tx.appendFlowEvent(this.#makeFlowEvent(flow.id, "flow-created", { planName: input.plan.name }));
    });

    // Create steps from plan
    for (let i = 0; i < input.plan.steps.length; i++) {
      await this.#createStepFromPlan(flow.id, input.plan.steps[i], i);
    }

    // Update step count
    const updatedFlow = await this.#store.getFlow(flow.id);
    if (updatedFlow) {
      updatedFlow.stepCount = input.plan.steps.length;
      updatedFlow.updatedAt = this.#now().toISOString();
      await this.#store.updateFlow(updatedFlow);
    }

    return (await this.#store.getFlow(flow.id)) ?? flow;
  }

  async startFlow(flowId: FlowId): Promise<StartFlowResult> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) return { ok: false, error: "Flow not found" };
    if (flow.status !== "pending") return { ok: false, error: `Cannot start flow in state ${flow.status}` };

    const acquired = await this.#lockService.acquire(flowId, this.#ownerId);
    if (!acquired) return { ok: false, error: "Could not acquire flow lock" };

    try {
      await this.#transitionFlow(flowId, "running", { from: "pending" });

      const steps = await this.#store.listSteps(flowId);
      if (steps.length === 0) {
        await this.#transitionFlow(flowId, "completed", { from: "running" });
        const completedFlow = await this.#store.getFlow(flowId);
        return { ok: true, flow: completedFlow! };
      }

      const firstStep = steps[0];
      await this.#transitionStep(firstStep.id, "running", { from: "pending" });

      const updatedFlow = await this.#store.getFlow(flowId);
      if (updatedFlow) {
        updatedFlow.currentStepId = firstStep.id;
        updatedFlow.updatedAt = this.#now().toISOString();
        await this.#store.updateFlow(updatedFlow);
      }

      return { ok: true, flow: (await this.#store.getFlow(flowId))! };
    } catch (error) {
      await this.#lockService.release(flowId, this.#ownerId);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async completeFlow(flowId: FlowId): Promise<Flow> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    await this.#transitionFlow(flowId, "completed", { from: flow.status as FlowState });
    await this.#lockService.release(flowId, this.#ownerId);

    const updated = await this.#store.getFlow(flowId);
    return updated!;
  }

  async failFlow(flowId: FlowId, reason?: string): Promise<Flow> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    await this.#transitionFlow(flowId, "failed", { from: flow.status as FlowState, reason });
    await this.#lockService.release(flowId, this.#ownerId);

    const updated = await this.#store.getFlow(flowId);
    return updated!;
  }

  async cancelFlow(flowId: FlowId, reason?: string, operator?: string): Promise<Flow> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    if (isFlowStateTerminal(flow.status)) {
      return flow;
    }

    await this.#store.atomicTransition(flowId, async (tx) => {
      // Cancel all active steps
      const steps = await tx.listSteps(flowId);
      for (const step of steps) {
        if (!isStepStateTerminal(step.status)) {
          await this.#cancelStepInTx(tx, step.id, reason);
        }
      }

      await this.#transitionFlowInTx(tx, flowId, "cancelled", { from: flow.status as FlowState, reason });

      if (operator) {
        await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, undefined, "operator-cancelled", operator, "/cancel", "Flow cancelled", flow.status, "cancelled", { reason }));
      }
    });

    await this.#lockService.release(flowId, this.#ownerId);

    const updated = await this.#store.getFlow(flowId);
    return updated!;
  }

  // ─── Step lifecycle ───

  async createStep(flowId: FlowId, name: string, description: string, options?: {
    requiresApproval?: boolean;
    skippable?: boolean;
    maxRetries?: number;
    idempotent?: boolean;
    onFailure?: "stop" | "retry" | "skip" | "escalate";
  }): Promise<FlowStep> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    const steps = await this.#store.listSteps(flowId);
    const index = steps.length;

    const now = this.#now().toISOString();
    const step: FlowStep = {
      id: this.#id(),
      flowId,
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

    await this.#store.atomicTransition(flowId, async (tx) => {
      await tx.createStep(step);
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "step-created", { stepId: step.id, stepName: name, stepIndex: index }));
    });

    return step;
  }

  async startStep(stepId: StepId): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    await this.#transitionStep(stepId, "running", { from: step.status });

    const updated = await this.#store.getStep(stepId);
    return updated!;
  }

  async completeStep(stepId: StepId): Promise<StepCompletionResult> {
    const step = await this.#store.getStep(stepId);
    if (!step) return { ok: false, error: "Step not found" };

    const flowId = step.flowId;

    await this.#transitionStep(stepId, "completed", { from: step.status });

    // Advance to next step or complete flow
    const steps = await this.#store.listSteps(flowId);
    const currentIndex = steps.findIndex((s) => s.id === stepId);
    const nextStep = steps[currentIndex + 1];

    if (nextStep && nextStep.status === "pending") {
      await this.#transitionStep(nextStep.id, "running", { from: "pending" });
      const flow = await this.#store.getFlow(flowId);
      if (flow) {
        flow.currentStepId = nextStep.id;
        flow.updatedAt = this.#now().toISOString();
        await this.#store.updateFlow(flow);
      }
      return { ok: true, flow: (await this.#store.getFlow(flowId))!, nextStep: (await this.#store.getStep(nextStep.id))! };
    }

    // No more pending steps — check if flow should complete
    const allTerminal = steps.every((s) => isStepStateTerminal(s.status));
    if (allTerminal) {
      const flow = await this.#store.getFlow(flowId);
      if (flow && !isFlowStateTerminal(flow.status)) {
        await this.#transitionFlow(flowId, "completed", { from: flow.status as FlowState });
        await this.#lockService.release(flowId, this.#ownerId);
      }
    }

    return { ok: true, flow: (await this.#store.getFlow(flowId))! };
  }

  async failStep(stepId: StepId, error?: string): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    const flowId = step.flowId;

    await this.#store.atomicTransition(flowId, async (tx) => {
      await this.#transitionStepInTx(tx, stepId, "failed", { from: step.status, reason: error });

      // Apply failure policy
      const updatedStep = await tx.getStep(stepId);
      if (updatedStep) {
        if (updatedStep.failurePolicy.defaultAction === "stop") {
          const flow = await tx.getFlow(flowId);
          if (flow && !isFlowStateTerminal(flow.status)) {
            await this.#transitionFlowInTx(tx, flowId, "failed", { from: flow.status as FlowState, reason: `Step ${updatedStep.name} failed: ${error ?? "unknown error"}` });
          }
        }
      }
    });

    const updated = await this.#store.getStep(stepId);
    return updated!;
  }

  async skipStep(stepId: StepId, reason?: string, operator?: string): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    if (!step.failurePolicy.allowSkipIfSkippable) {
      throw new Error("Step is not skippable");
    }

    const flowId = step.flowId;

    await this.#store.atomicTransition(flowId, async (tx) => {
      await this.#transitionStepInTx(tx, stepId, "skipped", { from: step.status, reason });
      if (operator) {
        await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, stepId, "operator-skipped", operator, "/skip", "Step skipped", step.status, "skipped", { reason }));
      }
    });

    // Advance flow after skip
    const steps = await this.#store.listSteps(flowId);
    const currentIndex = steps.findIndex((s) => s.id === stepId);
    const nextStep = steps[currentIndex + 1];

    if (nextStep && nextStep.status === "pending") {
      await this.#transitionStep(nextStep.id, "running", { from: "pending" });
      const flow = await this.#store.getFlow(flowId);
      if (flow) {
        flow.currentStepId = nextStep.id;
        flow.updatedAt = this.#now().toISOString();
        await this.#store.updateFlow(flow);
      }
    } else {
      const allTerminal = steps.every((s) => isStepStateTerminal(s.status));
      if (allTerminal) {
        const flow = await this.#store.getFlow(flowId);
        if (flow && !isFlowStateTerminal(flow.status)) {
          await this.#transitionFlow(flowId, "completed", { from: flow.status as FlowState });
          await this.#lockService.release(flowId, this.#ownerId);
        }
      }
    }

    return (await this.#store.getStep(stepId))!;
  }

  // ─── Pause / resume ───

  async requestPause(flowId: FlowId, reason?: string, operator?: string): Promise<Flow> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    if (flow.status !== "running") {
      throw new Error(`Cannot pause flow in state ${flow.status}`);
    }

    await this.#store.atomicTransition(flowId, async (tx) => {
      const f = await tx.getFlow(flowId);
      if (!f) return;
      f.pauseRequestedAt = this.#now().toISOString();
      f.pauseReason = reason;
      f.updatedAt = this.#now().toISOString();
      await tx.updateFlow(f);

      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "pause-requested", { reason }));
      if (operator) {
        await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, undefined, "operator-pause-requested", operator, "/pause", "Pause requested", flow.status, flow.status, { reason }));
      }
    });

    return (await this.#store.getFlow(flowId))!;
  }

  async applyPauseAtBoundary(flowId: FlowId): Promise<Flow> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    await this.#transitionFlow(flowId, "paused", { from: "running", reason: flow.pauseReason ?? "Paused at safe boundary" });

    // Pause current step too
    const steps = await this.#store.listSteps(flowId);
    for (const step of steps) {
      if (step.status === "running") {
        await this.#transitionStep(step.id, "paused", { from: "running" });
      }
    }

    return (await this.#store.getFlow(flowId))!;
  }

  async resumeFlow(flowId: FlowId, operator?: string): Promise<Flow> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    if (flow.status !== "paused" && flow.status !== "interrupted" && flow.status !== "waiting") {
      throw new Error(`Cannot resume flow in state ${flow.status}`);
    }

    await this.#store.atomicTransition(flowId, async (tx) => {
      await this.#transitionFlowInTx(tx, flowId, "running", { from: flow.status as FlowState });

      // Resume current step if paused
      const steps = await tx.listSteps(flowId);
      for (const step of steps) {
        if (step.status === "paused") {
          step.status = "running";
          step.resumedAt = this.#now().toISOString();
          step.updatedAt = this.#now().toISOString();
          await tx.updateStep(step);
          await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "step-started", { stepId: step.id, resumed: true }));
        }
      }

      if (operator) {
        await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, undefined, "operator-resumed", operator, "/resume", "Flow resumed", flow.status, "running"));
      }
    });

    return (await this.#store.getFlow(flowId))!;
  }

  // ─── Interrupt ───

  async interruptFlow(flowId: FlowId, reason?: string, operator?: string): Promise<Flow> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    if (flow.status !== "running" && flow.status !== "paused" && flow.status !== "waiting") {
      throw new Error(`Cannot interrupt flow in state ${flow.status}`);
    }

    await this.#store.atomicTransition(flowId, async (tx) => {
      // Interrupt active steps
      const steps = await tx.listSteps(flowId);
      for (const step of steps) {
        if (step.status === "running" || step.status === "paused" || step.status === "waiting_for_approval" || step.status === "waiting_for_input") {
          await this.#transitionStepInTx(tx, step.id, "interrupted", { from: step.status, reason });
        }
      }

      await this.#transitionFlowInTx(tx, flowId, "interrupted", { from: flow.status as FlowState, reason });

      if (operator) {
        await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, undefined, "operator-interrupted", operator, "/interrupt", "Flow interrupted", flow.status, "interrupted", { reason }));
      }
    });

    return (await this.#store.getFlow(flowId))!;
  }

  // ─── Wait ───

  async waitForApproval(stepId: StepId, gate: Omit<ApprovalGate, "id" | "stepId" | "flowId" | "requestedAt" | "status">): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    const flowId = step.flowId;
    const now = this.#now().toISOString();

    const fullGate: ApprovalGate = {
      id: this.#id(),
      stepId,
      flowId,
      status: "pending",
      requestedAt: now,
      ...gate
    };

    await this.#store.atomicTransition(flowId, async (tx) => {
      await tx.createApprovalGate(fullGate);
      await this.#transitionStepInTx(tx, stepId, "waiting_for_approval", { from: step.status });
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "approval-requested", { stepId, gateId: fullGate.id }));
    });

    return (await this.#store.getStep(stepId))!;
  }

  async waitForInput(stepId: StepId, waitReason: WaitReason): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    const flowId = step.flowId;

    await this.#store.atomicTransition(flowId, async (tx) => {
      const s = await tx.getStep(stepId);
      if (!s) return;
      s.status = "waiting_for_input";
      s.waitReason = waitReason;
      s.waitStartedAt = this.#now().toISOString();
      s.updatedAt = this.#now().toISOString();
      await tx.updateStep(s);
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "wait-started", { stepId, kind: waitReason.kind, description: waitReason.description }));
    });

    // Transition flow to waiting
    const flow = await this.#store.getFlow(flowId);
    if (flow && flow.status === "running") {
      await this.#transitionFlow(flowId, "waiting", { from: "running" });
    }

    return (await this.#store.getStep(stepId))!;
  }

  async resolveWait(stepId: StepId): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    if (step.status !== "waiting_for_input" && step.status !== "waiting_for_approval") {
      throw new Error(`Step is not waiting (status: ${step.status})`);
    }

    const flowId = step.flowId;

    await this.#store.atomicTransition(flowId, async (tx) => {
      const s = await tx.getStep(stepId);
      if (!s) return;
      const fromStatus = s.status;
      s.status = "running";
      s.waitReason = undefined;
      s.waitEndedAt = this.#now().toISOString();
      s.updatedAt = this.#now().toISOString();
      await tx.updateStep(s);
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "wait-ended", { stepId, previousStatus: fromStatus }));

      // If flow was waiting, resume it
      const flow = await tx.getFlow(flowId);
      if (flow && flow.status === "waiting") {
        await this.#transitionFlowInTx(tx, flowId, "running", { from: "waiting" });
      }
    });

    return (await this.#store.getStep(stepId))!;
  }

  async approveStep(stepId: StepId, operator: string, grantId?: string): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    const flowId = step.flowId;
    const gates = await this.#store.listApprovalGates(flowId, { stepId, status: "pending" });
    if (gates.length === 0) throw new Error("No pending approval gate found for step");

    const gate = gates[0];
    const now = this.#now().toISOString();

    await this.#store.atomicTransition(flowId, async (tx) => {
      gate.status = "approved";
      gate.resolvedAt = now;
      gate.resolvedBy = operator;
      gate.controllerGrantId = grantId;
      await tx.updateApprovalGate(gate);
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "approval-granted", { stepId, gateId: gate.id, operator }));
      await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, stepId, "operator-approved", operator, "/approve", "Approval granted", "waiting_for_approval", "running", { gateId: gate.id }));
      await this.#resolveWaitInTx(tx, stepId);
    });

    return (await this.#store.getStep(stepId))!;
  }

  async rejectStep(stepId: StepId, operator: string, rejectionReason?: string): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    const flowId = step.flowId;
    const gates = await this.#store.listApprovalGates(flowId, { stepId, status: "pending" });
    if (gates.length === 0) throw new Error("No pending approval gate found for step");

    const gate = gates[0];
    const now = this.#now().toISOString();

    await this.#store.atomicTransition(flowId, async (tx) => {
      gate.status = "rejected";
      gate.resolvedAt = now;
      gate.resolvedBy = operator;
      await tx.updateApprovalGate(gate);
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "approval-denied", { stepId, gateId: gate.id, operator, reason: rejectionReason }));
      await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, stepId, "operator-rejected", operator, "/reject", "Approval denied", "waiting_for_approval", "failed", { gateId: gate.id, reason: rejectionReason }));

      // Apply failure policy
      const updatedStep = await tx.getStep(stepId);
      if (updatedStep) {
        updatedStep.status = "failed";
        updatedStep.failedAt = now;
        updatedStep.updatedAt = now;
        await tx.updateStep(updatedStep);
        await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "step-failed", { stepId, reason: rejectionReason ?? "Approval denied by operator" }));

        if (updatedStep.failurePolicy.defaultAction === "stop") {
          const flow = await tx.getFlow(flowId);
          if (flow && !isFlowStateTerminal(flow.status)) {
            await this.#transitionFlowInTx(tx, flowId, "failed", { from: flow.status as FlowState, reason: `Step ${updatedStep.name} rejected` });
          }
        }
      }
    });

    return (await this.#store.getStep(stepId))!;
  }

  // ─── Retry ───

  async retryStep(stepId: StepId, operator?: string): Promise<FlowStep> {
    const step = await this.#store.getStep(stepId);
    if (!step) throw new Error("Step not found");

    if (!isRetryAllowed(step)) {
      throw new Error("Retry not allowed for this step (not idempotent or safeToRetry)");
    }

    if (step.retryCount >= step.maxRetries) {
      throw new Error(`Max retries (${step.maxRetries}) exceeded`);
    }

    const flowId = step.flowId;
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    const now = this.#now().toISOString();
    const retryStep: FlowStep = {
      id: this.#id(),
      flowId,
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

    await this.#store.atomicTransition(flowId, async (tx) => {
      await tx.createStep(retryStep);
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "step-retried", { originalStepId: stepId, retryStepId: retryStep.id, attempt: retryStep.attemptNumber }));
      if (operator) {
        await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, stepId, "operator-retried", operator, "/retry", "Step retried", "failed", "pending", { retryStepId: retryStep.id }));
      }

      // Update flow retry count
      const f = await tx.getFlow(flowId);
      if (f) {
        f.retryCount = (f.retryCount ?? 0) + 1;
        f.updatedAt = now;
        await tx.updateFlow(f);
      }
    });

    // Start the retry step immediately
    await this.#transitionStep(retryStep.id, "running", { from: "pending" });

    // Update flow current step
    const updatedFlow = await this.#store.getFlow(flowId);
    if (updatedFlow) {
      updatedFlow.currentStepId = retryStep.id;
      updatedFlow.updatedAt = now;
      await this.#store.updateFlow(updatedFlow);
    }

    return (await this.#store.getStep(retryStep.id))!;
  }

  // ─── Checkpoint ───

  async createCheckpoint(flowId: FlowId, name: string, description?: string, operator?: string): Promise<Checkpoint> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    const steps = await this.#store.listSteps(flowId);
    const stepStates: Record<StepId, StepState> = {};
    const waitReasons: Record<StepId, WaitReason> = {};
    const retryCounts: Record<StepId, number> = {};
    const pendingApprovals: string[] = [];

    for (const step of steps) {
      stepStates[step.id] = step.status;
      if (step.waitReason) waitReasons[step.id] = step.waitReason;
      retryCounts[step.id] = step.retryCount;
    }

    const gates = await this.#store.listApprovalGates(flowId, { status: "pending" });
    for (const gate of gates) {
      pendingApprovals.push(gate.id);
    }

    const snapshot: CheckpointSnapshot = {
      flowState: flow.status,
      currentStepId: flow.currentStepId,
      stepStates,
      pendingApprovals,
      waitReasons,
      operatorEvents: [],
      retryCounts
    };

    const checkpoint: Checkpoint = {
      id: this.#id(),
      flowId,
      stepId: flow.currentStepId,
      name,
      description,
      snapshot,
      createdAt: this.#now().toISOString(),
      createdBy: operator ?? "system"
    };

    await this.#store.atomicTransition(flowId, async (tx) => {
      await tx.createCheckpoint(checkpoint);
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "checkpoint-created", { checkpointId: checkpoint.id, name }));
      if (operator) {
        await tx.appendOperatorEvent(this.#makeOperatorEvent(flowId, undefined, "operator-checkpointed", operator, "/checkpoint", "Checkpoint created", flow.status, flow.status, { checkpointId: checkpoint.id, name }));
      }

      const f = await tx.getFlow(flowId);
      if (f) {
        f.checkpointCount = (f.checkpointCount ?? 0) + 1;
        f.updatedAt = this.#now().toISOString();
        await tx.updateFlow(f);
      }
    });

    return checkpoint;
  }

  // ─── Process registry helpers ───

  async registerProcess(flowId: FlowId, stepId: StepId, process: Omit<FlowProcess, "id" | "flowId" | "stepId" | "startedAt">): Promise<FlowProcess> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    const fullProcess: FlowProcess = {
      id: this.#id(),
      flowId,
      stepId,
      ...process,
      startedAt: this.#now().toISOString()
    };

    await this.#store.atomicTransition(flowId, async (tx) => {
      await tx.registerProcess(fullProcess);
      await tx.appendFlowEvent(this.#makeFlowEvent(flowId, "process-registered", { stepId, processId: fullProcess.id, processType: process.processType }));
    });

    return fullProcess;
  }

  async updateProcess(process: FlowProcess): Promise<void> {
    await this.#store.updateProcess(process);
  }

  // ─── Internal helpers ───

  async #createStepFromPlan(flowId: FlowId, planStep: FlowPlanStep, index: number): Promise<FlowStep> {
    return this.createStep(flowId, planStep.name, planStep.description, {
      requiresApproval: planStep.requiresApproval,
      skippable: planStep.skippable,
      maxRetries: planStep.maxRetries,
      idempotent: planStep.idempotent,
      onFailure: planStep.onFailure
    });
  }

  async #transitionFlow(flowId: FlowId, to: FlowState, options: { from: FlowState; reason?: string }): Promise<void> {
    await this.#store.atomicTransition(flowId, async (tx) => {
      await this.#transitionFlowInTx(tx, flowId, to, options);
    });
  }

  async #transitionFlowInTx(tx: TaskFlowStore, flowId: FlowId, to: FlowState, options: { from: FlowState; reason?: string }): Promise<void> {
    validateFlowTransition(options.from, to);
    const flow = await tx.getFlow(flowId);
    if (!flow) throw new Error("Flow not found");

    // Double-check current state hasn't changed
    if (flow.status !== options.from) {
      throw new IllegalTransitionError("flow", flow.status, to);
    }

    const now = this.#now().toISOString();
    flow.status = to;
    flow.updatedAt = now;

    if (to === "completed") flow.completedAt = now;
    if (to === "cancelled") flow.cancelledAt = now;
    if (to === "failed") flow.failedAt = now;
    if (to === "interrupted") flow.interruptReason = options.reason;
    if (to === "cancelled") flow.cancelReason = options.reason;
    if (to === "failed") {
      flow.failedAt = now;
      flow.operatorSummary = options.reason;
    }

    await tx.updateFlow(flow);

    const eventKind = to === "completed" ? "flow-completed"
      : to === "cancelled" ? "flow-cancelled"
      : to === "failed" ? "flow-failed"
      : "flow-state-changed";
    await tx.appendFlowEvent(this.#makeFlowEvent(flowId, eventKind, { from: options.from, to, reason: options.reason }));
  }

  async #transitionStep(stepId: StepId, to: StepState, options: { from: StepState; reason?: string }): Promise<void> {
    await this.#store.atomicTransition((await this.#store.getStep(stepId))!.flowId, async (tx) => {
      await this.#transitionStepInTx(tx, stepId, to, options);
    });
  }

  async #transitionStepInTx(tx: TaskFlowStore, stepId: StepId, to: StepState, options: { from: StepState; reason?: string }): Promise<void> {
    validateStepTransition(options.from, to);
    const step = await tx.getStep(stepId);
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

    await tx.updateStep(step);

    const eventKind = to === "completed" ? "step-completed"
      : to === "failed" ? "step-failed"
      : to === "cancelled" ? "step-cancelled"
      : to === "interrupted" ? "step-interrupted"
      : to === "skipped" ? "step-skipped"
      : "step-started";
    await tx.appendFlowEvent(this.#makeFlowEvent(step.flowId, eventKind, { stepId, from: options.from, to, reason: options.reason }));
  }

  async #cancelStepInTx(tx: TaskFlowStore, stepId: StepId, reason?: string): Promise<void> {
    const step = await tx.getStep(stepId);
    if (!step) return;
    if (isStepStateTerminal(step.status)) return;
    await this.#transitionStepInTx(tx, stepId, "cancelled", { from: step.status, reason });
  }

  async #resolveWaitInTx(tx: TaskFlowStore, stepId: StepId): Promise<void> {
    const step = await tx.getStep(stepId);
    if (!step) return;
    const fromStatus = step.status;
    step.status = "running";
    step.waitReason = undefined;
    step.waitEndedAt = this.#now().toISOString();
    step.updatedAt = this.#now().toISOString();
    await tx.updateStep(step);
    await tx.appendFlowEvent(this.#makeFlowEvent(step.flowId, "wait-ended", { stepId, previousStatus: fromStatus }));

    const flow = await tx.getFlow(step.flowId);
    if (flow && flow.status === "waiting") {
      await this.#transitionFlowInTx(tx, flow.id, "running", { from: "waiting" });
    }
  }

  #makeFlowEvent(flowId: FlowId, kind: FlowEvent["kind"], data?: Record<string, unknown>): FlowEvent {
    return {
      id: this.#id(),
      flowId,
      kind,
      data: data ?? {},
      timestamp: this.#now().toISOString()
    };
  }

  #makeOperatorEvent(
    flowId: FlowId,
    stepId: StepId | undefined,
    kind: OperatorEvent["kind"],
    operator: string,
    command: string,
    effect: string,
    previousState: FlowState | StepState,
    newState: FlowState | StepState,
    metadata?: Record<string, unknown>
  ): OperatorEvent {
    return {
      id: this.#id(),
      flowId,
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
