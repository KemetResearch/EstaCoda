// WorkflowRun-safe event summary service for v0.8
// Manual summary and configurable automatic summaries.
// Only operates at safe boundaries. Never compacts durable flow truth.

import type {
  WorkflowRunId,
  WorkflowEventSummary,
  WorkflowEvent,
  WorkflowOperatorEvent,
  WorkflowStep
} from "./types.js";
import type { WorkflowStore } from "./workflow-store.js";

export type WorkflowEventSummaryConfig = {
  enabled: boolean;
  mode: "conservative";
  eventThreshold: number;
  minTurnsBeforeCompact: number;
};

export type WorkflowEventSummaryMode = "manual" | "automatic";

export type WorkflowEventSummaryResult = {
  ok: boolean;
  summary?: WorkflowEventSummary;
  error?: string;
  beforeEventCount: number;
  afterEventCount: number;
  preservedSteps: number;
  preservedProcesses: number;
  preservedApprovals: number;
  mode: WorkflowEventSummaryMode;
  trigger: string;
};

export const DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG: WorkflowEventSummaryConfig = {
  enabled: false,
  mode: "conservative",
  eventThreshold: 50,
  minTurnsBeforeCompact: 3
};

export class WorkflowEventSummaryService {
  readonly #store: WorkflowStore;
  readonly #config: WorkflowEventSummaryConfig;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: {
    store: WorkflowStore;
    config?: WorkflowEventSummaryConfig;
    now?: () => Date;
    id?: () => string;
  }) {
    this.#store = options.store;
    this.#config = options.config ?? DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? (() => crypto.randomUUID());
  }

  // ─── Safe boundary detection ───

  async canCompact(flowId: WorkflowRunId): Promise<{
    ok: boolean;
    reason?: string;
    activeSteps: WorkflowStep[];
    activeProcesses: number;
    pendingApprovals: number;
  }> {
    const flow = await this.#store.getWorkflowRun(flowId);
    if (!flow) {
      return { ok: false, reason: "Workflow run not found", activeSteps: [], activeProcesses: 0, pendingApprovals: 0 };
    }

    const steps = await this.#store.listWorkflowSteps(flowId);
    const activeSteps = steps.filter((s) => s.status === "running");
    const processes = await this.#store.listWorkflowProcesses(flowId);
    const activeProcesses = processes.filter((p) => p.status === "running").length;
    const approvals = await this.#store.listWorkflowApprovalGates(flowId, { status: "pending" });
    const pendingApprovals = approvals.length;

    if (activeProcesses > 0) {
      return { ok: false, reason: "Active process handles exist", activeSteps, activeProcesses, pendingApprovals };
    }
    if (activeSteps.length > 0) {
      return { ok: false, reason: "Active step execution in progress", activeSteps, activeProcesses, pendingApprovals };
    }
    if (pendingApprovals > 0) {
      return { ok: false, reason: "Pending approval mutations in progress", activeSteps, activeProcesses, pendingApprovals };
    }

    return { ok: true, activeSteps, activeProcesses, pendingApprovals };
  }

  // ─── Preview / dry-run ───

  async preview(flowId: WorkflowRunId): Promise<WorkflowEventSummaryResult> {
    return this.#doCompact(flowId, "manual", "preview", /* persist */ false);
  }

  // ─── Manual compaction ───

  async compact(flowId: WorkflowRunId, operator?: string): Promise<WorkflowEventSummaryResult> {
    const boundary = await this.canCompact(flowId);
    if (!boundary.ok) {
      return {
        ok: false,
        error: `Workflow summary rejected: ${boundary.reason}`,
        beforeEventCount: 0,
        afterEventCount: 0,
        preservedSteps: boundary.activeSteps.length,
        preservedProcesses: boundary.activeProcesses,
        preservedApprovals: boundary.pendingApprovals,
        mode: "manual",
        trigger: `summarize by ${operator ?? "unknown"}`
      };
    }
    return this.#doCompact(flowId, "manual", `summarize by ${operator ?? "unknown"}`, /* persist */ true);
  }

  // ─── Automatic compaction ───

  async checkAndAutoCompact(flowId: WorkflowRunId): Promise<WorkflowEventSummaryResult | null> {
    if (!this.#config.enabled) {
      return null;
    }

    const boundary = await this.canCompact(flowId);
    if (!boundary.ok) {
      return null;
    }

    const events = await this.#store.listWorkflowEvents(flowId);
    if (events.length < this.#config.eventThreshold) {
      return null;
    }

    const completedSteps = (await this.#store.listWorkflowSteps(flowId)).filter(
      (s) => s.status === "completed" || s.status === "skipped" || s.status === "failed" || s.status === "cancelled"
    );
    if (completedSteps.length < this.#config.minTurnsBeforeCompact) {
      return null;
    }

    return this.#doCompact(flowId, "automatic", `threshold exceeded (${events.length} events)`, /* persist */ true);
  }

  // ─── Core compaction logic ───

  async #doCompact(
    flowId: WorkflowRunId,
    mode: WorkflowEventSummaryMode,
    trigger: string,
    persist: boolean
  ): Promise<WorkflowEventSummaryResult> {
    const flow = await this.#store.getWorkflowRun(flowId);
    if (!flow) {
      return {
        ok: false,
        error: "Workflow run not found",
        beforeEventCount: 0,
        afterEventCount: 0,
        preservedSteps: 0,
        preservedProcesses: 0,
        preservedApprovals: 0,
        mode,
        trigger
      };
    }

    const allEvents = await this.#store.listWorkflowEvents(flowId);
    const allOperatorEvents = await this.#store.listWorkflowOperatorEvents(flowId);

    // Durable events are never deleted; we summarize them.
    // For v0.8, deterministic summarization from existing flow events.
    const turnSummaries = this.#summarizeTurns(allEvents);
    const toolOutcomeSummaries = this.#summarizeToolOutcomes(allEvents);
    const operatorActionSummaries = this.#summarizeOperatorActions(allOperatorEvents);

    const summary: WorkflowEventSummary = {
      id: this.#id(),
      flowId,
      compactedRange: {
        fromEventId: allEvents.length > 0 ? allEvents[allEvents.length - 1].id : this.#id(),
        toEventId: allEvents.length > 0 ? allEvents[0].id : this.#id()
      },
      turnSummaries,
      toolOutcomeSummaries,
      operatorActionSummaries,
      createdAt: this.#now().toISOString()
    };

    const steps = await this.#store.listWorkflowSteps(flowId);
    const processes = await this.#store.listWorkflowProcesses(flowId);
    const approvals = await this.#store.listWorkflowApprovalGates(flowId);

    const result: WorkflowEventSummaryResult = {
      ok: true,
      summary,
      beforeEventCount: allEvents.length,
      afterEventCount: allEvents.length, // events preserved; summary is additive
      preservedSteps: steps.length,
      preservedProcesses: processes.length,
      preservedApprovals: approvals.length,
      mode,
      trigger
    };

    if (!persist) {
      return result;
    }

    // Persist via atomic transition
    await this.#store.atomicTransition(flowId, async (tx) => {
      await tx.saveWorkflowEventSummary(summary);

      // Record compaction flow event
      await tx.appendWorkflowEvent({
        id: this.#id(),
        flowId,
        kind: "compacted",
        data: {
          compactSummaryId: summary.id,
          mode,
          trigger,
          beforeEventCount: result.beforeEventCount,
          preservedSteps: result.preservedSteps,
          preservedProcesses: result.preservedProcesses,
          preservedApprovals: result.preservedApprovals
        },
        timestamp: this.#now().toISOString()
      });

      // Record operator-compacted event
      await tx.appendWorkflowOperatorEvent({
        id: this.#id(),
        flowId,
        kind: "operator-compacted",
        operator: mode === "manual" ? (trigger.replace("summarize by ", "")) : "system",
        command: "/compact",
        effect: "compacted",
        previousState: flow.status,
        newState: flow.status,
        metadata: {
          compactSummaryId: summary.id,
          mode,
          trigger,
          preservedSteps: result.preservedSteps,
          preservedProcesses: result.preservedProcesses,
          preservedApprovals: result.preservedApprovals
        },
        timestamp: this.#now().toISOString()
      });

      // Update flow compactedAt
      const updatedFlow = { ...flow, compactedAt: this.#now().toISOString() };
      await tx.updateWorkflowRun(updatedFlow);
    });

    return result;
  }

  // ─── Deterministic summarizers (v0.8) ───

  #summarizeTurns(events: WorkflowEvent[]): string[] {
    const summaries: string[] = [];
    const started = new Map<string, WorkflowEvent>();

    // Process in chronological order (ascending timestamp)
    const chronological = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    for (const ev of chronological) {
      if (ev.kind === "step-started") {
        started.set(ev.stepId ?? ev.id, ev);
      } else if (ev.kind === "step-completed" && ev.stepId && started.has(ev.stepId)) {
        const s = started.get(ev.stepId)!;
        const stepName = (s.data.stepName as string) ?? ev.stepId;
        summaries.push(`Step "${stepName}" completed.`);
        started.delete(ev.stepId);
      } else if (ev.kind === "step-failed" && ev.stepId && started.has(ev.stepId)) {
        const s = started.get(ev.stepId)!;
        const stepName = (s.data.stepName as string) ?? ev.stepId;
        summaries.push(`Step "${stepName}" failed.`);
        started.delete(ev.stepId);
      } else if (ev.kind === "step-skipped" && ev.stepId) {
        summaries.push(`Step "${(ev.data.stepName as string) ?? ev.stepId}" skipped.`);
        started.delete(ev.stepId);
      }
    }

    return summaries;
  }

  #summarizeToolOutcomes(events: WorkflowEvent[]): string[] {
    const summaries: string[] = [];
    const registered = new Map<string, WorkflowEvent>();

    const chronological = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    for (const ev of chronological) {
      if (ev.kind === "process-registered" && ev.data.processId) {
        registered.set(ev.data.processId as string, ev);
      } else if ((ev.kind === "process-exited" || ev.kind === "process-orphaned") && ev.data.processId) {
        const reg = registered.get(ev.data.processId as string);
        const cmd = (reg?.data.commandSummary as string) ?? (ev.data.processId as string);
        summaries.push(`Tool process "${cmd}" ${ev.kind === "process-exited" ? "exited" : "orphaned"}.`);
        registered.delete(ev.data.processId as string);
      }
    }

    return summaries;
  }

  #summarizeOperatorActions(events: WorkflowOperatorEvent[]): string[] {
    const chronological = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return chronological.map((ev) => {
      return `Operator ${ev.operator} executed ${ev.command} (${ev.effect}).`;
    });
  }
}
