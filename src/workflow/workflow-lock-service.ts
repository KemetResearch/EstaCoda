// WorkflowLockService — lease-based distributed lock with heartbeat and stale recovery

import type { WorkflowRunId, WorkflowLock } from "./types.js";
import type { WorkflowStore } from "./workflow-store.js";

export type WorkflowLockServiceOptions = {
  store: WorkflowStore;
  now?: () => Date;
  defaultLeaseMs?: number;
  heartbeatIntervalMs?: number;
};

export class WorkflowLockService {
  readonly #store: WorkflowStore;
  readonly #now: () => Date;
  readonly #defaultLeaseMs: number;
  readonly #heartbeatIntervalMs: number;

  constructor(options: WorkflowLockServiceOptions) {
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
    this.#defaultLeaseMs = options.defaultLeaseMs ?? 30_000;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
  }

  get defaultLeaseMs(): number {
    return this.#defaultLeaseMs;
  }

  get heartbeatIntervalMs(): number {
    return this.#heartbeatIntervalMs;
  }

  async acquire(runId: WorkflowRunId, ownerId: string, leaseMs?: number): Promise<boolean> {
    return this.#store.acquireLock(runId, ownerId, leaseMs ?? this.#defaultLeaseMs);
  }

  async release(runId: WorkflowRunId, ownerId: string): Promise<void> {
    return this.#store.releaseLock(runId, ownerId);
  }

  async heartbeat(runId: WorkflowRunId, ownerId: string, leaseMs?: number): Promise<void> {
    return this.#store.heartbeatLock(runId, ownerId, leaseMs ?? this.#defaultLeaseMs);
  }

  async get(runId: WorkflowRunId): Promise<WorkflowLock | null> {
    return this.#store.getLock(runId);
  }

  async recoverStale(before?: string): Promise<number> {
    const cutoff = before ?? this.#now().toISOString();
    return this.#store.recoverStaleLocks(cutoff);
  }

  isStale(lock: WorkflowLock, now?: Date): boolean {
    const t = now ?? this.#now();
    return lock.expiresAt < t.toISOString();
  }
}
