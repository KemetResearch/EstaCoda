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
  readonly runs = new Map<WorkflowRunId, WorkflowRun>();
  readonly steps = new Map<WorkflowStepId, WorkflowStep>();
  readonly workflowEvents: WorkflowEvent[] = [];
  readonly workflowOperatorEvents: WorkflowOperatorEvent[] = [];
  readonly artifacts: WorkflowArtifactLink[] = [];
  readonly runLinks: WorkflowAgentRunLink[] = [];
  readonly checkpoints: WorkflowCheckpoint[] = [];
  readonly workflowApprovalGates: WorkflowApprovalGate[] = [];
  readonly locks = new Map<WorkflowRunId, WorkflowLock>();
  readonly processes: WorkflowProcess[] = [];
  readonly workflowEventSummaries: WorkflowEventSummary[] = [];
  readonly #now: () => Date;

  constructor(options?: { now?: () => Date }) {
    this.#now = options?.now ?? (() => new Date());
  }

  async createWorkflowRun(run: WorkflowRun): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
  }

  async updateWorkflowRun(run: WorkflowRun): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
  }

  async getWorkflowRun(id: WorkflowRunId): Promise<WorkflowRun | null> {
    const f = this.runs.get(id);
    return f ? structuredClone(f) : null;
  }

  async listWorkflowRuns(sessionId?: string): Promise<WorkflowRun[]> {
    const all = Array.from(this.runs.values());
    const filtered = sessionId ? all.filter((f) => f.sessionId === sessionId) : all;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((f) => structuredClone(f));
  }

  async listActiveWorkflowRuns(): Promise<WorkflowRun[]> {
    const activeStatuses = new Set<WorkflowRun["status"]>(["pending", "running", "paused", "waiting", "interrupted"]);
    return Array.from(this.runs.values())
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

  async listWorkflowSteps(runId: WorkflowRunId): Promise<WorkflowStep[]> {
    return Array.from(this.steps.values())
      .filter((s) => s.runId === runId)
      .sort((a, b) => a.index - b.index || a.createdAt.localeCompare(b.createdAt))
      .map((s) => structuredClone(s));
  }

  async appendWorkflowEvent(event: WorkflowEvent): Promise<void> {
    this.workflowEvents.push(structuredClone(event));
  }

  async appendWorkflowOperatorEvent(event: WorkflowOperatorEvent): Promise<void> {
    this.workflowOperatorEvents.push(structuredClone(event));
  }

  async listWorkflowEvents(runId: WorkflowRunId, options?: { stepId?: WorkflowStepId; kind?: string; limit?: number }): Promise<WorkflowEvent[]> {
    let result = this.workflowEvents.filter((e) => e.runId === runId);
    if (options?.stepId) result = result.filter((e) => e.stepId === options.stepId);
    if (options?.kind) result = result.filter((e) => e.kind === options.kind);
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (options?.limit) result = result.slice(0, options.limit);
    return result.map((e) => structuredClone(e));
  }

  async listWorkflowOperatorEvents(runId: WorkflowRunId, options?: { stepId?: WorkflowStepId; kind?: string; limit?: number }): Promise<WorkflowOperatorEvent[]> {
    let result = this.workflowOperatorEvents.filter((e) => e.runId === runId);
    if (options?.stepId) result = result.filter((e) => e.stepId === options.stepId);
    if (options?.kind) result = result.filter((e) => e.kind === options.kind);
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (options?.limit) result = result.slice(0, options.limit);
    return result.map((e) => structuredClone(e));
  }

  async linkWorkflowArtifact(link: WorkflowArtifactLink): Promise<void> {
    this.artifacts.push(structuredClone(link));
  }

  async listWorkflowArtifactLinks(runId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowArtifactLink[]> {
    let result = this.artifacts.filter((a) => a.runId === runId);
    if (stepId) result = result.filter((a) => a.stepId === stepId);
    return result.sort((a, b) => b.linkedAt.localeCompare(a.linkedAt)).map((a) => structuredClone(a));
  }

  async linkWorkflowAgentRun(link: WorkflowAgentRunLink): Promise<void> {
    this.runLinks.push(structuredClone(link));
  }

  async listWorkflowAgentRunLinks(runId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowAgentRunLink[]> {
    let result = this.runLinks.filter((r) => r.runId === runId);
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

  async listWorkflowCheckpoints(runId: WorkflowRunId): Promise<WorkflowCheckpoint[]> {
    return this.checkpoints
      .filter((c) => c.runId === runId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => structuredClone(c));
  }

  async createWorkflowApprovalGate(gate: WorkflowApprovalGate): Promise<void> {
    this.workflowApprovalGates.push(structuredClone(gate));
  }

  async updateWorkflowApprovalGate(gate: WorkflowApprovalGate): Promise<void> {
    const idx = this.workflowApprovalGates.findIndex((g) => g.id === gate.id);
    if (idx >= 0) this.workflowApprovalGates[idx] = structuredClone(gate);
  }

  async getWorkflowApprovalGate(id: string): Promise<WorkflowApprovalGate | null> {
    const g = this.workflowApprovalGates.find((g) => g.id === id);
    return g ? structuredClone(g) : null;
  }

  async listWorkflowApprovalGates(runId: WorkflowRunId, options?: { stepId?: WorkflowStepId; status?: string }): Promise<WorkflowApprovalGate[]> {
    let result = this.workflowApprovalGates.filter((g) => g.runId === runId);
    if (options?.stepId) result = result.filter((g) => g.stepId === options.stepId);
    if (options?.status) result = result.filter((g) => g.status === options.status);
    return result.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).map((g) => structuredClone(g));
  }

  async acquireLock(runId: WorkflowRunId, ownerId: string, leaseMs: number): Promise<boolean> {
    const now = this.#now().toISOString();
    const existing = this.locks.get(runId);
    const expires = new Date(this.#now().getTime() + leaseMs).toISOString();

    if (!existing) {
      this.locks.set(runId, { runId, ownerId, lockedAt: now, heartbeatAt: now, expiresAt: expires });
      return true;
    }

    if (existing.expiresAt < now) {
      this.locks.set(runId, { runId, ownerId, lockedAt: now, heartbeatAt: now, expiresAt: expires });
      return true;
    }

    return false;
  }

  async releaseLock(runId: WorkflowRunId, ownerId: string): Promise<void> {
    const existing = this.locks.get(runId);
    if (existing && existing.ownerId === ownerId) {
      this.locks.delete(runId);
    }
  }

  async heartbeatLock(runId: WorkflowRunId, ownerId: string, leaseMs: number): Promise<void> {
    const existing = this.locks.get(runId);
    if (existing && existing.ownerId === ownerId) {
      const now = this.#now().toISOString();
      const expires = new Date(this.#now().getTime() + leaseMs).toISOString();
      this.locks.set(runId, { ...existing, heartbeatAt: now, expiresAt: expires });
    }
  }

  async getLock(runId: WorkflowRunId): Promise<WorkflowLock | null> {
    const lock = this.locks.get(runId);
    return lock ? structuredClone(lock) : null;
  }

  async recoverStaleLocks(before: string): Promise<number> {
    let count = 0;
    for (const [runId, lock] of this.locks) {
      if (lock.expiresAt < before) {
        this.locks.delete(runId);
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

  async listWorkflowProcesses(runId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowProcess[]> {
    let result = this.processes.filter((p) => p.runId === runId);
    if (stepId) result = result.filter((p) => p.stepId === stepId);
    return result.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((p) => structuredClone(p));
  }

  async saveWorkflowEventSummary(summary: WorkflowEventSummary): Promise<void> {
    this.workflowEventSummaries.push(structuredClone(summary));
  }

  async listWorkflowEventSummaries(runId: WorkflowRunId): Promise<WorkflowEventSummary[]> {
    return this.workflowEventSummaries
      .filter((c) => c.runId === runId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => structuredClone(c));
  }

  async listUnconsumedSteerEvents(runId: WorkflowRunId): Promise<WorkflowOperatorEvent[]> {
    return this.workflowOperatorEvents
      .filter((e) => e.runId === runId && e.kind === "operator-steered" && e.consumedAt === undefined)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((e) => structuredClone(e));
  }

  async markSteerConsumed(
    eventId: string,
    consumption: { consumedByStepId?: WorkflowStepId; consumedByRunId?: RunId; consumedByWorkflowEventId?: EventId }
  ): Promise<void> {
    const idx = this.workflowOperatorEvents.findIndex((e) => e.id === eventId);
    if (idx >= 0) {
      const ev = this.workflowOperatorEvents[idx];
      ev.consumedAt = this.#now().toISOString();
      if (consumption.consumedByStepId) ev.consumedByStepId = consumption.consumedByStepId;
      if (consumption.consumedByRunId) ev.consumedByRunId = consumption.consumedByRunId;
      if (consumption.consumedByWorkflowEventId) ev.consumedByWorkflowEventId = consumption.consumedByWorkflowEventId;
      this.workflowOperatorEvents[idx] = ev;
    }
  }

  async atomicTransition<T>(
    runId: WorkflowRunId,
    work: (tx: WorkflowStore) => Promise<T>
  ): Promise<T> {
    // In-memory: no real transaction isolation, but we execute sequentially
    return work(this);
  }
}
