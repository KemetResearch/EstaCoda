// WorkflowRestartRecovery — rehydrate active workflow runs after process restart
// Track 2: Engine — load active workflow runs, mark running→interrupted, show stale warnings

import type { WorkflowRun, WorkflowRunState } from "./types.js";
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
 * Recover workflow runs after a process restart.
 *
 * On restart:
 * 1. Load all workflow runs that were in non-terminal active states (running, paused, waiting).
 * 2. Mark running workflow runs as "interrupted" (they lost their runner when the process died).
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
    const activeRuns = await this.#store.listActiveWorkflowRuns();
    let interrupted = 0;

    for (const run of activeRuns) {
      if (run.status === "running") {
        await this.#interruptWorkflowRunAndSteps(run);
        interrupted++;
        warnings.push(`Workflow run ${run.id} (${run.intent?.nativeIntent ?? "unknown intent"}) was interrupted due to restart.`);
      } else if (run.status === "paused" || run.status === "waiting") {
        warnings.push(`Workflow run ${run.id} is ${run.status} after restart — can be resumed.`);
      }
    }

    const staleLocksReleased = await this.#lockService.recoverStale(this.#now().toISOString());
    if (staleLocksReleased > 0) {
      warnings.push(`${staleLocksReleased} stale workflow run lock(s) released.`);
    }

    return {
      recovered: activeRuns.length,
      interrupted,
      staleLocksReleased,
      warnings
    };
  }

  async #interruptWorkflowRunAndSteps(run: WorkflowRun): Promise<void> {
    const steps = await this.#store.listWorkflowSteps(run.id);

    await this.#store.atomicTransition(run.id, async (tx) => {
      for (const step of steps) {
        if (step.status === "running" || step.status === "paused" || step.status === "waiting_for_approval" || step.status === "waiting_for_input") {
          const fromStatus = step.status;
          step.status = "interrupted";
          step.interruptReason = "Process restarted while step was active";
          step.updatedAt = this.#now().toISOString();
          await tx.updateWorkflowStep(step);
          await tx.appendWorkflowEvent({
            id: crypto.randomUUID(),
            runId: run.id,
            stepId: step.id,
            kind: "step-interrupted",
            data: { from: fromStatus, reason: "restart-recovery" },
            timestamp: this.#now().toISOString()
          });
        }
      }

      const fromStatus = run.status;
      run.status = "interrupted";
      run.interruptReason = "Process restarted while workflow run was running";
      run.updatedAt = this.#now().toISOString();
      await tx.updateWorkflowRun(run);
      await tx.appendWorkflowEvent({
        id: crypto.randomUUID(),
        runId: run.id,
        kind: "flow-state-changed",
        data: { from: fromStatus, to: "interrupted", reason: "restart-recovery" },
        timestamp: this.#now().toISOString()
      });
    });
  }
}
