// TaskFlowAgentLoopAdapter — adapter layer between TaskFlowEngine and AgentLoop
// Track 5: System Integration — steer consumption, run/artifact linkage, auto-compaction

import type { AgentLoop, AgentLoopInput, AgentLoopResponse } from "../runtime/agent-loop.js";
import type { Flow, FlowId, FlowStep, RunId } from "./types.js";
import type { TaskFlowStore } from "./taskflow-store.js";
import type { FlowCompactionService } from "./flow-compaction-service.js";

export type TaskFlowAgentLoopAdapterOptions = {
  agentLoop: AgentLoop;
  store: TaskFlowStore;
  compactionService?: FlowCompactionService;
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
  steerGuidance?: string[];
};

/**
 * Adapter that sits between TaskFlowEngine and AgentLoop.
 *
 * Design (locked in ADR-0004):
 * - TaskFlow is above AgentLoop; AgentLoop remains TaskFlow-agnostic.
 * - The adapter passes an AbortSignal and records turn metadata.
 * - Steer guidance is loaded from unconsumed operator-steered events and passed
 *   explicitly as prefixed context. No hidden prompt mutation.
 * - Run and artifact linkage is recorded after each turn.
 * - Automatic compaction is checked at safe boundaries (between turns).
 */
export class TaskFlowAgentLoopAdapter {
  readonly #agentLoop: AgentLoop;
  readonly #store: TaskFlowStore;
  readonly #compactionService?: FlowCompactionService;

  constructor(options: TaskFlowAgentLoopAdapterOptions) {
    this.#agentLoop = options.agentLoop;
    this.#store = options.store;
    this.#compactionService = options.compactionService;
  }

  /**
   * Execute a single turn within a flow.
   *
   * The adapter:
   * 1. Loads any unconsumed steer events for the flow.
   * 2. Prefixes steer guidance in a structured operator-guidance block (explicit, auditable).
   * 3. Calls AgentLoop.handle() with the provided signal for cancellation.
   * 4. Marks steer events as consumed, linking them to the step/trajectory.
   * 5. Records run links using the real trajectory ID from the AgentLoop.
   * 6. Records artifact links to the store.
   * 7. Checks automatic compaction at the safe boundary.
   */
  async runTurn(input: FlowTurnInput): Promise<FlowTurnResult> {
    const flowId = input.flow.id;
    const stepId = input.step?.id;

    // 1. Load unconsumed steer events
    const steerEvents = await this.#store.listUnconsumedSteerEvents(flowId);
    const steerGuidance = steerEvents.map((ev) => ev.metadata?.guidance as string).filter((g): g is string => typeof g === "string");

    // 2. Build text with structured operator-guidance block
    let turnText = input.text;
    if (steerGuidance.length > 0) {
      const eventIds = steerEvents.map((ev) => ev.id).join(", ");
      const prefix = `--- OPERATOR GUIDANCE (eventIds: ${eventIds}) ---\n${steerGuidance.map((g, i) => `${i + 1}. ${g}`).join("\n")}\n--- END OPERATOR GUIDANCE ---\n\n`;
      turnText = prefix + turnText;
    }

    // 3. Execute turn
    const response = await this.#agentLoop.handle({
      text: turnText,
      channel: input.channel,
      signal: input.signal,
      onEvent: input.onEvent
    });

    // 4. Obtain real trajectory/run id from AgentLoop (never synthetic)
    const realRunId = this.#agentLoop.trajectoryId;

    // 5. Mark steer events as consumed with real linkage
    for (const ev of steerEvents) {
      await this.#store.markSteerConsumed(ev.id, {
        consumedByStepId: stepId,
        consumedByRunId: realRunId
      });
    }

    // 6. Record run linkage using real trajectory id
    if (stepId && realRunId) {
      const existingLinks = await this.#store.listRunLinks(flowId, stepId);
      await this.#store.linkRun({
        runId: realRunId,
        stepId,
        flowId,
        turnIndex: existingLinks.length,
        linkedAt: new Date().toISOString()
      });
    } else if (stepId && !realRunId) {
      // Real id unavailable: record explicit flow_event explaining why
      await this.#store.appendFlowEvent({
        id: crypto.randomUUID(),
        flowId,
        stepId,
        kind: "run-link-unavailable",
        timestamp: new Date().toISOString(),
        data: { reason: "AgentLoop did not expose a trajectoryId" }
      });
    }

    // 7. Record artifact linkage
    for (const artifact of response.artifacts) {
      if (stepId) {
        await this.#store.linkArtifact({
          artifactId: artifact.id,
          stepId,
          flowId,
          kind: "created",
          linkedAt: new Date().toISOString()
        });
      }
    }

    // 8. Check automatic compaction at safe boundary
    if (this.#compactionService) {
      await this.#compactionService.checkAndAutoCompact(flowId);
    }

    return {
      response,
      flowId: input.flow.id,
      stepId: input.step?.id,
      steerGuidance: steerGuidance.length > 0 ? steerGuidance : undefined
    };
  }
}
