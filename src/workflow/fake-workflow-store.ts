// FakeWorkflowStore — deterministic in-memory implementation for tests

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
import type { WorkflowStore } from "./workflow-store.js";

export class FakeWorkflowStore implements WorkflowStore {
  readonly flows = new Map<WorkflowRunId, WorkflowRun>();
  readonly steps = new Map<WorkflowStepId, WorkflowStep>();
  readonly flowEvents: WorkflowEvent[] = [];
  readonly operatorEvents: WorkflowOperatorEvent[] = [];
  readonly artifacts: WorkflowArtifactLink[] = [];
  readonly runLinks: WorkflowAgentRunLink[] = [];
  readonly checkpoints: WorkflowCheckpoint[] = [];
  readonly approvalGates: WorkflowApprovalGate[] = [];
  readonly locks = new Map<WorkflowRunId, WorkflowLock>();
  readonly processes: WorkflowProcess[] = [];
  readonly compactSummaries: WorkflowEventSummary[] = [];
  readonly #now: () => Date;

  constructor(options?: { now?: () => Date }) {
    this.#now = options?.now ?? (() => new Date());
  }

  async createWorkflowRun(flow: WorkflowRun): Promise<void> {
    this.flows.set(flow.id, structuredClone(flow));
  }

  async updateWorkflowRun(flow: WorkflowRun): Promise<void> {
    this.flows.set(flow.id, structuredClone(flow));
  }

  async getWorkflowRun(id: WorkflowRunId): Promise<WorkflowRun | null> {
    const f = this.flows.get(id);
    return f ? structuredClone(f) : null;
  }

  async listWorkflowRuns(sessionId?: string): Promise<WorkflowRun[]> {
    const all = Array.from(this.flows.values());
    const filtered = sessionId ? all.filter((f) => f.sessionId === sessionId) : all;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((f) => structuredClone(f));
  }

