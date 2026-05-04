// TaskFlowAgentLoopAdapter — adapter layer between TaskFlowEngine and AgentLoop
// Track 2: Engine — wraps AgentLoop.handle() with flow context, AbortSignal, and turn recording
// NOTE: Process ID recording requires ToolExecutor changes (Track 4). Seams preserved here.

import type { AgentLoop, AgentLoopInput, AgentLoopResponse } from "../runtime/agent-loop.js";
import type { Flow, FlowId, FlowStep } from "./types.js";
import type { TaskFlowStore } from "./taskflow-store.js";

export type TaskFlowAgentLoopAdapterOptions = {
  agentLoop: AgentLoop;
  store: TaskFlowStore;
};

export type FlowTurnInput = {
  flow: Flow;
  step?: FlowStep;
  text: string;
  channel: AgentLoopInput["channel"];
  signal?: AbortSignal;
  onEvent?: AgentLoopInput["onEvent"];
};

export type FlowTurnResult = {
  response: AgentLoopResponse;
  flowId: FlowId;
  stepId?: string;
};

/**
 * Adapter that sits between TaskFlowEngine and AgentLoop.
 *
 * Design (locked in ADR-0004):
 * - TaskFlow is above AgentLoop; AgentLoop remains TaskFlow-agnostic.
 * - The adapter passes an AbortSignal and records turn metadata.
 * - In v0.8, process ID recording is a no-op seam (ToolExecutor does not yet return process IDs).
 * - Run linkage and artifact linkage are handled by Track 4 integration.
 */
export class TaskFlowAgentLoopAdapter {
  readonly #agentLoop: AgentLoop;
  readonly #store: TaskFlowStore;

  constructor(options: TaskFlowAgentLoopAdapterOptions) {
    this.#agentLoop = options.agentLoop;
    this.#store = options.store;
  }

  /**
   * Execute a single turn within a flow.
   *
   * The adapter:
   * 1. Calls AgentLoop.handle() with the provided signal for cancellation.
   * 2. Returns the turn result with flow/step context attached.
   * 3. (Future/Track 4) Will record run links and artifact links to the store.
   */
  async runTurn(input: FlowTurnInput): Promise<FlowTurnResult> {
    const response = await this.#agentLoop.handle({
      text: input.text,
      channel: input.channel,
      signal: input.signal,
      onEvent: input.onEvent
    });

    return {
      response,
      flowId: input.flow.id,
      stepId: input.step?.id
    };
  }
}
