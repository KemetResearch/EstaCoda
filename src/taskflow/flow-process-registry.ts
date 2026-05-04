// FlowProcessRegistry — thin service wrapper for active process tracking per flow/step
// Track 2: Engine — process ownership and cleanup

import type { FlowId, FlowProcess, StepId } from "./types.js";
import type { TaskFlowStore } from "./taskflow-store.js";

export type FlowProcessRegistryOptions = {
  store: TaskFlowStore;
  now?: () => Date;
};

export class FlowProcessRegistry {
  readonly #store: TaskFlowStore;
  readonly #now: () => Date;

  constructor(options: FlowProcessRegistryOptions) {
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
  }

  async register(process: Omit<FlowProcess, "startedAt">): Promise<FlowProcess> {
    const full: FlowProcess = {
      ...process,
      startedAt: this.#now().toISOString()
    };
    await this.#store.registerProcess(full);
    return full;
  }

  async markExited(id: string, status: "exited" | "orphaned" | "unknown" = "exited"): Promise<void> {
    const process = await this.#store.getProcess(id);
    if (!process) return;
    process.status = status;
    await this.#store.updateProcess(process);
  }

  async list(flowId: FlowId, stepId?: StepId): Promise<FlowProcess[]> {
    return this.#store.listProcesses(flowId, stepId);
  }

  async listRunning(flowId: FlowId, stepId?: StepId): Promise<FlowProcess[]> {
    const all = await this.#store.listProcesses(flowId, stepId);
    return all.filter((p) => p.status === "running");
  }

  async cascadeStop(
    flowId: FlowId,
    stepId?: StepId,
    stopFn: (processManagerId: string) => Promise<void> = async () => {}
  ): Promise<{ stopped: number; orphaned: number }> {
    const processes = await this.listRunning(flowId, stepId);
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
