// WorkflowStore interface — persistence contract for flow orchestration

import type {
  Flow,
  FlowId,
  FlowStep,
  StepId,
  FlowEvent,
  OperatorEvent,
  Checkpoint,
  CheckpointId,
  ApprovalGate,
  ArtifactLink,
  RunLink,
  FlowProcess,
  FlowLock,
  CompactSummary,
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
  // ─── Flow state ───
  createFlow(flow: Flow): Promise<void>;
  updateFlow(flow: Flow): Promise<void>;
  getFlow(id: FlowId): Promise<Flow | null>;
  listFlows(sessionId?: string): Promise<Flow[]>;
  listActiveFlows(): Promise<Flow[]>;

  // ─── Step state ───
  createStep(step: FlowStep): Promise<void>;
  updateStep(step: FlowStep): Promise<void>;
  getStep(id: StepId): Promise<FlowStep | null>;
  listSteps(flowId: FlowId): Promise<FlowStep[]>;

  // ─── Events ───
  appendFlowEvent(event: FlowEvent): Promise<void>;
  appendOperatorEvent(event: OperatorEvent): Promise<void>;
  listFlowEvents(flowId: FlowId, options?: { stepId?: StepId; kind?: string; limit?: number }): Promise<FlowEvent[]>;
  listOperatorEvents(flowId: FlowId, options?: { stepId?: StepId; kind?: string; limit?: number }): Promise<OperatorEvent[]>;

  // ─── Linkage ───
  linkArtifact(link: ArtifactLink): Promise<void>;
  listArtifacts(flowId: FlowId, stepId?: StepId): Promise<ArtifactLink[]>;
  linkRun(link: RunLink): Promise<void>;
  listRunLinks(flowId: FlowId, stepId?: StepId): Promise<RunLink[]>;

  // ─── Checkpoints ───
  createCheckpoint(checkpoint: Checkpoint): Promise<void>;
  getCheckpoint(id: CheckpointId): Promise<Checkpoint | null>;
  listCheckpoints(flowId: FlowId): Promise<Checkpoint[]>;

  // ─── Approval gates ───
  createApprovalGate(gate: ApprovalGate): Promise<void>;
  updateApprovalGate(gate: ApprovalGate): Promise<void>;
  getApprovalGate(id: string): Promise<ApprovalGate | null>;
  listApprovalGates(flowId: FlowId, options?: { stepId?: StepId; status?: string }): Promise<ApprovalGate[]>;

  // ─── Locks ───
  acquireLock(flowId: FlowId, ownerId: string, leaseMs: number): Promise<boolean>;
  releaseLock(flowId: FlowId, ownerId: string): Promise<void>;
  heartbeatLock(flowId: FlowId, ownerId: string, leaseMs: number): Promise<void>;
  getLock(flowId: FlowId): Promise<FlowLock | null>;
  recoverStaleLocks(before: string): Promise<number>;

  // ─── Process registry ───
  registerProcess(process: FlowProcess): Promise<void>;
  updateProcess(process: FlowProcess): Promise<void>;
  getProcess(id: string): Promise<FlowProcess | null>;
  listProcesses(flowId: FlowId, stepId?: StepId): Promise<FlowProcess[]>;

  // ─── Compact summaries ───
  saveCompactSummary(summary: CompactSummary): Promise<void>;
  listCompactSummaries(flowId: FlowId): Promise<CompactSummary[]>;

  // ─── Steer consumption ───
  listUnconsumedSteerEvents(flowId: FlowId): Promise<OperatorEvent[]>;
  markSteerConsumed(
    eventId: EventId,
    consumption: {
      consumedByStepId?: StepId;
      consumedByRunId?: RunId;
      consumedByFlowEventId?: EventId;
    }
  ): Promise<void>;

  // ─── Atomic transition ───
  atomicTransition<T>(
    flowId: FlowId,
    work: (tx: WorkflowStore) => Promise<T>
  ): Promise<T>;
}
