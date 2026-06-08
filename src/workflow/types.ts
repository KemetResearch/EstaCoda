// Workflow module domain types for v0.8 durable flow execution + operator control plane

import type { IntentRoute } from "../contracts/intent.js";
import type { ToolCallPlan } from "../contracts/tool-plan.js";
import type { ToolRiskClass } from "../contracts/tool.js";

// ─── Identity ───

export type FlowId = string;
export type StepId = string;
export type RunId = string;
export type EventId = string;
export type CheckpointId = string;

// ─── Flow ───

export type FlowState =
  | "pending"
  | "running"
  | "paused"
  | "waiting"
  | "interrupted"
  | "completed"
  | "cancelled"
  | "failed";

export type Flow = {
  id: FlowId;
  sessionId: string;
  status: FlowState;
  intent: IntentRoute;
  selectedSkill?: string;
  currentStepId?: StepId;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  failedAt?: string;
  pauseRequestedAt?: string;
  pauseReason?: string;
  interruptReason?: string;
  cancelReason?: string;
  waitReason?: WaitReason;
  operatorSummary?: string;
  compactedAt?: string;
  checkpointCount: number;
  stepCount: number;
  retryCount: number;
  metadata: Record<string, unknown>;
};

// ─── FlowPlan (ad-hoc, no template in v0.8) ───

export type FlowPlan = {
  name: string;
  description: string;
  steps: FlowPlanStep[];
};

export type FlowPlanStep = {
  name: string;
  description: string;
  toolset?: string;
  requiresApproval?: boolean;
  skippable?: boolean;
  maxRetries?: number;
  idempotent?: boolean;
  onFailure?: "stop" | "retry" | "skip" | "escalate";
};

// ─── FlowStep ───

export type StepState =
  | "pending"
  | "running"
  | "paused"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "interrupted";

export type FlowStep = {
  id: StepId;
  flowId: FlowId;
  index: number;
  status: StepState;
  name: string;
  description: string;
  toolPlans: ToolCallPlan[];
  executions: ToolCallPlan[];
  retryPolicy: RetryPolicy;
  retryCount: number;
  maxRetries: number;
  idempotent: boolean;
  safeToRetry: boolean;
  failurePolicy: FailurePolicy;
  waitReason?: WaitReason;
  pauseReason?: string;
  interruptReason?: string;
  skipReason?: string;
  retryOfStepId?: StepId;
  attemptNumber: number;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  waitStartedAt?: string;
  waitEndedAt?: string;
  createdAt: string;
  updatedAt: string;
};

// ─── RetryPolicy ───

export type RetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableFailureClasses: string[];
  nonRetryableFailureClasses: string[];
  requireIdempotent: boolean;
};

export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: 1,
    backoffMs: 0,
    backoffMultiplier: 1,
    retryableFailureClasses: [],
    nonRetryableFailureClasses: ["security-deny", "validation-error"],
    requireIdempotent: true
  };
}

// ─── FailurePolicy ───

export type FailurePolicy = {
  defaultAction: "stop" | "retry" | "skip" | "escalate";
  escalationTarget?: string;
  stopOnNonRetryable: boolean;
  allowSkipIfSkippable: boolean;
};

export function defaultFailurePolicy(): FailurePolicy {
  return {
    defaultAction: "stop",
    stopOnNonRetryable: true,
    allowSkipIfSkippable: false
  };
}

// ─── WaitReason ───

export type WaitReason = {
  kind: "user_input" | "approval" | "external_event" | "time" | "condition";
  description: string;
  deadline?: string;
  condition?: string;
};

// ─── FlowEvent ───

export type FlowEventKind =
  | "flow-created"
  | "flow-started"
  | "flow-state-changed"
  | "flow-completed"
  | "flow-cancelled"
  | "flow-failed"
  | "step-created"
  | "step-started"
  | "step-completed"
  | "step-failed"
  | "step-retried"
  | "step-skipped"
  | "step-cancelled"
  | "step-interrupted"
  | "approval-requested"
  | "approval-granted"
  | "approval-denied"
  | "wait-started"
  | "wait-ended"
  | "checkpoint-created"
  | "compacted"
  | "run-linked"
  | "artifact-linked"
  | "pause-requested"
  | "pause-took-effect"
  | "process-registered"
  | "process-exited"
  | "process-orphaned"
  | "run-link-unavailable";

export type FlowEvent = {
  id: EventId;
  flowId: FlowId;
  stepId?: StepId;
  kind: FlowEventKind;
  data: Record<string, unknown>;
  timestamp: string;
};

// ─── OperatorEvent ───

export type OperatorEventKind =
  | "operator-paused"
  | "operator-pause-requested"
  | "operator-resumed"
  | "operator-interrupted"
  | "operator-cancelled"
  | "operator-steered"
  | "operator-compacted"
  | "operator-approved"
  | "operator-rejected"
  | "operator-retried"
  | "operator-skipped"
  | "operator-checkpointed";

