// OperatorCommandDispatcher — routes operator slash commands to TaskFlowEngine
// Track 3: Operator Control Plane — command dispatch, validation, result formatting

import type {
  Flow,
  FlowId,
  FlowEvent,
  OperatorEvent,
  StepId,
  CompactSummary
} from "./types.js";
import type { TaskFlowEngine } from "./taskflow-engine.js";
import type { TaskFlowStore } from "./taskflow-store.js";
import type { FlowProcessRegistry } from "./flow-process-registry.js";
import type { FlowCompactionService } from "./flow-compaction-service.js";
import { isFlowStateTerminal } from "./types.js";

export type OperatorCommand =
  | { command: "/status"; flowId: FlowId }
  | { command: "/pause"; flowId: FlowId; reason?: string; operator: string }
  | { command: "/resume"; flowId: FlowId; operator: string }
  | { command: "/interrupt"; flowId: FlowId; reason?: string; operator: string }
  | { command: "/cancel"; flowId: FlowId; reason?: string; operator: string }
  | { command: "/steer"; flowId: FlowId; guidance: string; operator: string }
  | { command: "/approve"; stepId: StepId; operator: string; grantId?: string }
  | { command: "/reject"; stepId: StepId; operator: string; reason?: string }
  | { command: "/retry"; stepId: StepId; operator: string }
  | { command: "/skip"; stepId: StepId; reason?: string; operator: string }
  | { command: "/checkpoint"; flowId: FlowId; name: string; description?: string; operator: string }
  | { command: "/compact"; flowId: FlowId; operator: string }
  | { command: "/trace"; flowId: FlowId; limit?: number };

export type CommandResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; error: string };

export type FlowStatusView = {
  flowId: FlowId;
  status: string;
  currentStepId?: string;
  currentStepName?: string;
  stepCount: number;
  completedSteps: number;
  pendingApprovals: number;
  elapsedMs?: number;
  canPause: boolean;
  canResume: boolean;
  canInterrupt: boolean;
  canCancel: boolean;
};

export type TimelineEntry = {
  timestamp: string;
  kind: "flow" | "operator";
  event: FlowEvent | OperatorEvent;
};

export class OperatorCommandDispatcher {
  readonly #engine: TaskFlowEngine;
  readonly #store: TaskFlowStore;
  readonly #processRegistry: FlowProcessRegistry;
  readonly #compactionService: FlowCompactionService;

  constructor(options: { engine: TaskFlowEngine; store: TaskFlowStore; processRegistry: FlowProcessRegistry; compactionService: FlowCompactionService }) {
    this.#engine = options.engine;
    this.#store = options.store;
    this.#processRegistry = options.processRegistry;
    this.#compactionService = options.compactionService;
  }

  async dispatch(cmd: OperatorCommand): Promise<CommandResult> {
    switch (cmd.command) {
      case "/status":
        return this.#handleStatus(cmd.flowId);
      case "/pause":
        return this.#handlePause(cmd.flowId, cmd.reason, cmd.operator);
      case "/resume":
        return this.#handleResume(cmd.flowId, cmd.operator);
      case "/interrupt":
        return this.#handleInterrupt(cmd.flowId, cmd.reason, cmd.operator);
      case "/cancel":
        return this.#handleCancel(cmd.flowId, cmd.reason, cmd.operator);
      case "/steer":
        return this.#handleSteer(cmd.flowId, cmd.guidance, cmd.operator);
      case "/approve":
        return this.#handleApprove(cmd.stepId, cmd.operator, cmd.grantId);
      case "/reject":
        return this.#handleReject(cmd.stepId, cmd.operator, cmd.reason);
      case "/retry":
        return this.#handleRetry(cmd.stepId, cmd.operator);
      case "/skip":
        return this.#handleSkip(cmd.stepId, cmd.reason, cmd.operator);
      case "/checkpoint":
        return this.#handleCheckpoint(cmd.flowId, cmd.name, cmd.description, cmd.operator);
      case "/compact":
        return this.#handleCompact(cmd.flowId, cmd.operator);
      case "/trace":
        return this.#handleTrace(cmd.flowId, cmd.limit);
      default:
        return { ok: false, error: `Unknown command: ${(cmd as OperatorCommand).command}` };
    }
  }

  // ─── /status ───

  async #handleStatus(flowId: FlowId): Promise<CommandResult> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) return { ok: false, error: "Flow not found" };

    const steps = await this.#store.listSteps(flowId);
    const currentStep = steps.find((s) => s.id === flow.currentStepId);
    const completedSteps = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
    const pendingGates = await this.#store.listApprovalGates(flowId, { status: "pending" });

    const createdAt = new Date(flow.createdAt).getTime();
    const elapsedMs = Date.now() - createdAt;