  async listActiveWorkflowRuns(): Promise<WorkflowRun[]> {
    const activeStatuses = new Set<WorkflowRun["status"]>(["pending", "running", "paused", "waiting", "interrupted"]);
    return Array.from(this.flows.values())
      .filter((f) => activeStatuses.has(f.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((f) => structuredClone(f));
  }

  async createWorkflowStep(step: WorkflowStep): Promise<void> {
    this.steps.set(step.id, structuredClone(step));
  }

  async updateWorkflowStep(step: WorkflowStep): Promise<void> {
    this.steps.set(step.id, structuredClone(step));
  }

  async getWorkflowStep(id: WorkflowStepId): Promise<WorkflowStep | null> {
    const s = this.steps.get(id);
    return s ? structuredClone(s) : null;
  }

  async listWorkflowSteps(flowId: WorkflowRunId): Promise<WorkflowStep[]> {
    return Array.from(this.steps.values())
      .filter((s) => s.flowId === flowId)
      .sort((a, b) => a.index - b.index || a.createdAt.localeCompare(b.createdAt))
      .map((s) => structuredClone(s));
  }

  async appendWorkflowEvent(event: WorkflowEvent): Promise<void> {
    this.flowEvents.push(structuredClone(event));
  }

  async appendWorkflowOperatorEvent(event: WorkflowOperatorEvent): Promise<void> {
    this.operatorEvents.push(structuredClone(event));
  }

  async listWorkflowEvents(flowId: WorkflowRunId, options?: { stepId?: WorkflowStepId; kind?: string; limit?: number }): Promise<WorkflowEvent[]> {
    let result = this.flowEvents.filter((e) => e.flowId === flowId);
    if (options?.stepId) result = result.filter((e) => e.stepId === options.stepId);
    if (options?.kind) result = result.filter((e) => e.kind === options.kind);
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (options?.limit) result = result.slice(0, options.limit);
    return result.map((e) => structuredClone(e));
  }

  async listWorkflowOperatorEvents(flowId: WorkflowRunId, options?: { stepId?: WorkflowStepId; kind?: string; limit?: number }): Promise<WorkflowOperatorEvent[]> {
    let result = this.operatorEvents.filter((e) => e.flowId === flowId);
    if (options?.stepId) result = result.filter((e) => e.stepId === options.stepId);
    if (options?.kind) result = result.filter((e) => e.kind === options.kind);
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (options?.limit) result = result.slice(0, options.limit);
    return result.map((e) => structuredClone(e));
  }

  async linkWorkflowArtifact(link: WorkflowArtifactLink): Promise<void> {
    this.artifacts.push(structuredClone(link));
  }

  async listWorkflowArtifactLinks(flowId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowArtifactLink[]> {
    let result = this.artifacts.filter((a) => a.flowId === flowId);
    if (stepId) result = result.filter((a) => a.stepId === stepId);
    return result.sort((a, b) => b.linkedAt.localeCompare(a.linkedAt)).map((a) => structuredClone(a));
  }

  async linkWorkflowAgentRun(link: WorkflowAgentRunLink): Promise<void> {
    this.runLinks.push(structuredClone(link));
  }

  async listWorkflowAgentRunLinks(flowId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowAgentRunLink[]> {
    let result = this.runLinks.filter((r) => r.flowId === flowId);
    if (stepId) result = result.filter((r) => r.stepId === stepId);
    return result.sort((a, b) => b.linkedAt.localeCompare(a.linkedAt)).map((r) => structuredClone(r));
  }

  async createWorkflowCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void> {
    this.checkpoints.push(structuredClone(checkpoint));
  }

  async getWorkflowCheckpoint(id: WorkflowCheckpointId): Promise<WorkflowCheckpoint | null> {
    const c = this.checkpoints.find((c) => c.id === id);
    return c ? structuredClone(c) : null;
  }

  async listWorkflowCheckpoints(flowId: WorkflowRunId): Promise<WorkflowCheckpoint[]> {
    return this.checkpoints
      .filter((c) => c.flowId === flowId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => structuredClone(c));
  }

  async createWorkflowApprovalGate(gate: WorkflowApprovalGate): Promise<void> {
    this.approvalGates.push(structuredClone(gate));
  }

  async updateWorkflowApprovalGate(gate: WorkflowApprovalGate): Promise<void> {
    const idx = this.approvalGates.findIndex((g) => g.id === gate.id);
    if (idx >= 0) this.approvalGates[idx] = structuredClone(gate);
  }

  async getWorkflowApprovalGate(id: string): Promise<WorkflowApprovalGate | null> {
    const g = this.approvalGates.find((g) => g.id === id);
    return g ? structuredClone(g) : null;
  }

  async listWorkflowApprovalGates(flowId: WorkflowRunId, options?: { stepId?: WorkflowStepId; status?: string }): Promise<WorkflowApprovalGate[]> {
    let result = this.approvalGates.filter((g) => g.flowId === flowId);
    if (options?.stepId) result = result.filter((g) => g.stepId === options.stepId);
    if (options?.status) result = result.filter((g) => g.status === options.status);
    return result.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).map((g) => structuredClone(g));
  }

  async acquireLock(flowId: WorkflowRunId, ownerId: string, leaseMs: number): Promise<boolean> {
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

  async releaseLock(flowId: WorkflowRunId, ownerId: string): Promise<void> {
    const existing = this.locks.get(flowId);
    if (existing && existing.ownerId === ownerId) {
      this.locks.delete(flowId);
    }
  }

  async heartbeatLock(flowId: WorkflowRunId, ownerId: string, leaseMs: number): Promise<void> {
    const existing = this.locks.get(flowId);
    if (existing && existing.ownerId === ownerId) {
      const now = this.#now().toISOString();
      const expires = new Date(this.#now().getTime() + leaseMs).toISOString();
      this.locks.set(flowId, { ...existing, heartbeatAt: now, expiresAt: expires });
    }
  }

  async getLock(flowId: WorkflowRunId): Promise<WorkflowLock | null> {
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

  async registerWorkflowProcess(process: WorkflowProcess): Promise<void> {
    this.processes.push(structuredClone(process));
  }

  async updateWorkflowProcess(process: WorkflowProcess): Promise<void> {
    const idx = this.processes.findIndex((p) => p.id === process.id);
    if (idx >= 0) this.processes[idx] = structuredClone(process);
  }

  async getWorkflowProcess(id: string): Promise<WorkflowProcess | null> {
    const p = this.processes.find((p) => p.id === id);
    return p ? structuredClone(p) : null;
  }

  async listWorkflowProcesses(flowId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowProcess[]> {
    let result = this.processes.filter((p) => p.flowId === flowId);
    if (stepId) result = result.filter((p) => p.stepId === stepId);
    return result.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((p) => structuredClone(p));
  }

  async saveWorkflowEventSummary(summary: WorkflowEventSummary): Promise<void> {
    this.compactSummaries.push(structuredClone(summary));
  }

  async listWorkflowEventSummaries(flowId: WorkflowRunId): Promise<WorkflowEventSummary[]> {
    return this.compactSummaries
      .filter((c) => c.flowId === flowId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => structuredClone(c));
  }

  async listUnconsumedSteerEvents(flowId: WorkflowRunId): Promise<WorkflowOperatorEvent[]> {
    return this.operatorEvents
      .filter((e) => e.flowId === flowId && e.kind === "operator-steered" && e.consumedAt === undefined)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((e) => structuredClone(e));
  }

  async markSteerConsumed(
    eventId: string,
    consumption: { consumedByStepId?: WorkflowStepId; consumedByRunId?: RunId; consumedByFlowEventId?: EventId }
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
    flowId: WorkflowRunId,
    work: (tx: WorkflowStore) => Promise<T>
  ): Promise<T> {
    // In-memory: no real transaction isolation, but we execute sequentially
    return work(this);
  }
}
