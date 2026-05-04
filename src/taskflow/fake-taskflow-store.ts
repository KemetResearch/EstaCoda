// FakeTaskFlowStore — deterministic in-memory implementation for tests

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
import type { TaskFlowStore } from "./taskflow-store.js";

export class FakeTaskFlowStore implements TaskFlowStore {
  readonly flows = new Map<FlowId, Flow>();
  readonly steps = new Map<StepId, FlowStep>();
  readonly flowEvents: FlowEvent[] = [];
  readonly operatorEvents: OperatorEvent[] = [];
  readonly artifacts: ArtifactLink[] = [];
  readonly runLinks: RunLink[] = [];
  readonly checkpoints: Checkpoint[] = [];
  readonly approvalGates: ApprovalGate[] = [];
  readonly locks = new Map<FlowId, FlowLock>();
  readonly processes: FlowProcess[] = [];
  readonly compactSummaries: CompactSummary[] = [];
  readonly #now: () => Date;

  constructor(options?: { now?: () => Date }) {
    this.#now = options?.now ?? (() => new Date());
  }

  async createFlow(flow: Flow): Promise<void> {
    this.flows.set(flow.id, structuredClone(flow));
  }

  async updateFlow(flow: Flow): Promise<void> {
    this.flows.set(flow.id, structuredClone(flow));
  }

  async getFlow(id: FlowId): Promise<Flow | null> {
    const f = this.flows.get(id);
    return f ? structuredClone(f) : null;
  }

  async listFlows(sessionId?: string): Promise<Flow[]> {
    const all = Array.from(this.flows.values());
    const filtered = sessionId ? all.filter((f) => f.sessionId === sessionId) : all;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((f) => structuredClone(f));
  }

  async listActiveFlows(): Promise<Flow[]> {
    const activeStatuses = new Set<Flow["status"]>(["pending", "running", "paused", "waiting", "interrupted"]);
    return Array.from(this.flows.values())
      .filter((f) => activeStatuses.has(f.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((f) => structuredClone(f));
  }

  async createStep(step: FlowStep): Promise<void> {
    this.steps.set(step.id, structuredClone(step));
  }

  async updateStep(step: FlowStep): Promise<void> {
    this.steps.set(step.id, structuredClone(step));
  }

  async getStep(id: StepId): Promise<FlowStep | null> {
    const s = this.steps.get(id);
    return s ? structuredClone(s) : null;
  }

  async listSteps(flowId: FlowId): Promise<FlowStep[]> {
    return Array.from(this.steps.values())
      .filter((s) => s.flowId === flowId)
      .sort((a, b) => a.index - b.index || a.createdAt.localeCompare(b.createdAt))
      .map((s) => structuredClone(s));
  }

  async appendFlowEvent(event: FlowEvent): Promise<void> {
    this.flowEvents.push(structuredClone(event));
  }

  async appendOperatorEvent(event: OperatorEvent): Promise<void> {
    this.operatorEvents.push(structuredClone(event));
  }

  async listFlowEvents(flowId: FlowId, options?: { stepId?: StepId; kind?: string; limit?: number }): Promise<FlowEvent[]> {
    let result = this.flowEvents.filter((e) => e.flowId === flowId);
    if (options?.stepId) result = result.filter((e) => e.stepId === options.stepId);
    if (options?.kind) result = result.filter((e) => e.kind === options.kind);
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (options?.limit) result = result.slice(0, options.limit);
    return result.map((e) => structuredClone(e));
  }

  async listOperatorEvents(flowId: FlowId, options?: { stepId?: StepId; kind?: string; limit?: number }): Promise<OperatorEvent[]> {
    let result = this.operatorEvents.filter((e) => e.flowId === flowId);
    if (options?.stepId) result = result.filter((e) => e.stepId === options.stepId);
    if (options?.kind) result = result.filter((e) => e.kind === options.kind);
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (options?.limit) result = result.slice(0, options.limit);
    return result.map((e) => structuredClone(e));
  }

  async linkArtifact(link: ArtifactLink): Promise<void> {
    this.artifacts.push(structuredClone(link));
  }

  async listArtifacts(flowId: FlowId, stepId?: StepId): Promise<ArtifactLink[]> {
    let result = this.artifacts.filter((a) => a.flowId === flowId);
    if (stepId) result = result.filter((a) => a.stepId === stepId);
    return result.sort((a, b) => b.linkedAt.localeCompare(a.linkedAt)).map((a) => structuredClone(a));
  }

  async linkRun(link: RunLink): Promise<void> {
    this.runLinks.push(structuredClone(link));
  }

  async listRunLinks(flowId: FlowId, stepId?: StepId): Promise<RunLink[]> {
    let result = this.runLinks.filter((r) => r.flowId === flowId);
    if (stepId) result = result.filter((r) => r.stepId === stepId);
    return result.sort((a, b) => b.linkedAt.localeCompare(a.linkedAt)).map((r) => structuredClone(r));
  }

  async createCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.push(structuredClone(checkpoint));
  }

  async getCheckpoint(id: CheckpointId): Promise<Checkpoint | null> {
    const c = this.checkpoints.find((c) => c.id === id);
    return c ? structuredClone(c) : null;
  }

  async listCheckpoints(flowId: FlowId): Promise<Checkpoint[]> {
    return this.checkpoints
      .filter((c) => c.flowId === flowId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => structuredClone(c));
  }

  async createApprovalGate(gate: ApprovalGate): Promise<void> {
    this.approvalGates.push(structuredClone(gate));
  }

  async updateApprovalGate(gate: ApprovalGate): Promise<void> {
    const idx = this.approvalGates.findIndex((g) => g.id === gate.id);
    if (idx >= 0) this.approvalGates[idx] = structuredClone(gate);
  }

  async getApprovalGate(id: string): Promise<ApprovalGate | null> {
    const g = this.approvalGates.find((g) => g.id === id);
    return g ? structuredClone(g) : null;
  }

  async listApprovalGates(flowId: FlowId, options?: { stepId?: StepId; status?: string }): Promise<ApprovalGate[]> {
    let result = this.approvalGates.filter((g) => g.flowId === flowId);
    if (options?.stepId) result = result.filter((g) => g.stepId === options.stepId);
    if (options?.status) result = result.filter((g) => g.status === options.status);
    return result.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).map((g) => structuredClone(g));
  }