export type OperatorEvent = {
  id: EventId;
  flowId: FlowId;
  stepId?: StepId;
  kind: OperatorEventKind;
  operator: string;
  command: string;
  effect: string;
  previousState: FlowState | StepState;
  newState: FlowState | StepState;
  metadata?: Record<string, unknown>;
  timestamp: string;
  // Steer consumption tracking (Track 5)
  consumedAt?: string;
  consumedByStepId?: StepId;
  consumedByRunId?: RunId;
  consumedByFlowEventId?: EventId;
};

// ─── ApprovalGate ───

export type ApprovalGateStatus = "pending" | "approved" | "rejected";

export type ApprovalGate = {
  id: string;
  stepId: StepId;
  flowId: FlowId;
  status: ApprovalGateStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  reason: string;
  riskClass: ToolRiskClass;
  toolName?: string;
  targetKey?: string;
  targetSummary?: string;
  scope?: string;
  controllerGrantId?: string;
  toolExecutorDecision: "ask" | "deny" | "allow";
  deterministicRule?: string;
};

// ─── Checkpoint ───

export type Checkpoint = {
  id: CheckpointId;
  flowId: FlowId;
  stepId?: StepId;
  name: string;
  description?: string;
  snapshot: CheckpointSnapshot;
  createdAt: string;
  createdBy: string;
};

export type CheckpointSnapshot = {
  flowState: FlowState;
  currentStepId?: StepId;
  stepStates: Record<StepId, StepState>;
  pendingApprovals: string[];
  waitReasons: Record<StepId, WaitReason>;
  operatorEvents: OperatorEvent[];
  retryCounts: Record<StepId, number>;
};

// ─── ArtifactLink / RunLink ───

export type ArtifactLink = {
  artifactId: string;
  stepId: StepId;
  flowId: FlowId;
  kind: "created" | "modified" | "referenced";
  linkedAt: string;
};

export type RunLink = {
  runId: RunId;
  stepId: StepId;
  flowId: FlowId;
  turnIndex: number;
  linkedAt: string;
};

// ─── FlowProcess ───

export type FlowProcess = {
  id: string;
  flowId: FlowId;
  stepId: StepId;
  processManagerId: string;
  processType: "terminal" | "process" | "browser";
  commandSummary?: string;
  startedAt: string;
  expectedExitAt?: string;
  status: "running" | "exited" | "orphaned" | "unknown";
};

// ─── FlowLock ───

export type FlowLock = {
  flowId: FlowId;
  ownerId: string;
  lockedAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

// ─── CompactSummary ───

export type CompactSummary = {
  id: string;
  flowId: FlowId;
  compactedRange: { fromEventId: string; toEventId: string };
  turnSummaries: string[];
  toolOutcomeSummaries: string[];
  operatorActionSummaries: string[];
  createdAt: string;
};

// ─── Transition validation ───

const LEGAL_FLOW_TRANSITIONS: Record<FlowState, FlowState[]> = {
  pending: ["running", "cancelled", "failed"],
  running: ["paused", "interrupted", "cancelled", "waiting", "completed", "failed"],
  paused: ["running", "interrupted", "cancelled"],
  waiting: ["running", "interrupted", "cancelled"],
  interrupted: ["running", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: []
};

const LEGAL_STEP_TRANSITIONS: Record<StepState, StepState[]> = {
  pending: ["running", "cancelled", "skipped", "failed"],
  running: ["paused", "interrupted", "cancelled", "waiting_for_approval", "waiting_for_input", "completed", "failed"],
  paused: ["running", "interrupted", "cancelled"],
  waiting_for_approval: ["running", "interrupted", "cancelled", "failed"],
  waiting_for_input: ["running", "interrupted", "cancelled"],
  interrupted: ["running", "cancelled", "failed"],
  completed: [],
  failed: [],
  skipped: [],
  cancelled: []
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly entity: "flow" | "step",
    public readonly from: string,
    public readonly to: string
  ) {
    super(`Illegal ${entity} transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function validateFlowTransition(from: FlowState, to: FlowState): void {
  if (!LEGAL_FLOW_TRANSITIONS[from].includes(to)) {
    throw new IllegalTransitionError("flow", from, to);
  }
}

export function validateStepTransition(from: StepState, to: StepState): void {
  if (!LEGAL_STEP_TRANSITIONS[from].includes(to)) {
    throw new IllegalTransitionError("step", from, to);
  }
}

export function isFlowStateTerminal(status: FlowState): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

export function isStepStateTerminal(status: StepState): boolean {
  return status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";
}

// ─── Retry eligibility ───

export function isRetryAllowed(step: Pick<FlowStep, "idempotent" | "safeToRetry">): boolean {
  // Conservative v0.8 rule:
  // Allowed only if idempotent=true OR safeToRetry=true
  // Rejected if either is false/unknown and the other is not explicitly true
  if (step.idempotent === true) return true;
  if (step.safeToRetry === true) return true;
  return false;
}
