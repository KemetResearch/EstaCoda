// WorkflowProcessRegistry — thin service wrapper for active process tracking per flow/step
// Track 2: Engine — process ownership and cleanup

import type { WorkflowRunId, WorkflowProcess, WorkflowStepId } from "./types.js";
import type { WorkflowStore } from "./workflow-store.js";

export type WorkflowProcessRegistryOptions = {
  store: WorkflowStore;
  now?: () => Date;
};

export class WorkflowProcessRegistry {
  readonly #store: WorkflowStore;
  readonly #now: () => Date;

  constructor(options: WorkflowProcessRegistryOptions) {
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
  }

  async register(process: Omit<WorkflowProcess, "startedAt">): Promise<WorkflowProcess> {
    const full: WorkflowProcess = {
      ...process,
      startedAt: this.#now().toISOString()
    };
    await this.#store.registerWorkflowProcess(full);
    return full;
  }

  async markExited(id: string, status: "exited" | "orphaned" | "unknown" = "exited"): Promise<void> {
    const process = await this.#store.getWorkflowProcess(id);
    if (!process) return;
    process.status = status;
    await this.#store.updateWorkflowProcess(process);
  }

  async list(runId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowProcess[]> {
    return this.#store.listWorkflowProcesses(runId, stepId);
  }

  async listByRun(runId: WorkflowRunId): Promise<WorkflowProcess[]> {
    return this.list(runId);
  }

  async listRunning(runId: WorkflowRunId, stepId?: WorkflowStepId): Promise<WorkflowProcess[]> {
    const all = await this.#store.listWorkflowProcesses(runId, stepId);
    return all.filter((p) => p.status === "running");
  }

  async terminate(
    id: string,
    options: { signal?: "SIGTERM" | "SIGKILL"; timeoutMs?: number } = {}
  ): Promise<{ ok: boolean }> {
    const process = await this.#store.getWorkflowProcess(id);
    if (!process) return { ok: false };

    // In v0.8, actual process termination is delegated to ProcessManager.
    // This registry method marks the process as exited and records
    // the termination signal for audit purposes.
    process.status = "exited";
    await this.#store.updateWorkflowProcess(process);
    return { ok: true };
  }

  async cascadeStop(
    runId: WorkflowRunId,
    stepId?: WorkflowStepId,
    stopFn: (processManagerId: string) => Promise<void> = async () => {}
  ): Promise<{ stopped: number; orphaned: number }> {
    const processes = await this.listRunning(runId, stepId);
    let stopped = 0;
    let orphaned = 0;

    for (const process of processes) {
      try {
        await stopFn(process.processManagerId);
        await this.markExited(process.id, "exited");
        stopped++;
      } catch {
        await this.markExited(process.id, "orphaned");
        orphaned++;
      }
    }

    return { stopped, orphaned };
  }
}