  async acquireLock(flowId: FlowId, ownerId: string, leaseMs: number): Promise<boolean> {
    const now = this.#now().toISOString();
    const existing = this.locks.get(flowId);
    const expires = new Date(this.#now().getTime() + leaseMs).toISOString();

    if (!existing) {
      this.locks.set(flowId, { flowId, ownerId, lockedAt: now, heartbeatAt: now, expiresAt: expires });
      return true;
    }

    if (existing.expiresAt < now) {
      this.locks.set(flowId, { flowId, ownerId, lockedAt: now, heartbeatAt: now, expiresAt: expires });
      return true;
    }

    return false;
  }

  async releaseLock(flowId: FlowId, ownerId: string): Promise<void> {
    const existing = this.locks.get(flowId);
    if (existing && existing.ownerId === ownerId) {
      this.locks.delete(flowId);
    }
  }

  async heartbeatLock(flowId: FlowId, ownerId: string, leaseMs: number): Promise<void> {
    const existing = this.locks.get(flowId);
    if (existing && existing.ownerId === ownerId) {
      const now = this.#now().toISOString();
      const expires = new Date(this.#now().getTime() + leaseMs).toISOString();
      this.locks.set(flowId, { ...existing, heartbeatAt: now, expiresAt: expires });
    }
  }

  async getLock(flowId: FlowId): Promise<FlowLock | null> {
    const lock = this.locks.get(flowId);
    return lock ? structuredClone(lock) : null;
  }

  async recoverStaleLocks(before: string): Promise<number> {
    let count = 0;
    for (const [flowId, lock] of this.locks) {
      if (lock.expiresAt < before) {
        this.locks.delete(flowId);
        count++;
      }
    }
    return count;
  }

  async registerProcess(process: FlowProcess): Promise<void> {
    this.processes.push(structuredClone(process));
  }

  async updateProcess(process: FlowProcess): Promise<void> {
    const idx = this.processes.findIndex((p) => p.id === process.id);
    if (idx >= 0) this.processes[idx] = structuredClone(process);
  }

  async getProcess(id: string): Promise<FlowProcess | null> {
    const p = this.processes.find((p) => p.id === id);
    return p ? structuredClone(p) : null;
  }

  async listProcesses(flowId: FlowId, stepId?: StepId): Promise<FlowProcess[]> {
    let result = this.processes.filter((p) => p.flowId === flowId);
    if (stepId) result = result.filter((p) => p.stepId === stepId);
    return result.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((p) => structuredClone(p));
  }

  async saveCompactSummary(summary: CompactSummary): Promise<void> {
    this.compactSummaries.push(structuredClone(summary));
  }

  async listCompactSummaries(flowId: FlowId): Promise<CompactSummary[]> {
    return this.compactSummaries
      .filter((c) => c.flowId === flowId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => structuredClone(c));
  }

  async listUnconsumedSteerEvents(flowId: FlowId): Promise<OperatorEvent[]> {
    return this.operatorEvents
      .filter((e) => e.flowId === flowId && e.kind === "operator-steered" && e.consumedAt === undefined)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((e) => structuredClone(e));
  }

  async markSteerConsumed(
    eventId: string,
    consumption: { consumedByStepId?: StepId; consumedByRunId?: RunId; consumedByFlowEventId?: EventId }
  ): Promise<void> {
    const idx = this.operatorEvents.findIndex((e) => e.id === eventId);
    if (idx >= 0) {
      const ev = this.operatorEvents[idx];
      ev.consumedAt = this.#now().toISOString();
      if (consumption.consumedByStepId) ev.consumedByStepId = consumption.consumedByStepId;
      if (consumption.consumedByRunId) ev.consumedByRunId = consumption.consumedByRunId;
      if (consumption.consumedByFlowEventId) ev.consumedByFlowEventId = consumption.consumedByFlowEventId;
      this.operatorEvents[idx] = ev;
    }
  }

  async atomicTransition<T>(
    flowId: FlowId,
    work: (tx: TaskFlowStore) => Promise<T>
  ): Promise<T> {
    // In-memory: no real transaction isolation, but we execute sequentially
    return work(this);
  }
}
