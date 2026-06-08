// WorkflowLockService — lease-based distributed lock with heartbeat and stale recovery

import type { FlowId, FlowLock } from "./types.js";
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

  async acquire(flowId: FlowId, ownerId: string, leaseMs?: number): Promise<boolean> {
    return this.#store.acquireLock(flowId, ownerId, leaseMs ?? this.#defaultLeaseMs);
  }

  async release(flowId: FlowId, ownerId: string): Promise<void> {
    return this.#store.releaseLock(flowId, ownerId);
  }

  async heartbeat(flowId: FlowId, ownerId: string, leaseMs?: number): Promise<void> {
    return this.#store.heartbeatLock(flowId, ownerId, leaseMs ?? this.#defaultLeaseMs);
  }

  async get(flowId: FlowId): Promise<FlowLock | null> {
    return this.#store.getLock(flowId);
  }

  async recoverStale(before?: string): Promise<number> {
    const cutoff = before ?? this.#now().toISOString();
    return this.#store.recoverStaleLocks(cutoff);
  }

  isStale(lock: FlowLock, now?: Date): boolean {
    const t = now ?? this.#now();
    return lock.expiresAt < t.toISOString();
  }
}
