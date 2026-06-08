// WorkflowStore interface — persistence contract for flow orchestration

import type {
  WorkflowRun,
  WorkflowRunId,
  WorkflowStep,
  WorkflowStepId,
  WorkflowEvent,
  WorkflowOperatorEvent,
  WorkflowCheckpoint,
  WorkflowCheckpointId,
  WorkflowApprovalGate,
  WorkflowArtifactLink,
  WorkflowAgentRunLink,
  WorkflowProcess,
  WorkflowLock,
  WorkflowEventSummary,
  RunId,
  EventId
} from "./types.js";

export type AtomicTransitionResult = {
  ok: true;
} | {
  ok: false;
  error: string;
};

export interface WorkflowStore {
  // ─── WorkflowRun state ───
  createWorkflowRun(flow: WorkflowRun): Promise<void>;
  updateWorkflowRun(flow: WorkflowRun): Promise<void>;
  getWorkflowRun(id: WorkflowRunId): Promise<WorkflowRun | null>;
  listWorkflowRuns(sessionId?: string): Promise<WorkflowRun[]>;
  listActiveWorkflowRuns(): Promise<WorkflowRun[]>;

  // ─── Step state ───
  createWorkflowStep(step: WorkflowStep): Promise<void>;
  updateWorkflowStep(step: WorkflowStep): Promise<void>;
  getWorkflowStep(id: WorkflowStepId): Promise<WorkflowStep | null>;
  listWorkflowSteps(flowId: WorkflowRunId): Promise<WorkflowStep[]>;

  // ─── Events ───
  appendWorkflowEvent(event: WorkflowEvent): Promise<void>;
  appendWorkflowOperatorEvent(event: WorkflowOperatorEvent): Promise<void>;
  listWorkflowEvents(flowId: WorkflowRunId, options?: { stepId?: WorkflowStepId; kind?: string; limit?: number }): Promise<WorkflowEvent[]>;
  listWorkflowOperatorEvents(flowId: WorkflowRunId, options?: { stepId?: WorkflowStepId; kind?: string; limit?: number }): Promise<WorkflowOperatorEvent[]>;

  // ─── Linkage ───
  linkWorkflowArtifact(link: WorkflowArtifactLink): Promise<void>;
  listWorkflowArtifactLinks(flowId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowArtifactLink[]>;
  linkWorkflowAgentRun(link: WorkflowAgentRunLink): Promise<void>;
  listWorkflowAgentRunLinks(flowId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowAgentRunLink[]>;

  // ─── Checkpoints ───
  createWorkflowCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void>;
  getWorkflowCheckpoint(id: WorkflowCheckpointId): Promise<WorkflowCheckpoint | null>;
  listWorkflowCheckpoints(flowId: WorkflowRunId): Promise<WorkflowCheckpoint[]>;

  // ─── Approval gates ───
  createWorkflowApprovalGate(gate: WorkflowApprovalGate): Promise<void>;
  updateWorkflowApprovalGate(gate: WorkflowApprovalGate): Promise<void>;
  getWorkflowApprovalGate(id: string): Promise<WorkflowApprovalGate | null>;
  listWorkflowApprovalGates(flowId: WorkflowRunId, options?: { stepId?: WorkflowStepId; status?: string }): Promise<WorkflowApprovalGate[]>;

  // ─── Locks ───
  acquireLock(flowId: WorkflowRunId, ownerId: string, leaseMs: number): Promise<boolean>;
  releaseLock(flowId: WorkflowRunId, ownerId: string): Promise<void>;
  heartbeatLock(flowId: WorkflowRunId, ownerId: string, leaseMs: number): Promise<void>;
  getLock(flowId: WorkflowRunId): Promise<WorkflowLock | null>;
  recoverStaleLocks(before: string): Promise<number>;

  // ─── Process registry ───
  registerWorkflowProcess(process: WorkflowProcess): Promise<void>;
  updateWorkflowProcess(process: WorkflowProcess): Promise<void>;
  getWorkflowProcess(id: string): Promise<WorkflowProcess | null>;
  listWorkflowProcesses(flowId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowProcess[]>;

  // ─── Compact summaries ───
  saveWorkflowEventSummary(summary: WorkflowEventSummary): Promise<void>;
  listWorkflowEventSummaries(flowId: WorkflowRunId): Promise<WorkflowEventSummary[]>;

  // ─── Steer consumption ───
  listUnconsumedSteerEvents(flowId: WorkflowRunId): Promise<WorkflowOperatorEvent[]>;
  markSteerConsumed(
    eventId: EventId,
    consumption: {
      consumedByStepId?: WorkflowStepId;
      consumedByRunId?: RunId;
      consumedByFlowEventId?: EventId;
    }
  ): Promise<void>;

  // ─── Atomic transition ───
  atomicTransition<T>(
    flowId: WorkflowRunId,
    work: (tx: WorkflowStore) => Promise<T>
  ): Promise<T>;
}