    const view: FlowStatusView = {
      flowId,
      status: flow.status,
      currentStepId: flow.currentStepId,
      currentStepName: currentStep?.name,
      stepCount: steps.length,
      completedSteps,
      pendingApprovals: pendingGates.length,
      elapsedMs,
      canPause: flow.status === "running",
      canResume: flow.status === "paused" || flow.status === "interrupted" || flow.status === "waiting",
      canInterrupt: flow.status === "running" || flow.status === "paused" || flow.status === "waiting",
      canCancel: !isFlowStateTerminal(flow.status)
    };

    return {
      ok: true,
      message: this.#formatStatus(view),
      data: { view }
    };
  }

  // ─── /pause ───

  async #handlePause(flowId: FlowId, reason?: string, operator?: string): Promise<CommandResult> {
    try {
      await this.#engine.requestPause(flowId, reason, operator);
      return { ok: true, message: `Pause requested for flow ${flowId}. Will take effect at next safe boundary.` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /resume ───

  async #handleResume(flowId: FlowId, operator: string): Promise<CommandResult> {
    try {
      const flow = await this.#engine.resumeFlow(flowId, operator);
      return { ok: true, message: `Flow ${flowId} resumed. Current state: ${flow.status}.` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /interrupt ───

  async #handleInterrupt(flowId: FlowId, reason?: string, operator?: string): Promise<CommandResult> {
    try {
      // Clean up active processes first, recording each attempt
      const processes = await this.#processRegistry.listByFlow(flowId);
      const running = processes.filter((p) => p.status === "running");
      const cleanupResults: { processId: string; ok: boolean }[] = [];

      for (const proc of running) {
        const result = await this.#processRegistry.terminate(proc.id, { signal: "SIGTERM", timeoutMs: 5000 });
        cleanupResults.push({ processId: proc.id, ok: result.ok });
      }

      // Record cleanup audit trail atomically
      await this.#store.atomicTransition(flowId, async (tx) => {
        for (const cr of cleanupResults) {
          const proc = processes.find((p) => p.id === cr.processId);
          if (!proc) continue;
          await tx.appendFlowEvent({
            id: crypto.randomUUID(),
            flowId,
            stepId: proc.stepId,
            kind: cr.ok ? "process-exited" : "process-orphaned",
            data: {
              processId: cr.processId,
              processManagerId: proc.processManagerId,
              reason: "interrupt-cleanup",
              signal: "SIGTERM",
              success: cr.ok
            },
            timestamp: new Date().toISOString()
          });
        }
      });

      const flow = await this.#engine.interruptFlow(flowId, reason, operator);
      const terminated = cleanupResults.filter((r) => r.ok).length;
      const failed = cleanupResults.filter((r) => !r.ok).length;

      return {
        ok: true,
        message: `Flow ${flowId} interrupted. ${terminated} process(es) terminated, ${failed} failed.`,
        data: {
          flowStatus: flow.status,
          terminatedProcesses: terminated,
          failedProcesses: failed,
          cleanupDetails: cleanupResults
        }
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /cancel ───

  async #handleCancel(flowId: FlowId, reason?: string, operator?: string): Promise<CommandResult> {
    try {
      const flow = await this.#engine.cancelFlow(flowId, reason, operator);
      return { ok: true, message: `Flow ${flowId} cancelled. Final state: ${flow.status}.` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /steer ───

  async #handleSteer(flowId: FlowId, guidance: string, operator: string): Promise<CommandResult> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) return { ok: false, error: "Flow not found" };

    if (isFlowStateTerminal(flow.status)) {
      return { ok: false, error: `Cannot steer a flow in terminal state ${flow.status}` };
    }

    // Record steer as operator event via atomic transition
    await this.#store.atomicTransition(flowId, async (tx) => {
      await tx.appendOperatorEvent({
        id: crypto.randomUUID(),
        flowId,
        kind: "operator-steered",
        operator,
        command: "/steer",
        effect: guidance,
        previousState: flow.status,
        newState: flow.status,
        metadata: { guidance },
        timestamp: new Date().toISOString()
      });
    });

    return { ok: true, message: `Steer recorded for flow ${flowId}. Guidance will be included in next turn context.` };
  }

  // ─── /approve ───

  async #handleApprove(stepId: StepId, operator: string, grantId?: string): Promise<CommandResult> {
    try {
      const step = await this.#engine.approveStep(stepId, operator, grantId);
      return { ok: true, message: `Step ${stepId} approved. Resumed execution.`, data: { stepStatus: step.status } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /reject ───

  async #handleReject(stepId: StepId, operator: string, reason?: string): Promise<CommandResult> {
    try {
      const step = await this.#engine.rejectStep(stepId, operator, reason);
      return { ok: true, message: `Step ${stepId} rejected. Status: ${step.status}.`, data: { stepStatus: step.status } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /retry ───

  async #handleRetry(stepId: StepId, operator: string): Promise<CommandResult> {
    try {
      const step = await this.#engine.retryStep(stepId, operator);
      return { ok: true, message: `Retry step created for ${stepId}. Attempt ${step.attemptNumber}.`, data: { retryStepId: step.id } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /skip ───

  async #handleSkip(stepId: StepId, reason?: string, operator?: string): Promise<CommandResult> {
    try {
      const step = await this.#engine.skipStep(stepId, reason, operator);
      return { ok: true, message: `Step ${stepId} skipped. Status: ${step.status}.`, data: { stepStatus: step.status } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /checkpoint ───

  async #handleCheckpoint(flowId: FlowId, name: string, description?: string, operator?: string): Promise<CommandResult> {
    try {
      const checkpoint = await this.#engine.createCheckpoint(flowId, name, description, operator);
      return { ok: true, message: `Checkpoint '${name}' created for flow ${flowId}.`, data: { checkpointId: checkpoint.id } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── /trace ───

  async #handleTrace(flowId: FlowId, limit?: number): Promise<CommandResult> {
    const flow = await this.#store.getFlow(flowId);
    if (!flow) return { ok: false, error: "Flow not found" };

    const flowEvents = await this.#store.listFlowEvents(flowId);
    const opEvents = await this.#store.listOperatorEvents(flowId);
    const compactSummaries = await this.#store.listCompactSummaries(flowId);

    const timeline: TimelineEntry[] = [
      ...flowEvents.map((e) => ({ timestamp: e.timestamp, kind: "flow" as const, event: e })),
      ...opEvents.map((e) => ({ timestamp: e.timestamp, kind: "operator" as const, event: e }))
    ];

    timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const limited = limit ? timeline.slice(-limit) : timeline;

    return {
      ok: true,
      message: this.#formatTimeline(limited, compactSummaries),
      data: { timeline: limited, totalEvents: timeline.length, compactSummaries }
    };
  }

  // ─── Formatters ───

  #formatStatus(view: FlowStatusView): string {
    const lines = [
      `Flow: ${view.flowId}`,
      `Status: ${view.status}`,
      view.currentStepName ? `Current step: ${view.currentStepName}` : undefined,
      `Progress: ${view.completedSteps}/${view.stepCount}`,
      view.pendingApprovals > 0 ? `Pending approvals: ${view.pendingApprovals}` : undefined,
      `Elapsed: ${this.#formatDuration(view.elapsedMs ?? 0)}`,
      `Actions: ${[
        view.canPause ? "pause" : null,
        view.canResume ? "resume" : null,
        view.canInterrupt ? "interrupt" : null,
        view.canCancel ? "cancel" : null
      ].filter(Boolean).join(", ") || "none"}`
    ].filter((l): l is string => l !== undefined);

    return lines.join("\n");
  }

  #formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  #formatTimeline(timeline: TimelineEntry[], compactSummaries?: CompactSummary[]): string {
    if (timeline.length === 0 && (!compactSummaries || compactSummaries.length === 0)) return "No events recorded.";
    const lines = timeline
      .map((entry) => {
        const prefix = entry.kind === "operator" ? "[OP]" : "[FL]";
        const e = entry.event;
        const label = "kind" in e ? e.kind : "event";
        let detail = "";
        if (e.kind === "compacted" && e.data && typeof e.data.compactSummaryId === "string") {
          detail = ` (summary: ${e.data.compactSummaryId})`;
        }
        return `${prefix} ${entry.timestamp} ${label}${detail}`;
      });
    if (compactSummaries && compactSummaries.length > 0) {
      lines.push("");
      lines.push("--- Compact Summaries ---");
      for (const cs of compactSummaries) {
        lines.push(`Summary ${cs.id}: ${cs.turnSummaries.length} turns, ${cs.toolOutcomeSummaries.length} tools, ${cs.operatorActionSummaries.length} ops`);
      }
    }
    return lines.join("\n");
  }

  // ─── /compact ───

  async #handleCompact(flowId: FlowId, operator: string): Promise<CommandResult> {
    try {
      const result = await this.#compactionService.compact(flowId, operator);
      if (!result.ok) {
        return { ok: false, error: result.error ?? "Compaction failed" };
      }
      return {
        ok: true,
        message: `Compaction completed (${result.mode}). Preserved ${result.preservedSteps} steps, ${result.preservedProcesses} processes, ${result.preservedApprovals} approvals.`,
        data: {
          compactSummaryId: result.summary?.id,
          mode: result.mode,
          trigger: result.trigger,
          beforeEventCount: result.beforeEventCount,
          preservedSteps: result.preservedSteps,
          preservedProcesses: result.preservedProcesses,
          preservedApprovals: result.preservedApprovals
        }
      };
    } catch (err) {
      return { ok: false, error: `Compaction error: ${(err as Error).message}` };
    }
  }
}
