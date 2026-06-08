// WorkflowRestartRecovery — rehydrate active flows after process restart
// Track 2: Engine — load active flows, mark running→interrupted, show stale warnings

import type { Flow, FlowState } from "./types.js";
import type { WorkflowStore } from "./workflow-store.js";
import type { WorkflowLockService } from "./workflow-lock-service.js";

export type WorkflowRestartRecoveryOptions = {
  store: WorkflowStore;
  lockService: WorkflowLockService;
  now?: () => Date;
};

export type RecoveryResult = {
  recovered: number;
  interrupted: number;
  staleLocksReleased: number;
  warnings: string[];
};

/**
 * Recover flows after a process restart.
 *
 * On restart:
 * 1. Load all flows that were in non-terminal active states (running, paused, waiting).
 * 2. Mark running flows as "interrupted" (they lost their runner when the process died).
 * 3. Mark running steps as "interrupted".
 * 4. Recover stale locks (any lock whose lease expired while the process was down).
 * 5. Return warnings for operator visibility.
 */
export class WorkflowRestartRecovery {
  readonly #store: WorkflowStore;
  readonly #lockService: WorkflowLockService;
  readonly #now: () => Date;

  constructor(options: WorkflowRestartRecoveryOptions) {
    this.#store = options.store;
    this.#lockService = options.lockService;
    this.#now = options.now ?? (() => new Date());
  }

  async recover(): Promise<RecoveryResult> {
    const warnings: string[] = [];
    const activeFlows = await this.#store.listActiveFlows();
    let interrupted = 0;

    for (const flow of activeFlows) {
      if (flow.status === "running") {
        await this.#interruptFlowAndSteps(flow);
        interrupted++;
        warnings.push(`Flow ${flow.id} (${flow.intent?.nativeIntent ?? "unknown intent"}) was interrupted due to restart.`);
      } else if (flow.status === "paused" || flow.status === "waiting") {
        warnings.push(`Flow ${flow.id} is ${flow.status} after restart — can be resumed.`);
      }
    }

    const staleLocksReleased = await this.#lockService.recoverStale(this.#now().toISOString());
    if (staleLocksReleased > 0) {
      warnings.push(`${staleLocksReleased} stale flow lock(s) released.`);
    }

    return {
      recovered: activeFlows.length,
      interrupted,
      staleLocksReleased,
      warnings
    };
  }

  async #interruptFlowAndSteps(flow: Flow): Promise<void> {
    const steps = await this.#store.listSteps(flow.id);

    await this.#store.atomicTransition(flow.id, async (tx) => {
      for (const step of steps) {
        if (step.status === "running" || step.status === "paused" || step.status === "waiting_for_approval" || step.status === "waiting_for_input") {
          const fromStatus = step.status;
          step.status = "interrupted";
          step.interruptReason = "Process restarted while step was active";
          step.updatedAt = this.#now().toISOString();
          await tx.updateStep(step);
          await tx.appendFlowEvent({
            id: crypto.randomUUID(),
            flowId: flow.id,
            stepId: step.id,
            kind: "step-interrupted",
            data: { from: fromStatus, reason: "restart-recovery" },
            timestamp: this.#now().toISOString()
          });
        }
      }

      const fromStatus = flow.status;
      flow.status = "interrupted";
      flow.interruptReason = "Process restarted while flow was running";
      flow.updatedAt = this.#now().toISOString();
      await tx.updateFlow(flow);
      await tx.appendFlowEvent({
        id: crypto.randomUUID(),
        flowId: flow.id,
        kind: "flow-state-changed",
        data: { from: fromStatus, to: "interrupted", reason: "restart-recovery" },
        timestamp: this.#now().toISOString()
      });
    });
  }
}
