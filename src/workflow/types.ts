// Workflow module domain types for v0.8 durable flow execution + operator control plane

import type { IntentRoute } from "../contracts/intent.js";
import type { ToolCallPlan } from "../contracts/tool-plan.js";
import type { ToolRiskClass } from "../contracts/tool.js";

// ─── Identity ───

export type WorkflowRunId = string;
export type WorkflowStepId = string;
export type RunId = string;
export type EventId = string;
export type WorkflowCheckpointId = string;

// ─── WorkflowRun ───

export type WorkflowRunState =
  | "pending"
  | "running"
  | "paused"
  | "waiting"
  | "interrupted"
  | "completed"
  | "cancelled"
  | "failed";

export type WorkflowRun = {
  id: WorkflowRunId;
  sessionId: string;
  status: WorkflowRunState;
  intent: IntentRoute;
  selectedSkill?: string;
  currentStepId?: WorkflowStepId;
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

// ─── WorkflowPlan (ad-hoc, no template in v0.8) ───

export type WorkflowPlan = {
  name: string;
  description: string;
  steps: WorkflowPlanStep[];
};

export type WorkflowPlanStep = {
  name: string;
  description: string;
  toolset?: string;
  requiresApproval?: boolean;
  skippable?: boolean;
  maxRetries?: number;
  idempotent?: boolean;
  onFailure?: "stop" | "retry" | "skip" | "escalate";
};

// ─── WorkflowStep ───

export type WorkflowStepState =
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

export type WorkflowStep = {
  id: WorkflowStepId;
  flowId: WorkflowRunId;
  index: number;
  status: WorkflowStepState;
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
  retryOfStepId?: WorkflowStepId;
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

// ─── WorkflowEvent ───

export type WorkflowEventKind =
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

export type WorkflowEvent = {
  id: EventId;
  flowId: WorkflowRunId;
  stepId?: WorkflowStepId;
  kind: WorkflowEventKind;
  data: Record<string, unknown>;
  timestamp: string;
};

// ─── WorkflowOperatorEvent ───

export type WorkflowOperatorEventKind =
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

export type WorkflowOperatorEvent = {
  id: EventId;
  flowId: WorkflowRunId;
  stepId?: WorkflowStepId;
  kind: WorkflowOperatorEventKind;
  operator: string;
  command: string;
  effect: string;
  previousState: WorkflowRunState | WorkflowStepState;
  newState: WorkflowRunState | WorkflowStepState;
  metadata?: Record<string, unknown>;
  timestamp: string;
  // Steer consumption tracking (Track 5)
  consumedAt?: string;
  consumedByStepId?: WorkflowStepId;
  consumedByRunId?: RunId;
  consumedByFlowEventId?: EventId;
};

// ─── WorkflowApprovalGate ───

export type WorkflowApprovalGateStatus = "pending" | "approved" | "rejected";

export type WorkflowApprovalGate = {
  id: string;
  stepId: WorkflowStepId;
  flowId: WorkflowRunId;
  status: WorkflowApprovalGateStatus;
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

// ─── WorkflowCheckpoint ───

export type WorkflowCheckpoint = {
  id: WorkflowCheckpointId;
  flowId: WorkflowRunId;
  stepId?: WorkflowStepId;
  name: string;
  description?: string;
  snapshot: WorkflowCheckpointSnapshot;
  createdAt: string;
  createdBy: string;
};

export type WorkflowCheckpointSnapshot = {
  flowState: WorkflowRunState;
  currentStepId?: WorkflowStepId;
  stepStates: Record<WorkflowStepId, WorkflowStepState>;
  pendingApprovals: string[];
  waitReasons: Record<WorkflowStepId, WaitReason>;
  operatorEvents: WorkflowOperatorEvent[];
  retryCounts: Record<WorkflowStepId, number>;
};

// ─── WorkflowArtifactLink / WorkflowAgentRunLink ───

export type WorkflowArtifactLink = {
  artifactId: string;
  stepId: WorkflowStepId;
  flowId: WorkflowRunId;
  kind: "created" | "modified" | "referenced";
  linkedAt: string;
};

export type WorkflowAgentRunLink = {
  runId: RunId;
  stepId: WorkflowStepId;
  flowId: WorkflowRunId;
  turnIndex: number;
  linkedAt: string;
};

// ─── WorkflowProcess ───

export type WorkflowProcess = {
  id: string;
  flowId: WorkflowRunId;
  stepId: WorkflowStepId;
  processManagerId: string;
  processType: "terminal" | "process" | "browser";
  commandSummary?: string;
  startedAt: string;
  expectedExitAt?: string;
  status: "running" | "exited" | "orphaned" | "unknown";
};

// ─── WorkflowLock ───

export type WorkflowLock = {
  flowId: WorkflowRunId;
  ownerId: string;
  lockedAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

// ─── WorkflowEventSummary ───

export type WorkflowEventSummary = {
  id: string;
  flowId: WorkflowRunId;
  compactedRange: { fromEventId: string; toEventId: string };
  turnSummaries: string[];
  toolOutcomeSummaries: string[];
  operatorActionSummaries: string[];
  createdAt: string;
};

// ─── Transition validation ───

const LEGAL_FLOW_TRANSITIONS: Record<WorkflowRunState, WorkflowRunState[]> = {
  pending: ["running", "cancelled", "failed"],
  running: ["paused", "interrupted", "cancelled", "waiting", "completed", "failed"],
  paused: ["running", "interrupted", "cancelled"],
  waiting: ["running", "interrupted", "cancelled"],
  interrupted: ["running", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: []
};

const LEGAL_STEP_TRANSITIONS: Record<WorkflowStepState, WorkflowStepState[]> = {
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

export function validateWorkflowRunTransition(from: WorkflowRunState, to: WorkflowRunState): void {
  if (!LEGAL_FLOW_TRANSITIONS[from].includes(to)) {
    throw new IllegalTransitionError("flow", from, to);
  }
}

export function validateWorkflowStepTransition(from: WorkflowStepState, to: WorkflowStepState): void {
  if (!LEGAL_STEP_TRANSITIONS[from].includes(to)) {
    throw new IllegalTransitionError("step", from, to);
  }
}

export function isWorkflowRunStateTerminal(status: WorkflowRunState): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

export function isWorkflowStepStateTerminal(status: WorkflowStepState): boolean {
  return status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";
}

// ─── Retry eligibility ───

export function isRetryAllowed(step: Pick<WorkflowStep, "idempotent" | "safeToRetry">): boolean {
  // Conservative v0.8 rule:
  // Allowed only if idempotent=true OR safeToRetry=true
  // Rejected if either is false/unknown and the other is not explicitly true
  if (step.idempotent === true) return true;
  if (step.safeToRetry === true) return true;
  return false;
}
