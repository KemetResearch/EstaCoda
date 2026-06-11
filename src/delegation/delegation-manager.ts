import type { ChannelKind } from "../contracts/channel.js";
import type { DelegateRole, DelegationConfig } from "../contracts/delegation.js";
import type { RuntimeEventSink } from "../contracts/runtime-event.js";
import type { SessionDB, SessionEvent } from "../contracts/session.js";
import type { ToolDefinition, ToolsetName } from "../contracts/tool.js";
import type { ProviderUsage } from "../contracts/provider.js";
import { DEFAULT_DELEGATION_CONFIG } from "../config/delegation-defaults.js";
import type { ToolExecutionRecord } from "../tools/tool-executor.js";
import type { TrajectoryRecorder } from "../trajectory/trajectory-recorder.js";
import type { AgentLoopResponse } from "../runtime/agent-loop.js";
import type { ChildAgentLoopFactory, ChildAgentLoopRuntime } from "../runtime/agent-loop-factory.js";
import type { ChildToolDiagnostic } from "./toolset-security.js";
import { SubagentRegistry } from "./subagent-registry.js";
import {
  appendDiagnosticEvent,
  runDelegatedChild,
  timeoutDelegationSummary
} from "./child-runner.js";

export type DelegationRequest = {
  parentSessionId: string;
  profileId: string;
  task: string;
  context?: string;
  allowedToolsets?: ToolsetName[];
  allowedTools?: string[];
  role?: DelegateRole;
  batchId?: string;
  taskIndex?: number;
  channel?: ChannelKind;
  trustedWorkspace: boolean;
  signal?: AbortSignal;
  onEvent?: RuntimeEventSink;
};

export type DelegationUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
};

export type DelegationSummary = {
  childSessionId: string;
  status: "completed" | "blocked" | "failed";
  reason?: "cancelled" | "blocked" | "provider-error" | "runtime-error" | "construction-error" | "spawn-depth-exceeded" | "spawn-paused" | "timeout";
  task: string;
  summary: string;
  role: DelegateRole;
  depth: number;
  batchId?: string;
  taskIndex?: number;
  toolExecutions: Array<{
    tool: string;
    decision: string;
    ok?: boolean;
  }>;
  allowedToolsets: ToolsetName[];
  allowedTools: string[];
  effectiveAllowedToolsets: ToolsetName[];
  effectiveAllowedTools: string[];
  strippedTools: ChildToolDiagnostic[];
  blockedTools: ChildToolDiagnostic[];
  rejectedRequestedTools: ChildToolDiagnostic[];
  rejectedRequestedToolsets: Array<{
    name: ToolsetName;
    reasons: ChildToolDiagnostic["reasons"];
  }>;
  usage?: DelegationUsageMetadata;
  diagnosticPath?: string;
};

export type DelegationManagerOptions = {
  sessionDb: SessionDB;
  childFactory: ChildAgentLoopFactory;
  trajectoryRecorder: TrajectoryRecorder;
  delegationConfig?: DelegationConfig;
  currentDepth?: number;
  parentVisibleTools?: () => readonly ToolDefinition[];
  subagentRegistry?: SubagentRegistry;
  diagnosticsRoot?: string;
};

export class DelegationManager {
  readonly #sessionDb: SessionDB;
  readonly #childFactory: ChildAgentLoopFactory;
  readonly #trajectoryRecorder: TrajectoryRecorder;
  readonly #delegationConfig: DelegationConfig;
  readonly #currentDepth: number;
  readonly #parentVisibleTools: () => readonly ToolDefinition[];
  readonly #subagentRegistry: SubagentRegistry;
  readonly #diagnosticsRoot: string | undefined;

  constructor(options: DelegationManagerOptions) {
    this.#sessionDb = options.sessionDb;
    this.#childFactory = options.childFactory;
    this.#trajectoryRecorder = options.trajectoryRecorder;
    this.#delegationConfig = options.delegationConfig ?? DEFAULT_DELEGATION_CONFIG;
    this.#currentDepth = options.currentDepth ?? 0;
    this.#parentVisibleTools = options.parentVisibleTools ?? (() => []);
    this.#subagentRegistry = options.subagentRegistry ?? new SubagentRegistry();
    this.#diagnosticsRoot = options.diagnosticsRoot;
  }

  async delegate(request: DelegationRequest): Promise<DelegationSummary> {
    const allowedToolsets = request.allowedToolsets ?? [];
    const allowedTools = request.allowedTools ?? [];
    const role = request.role ?? "leaf";
    const depth = this.#currentDepth + 1;

    if (isSignalAborted(request.signal)) {
      return await this.#cancelledBeforeStart(request, allowedToolsets, allowedTools, role, depth);
    }

    if (this.#subagentRegistry.isSpawnPaused()) {
      return this.#spawnPaused(request, allowedToolsets, allowedTools, role, depth);
    }

    if (depth > this.#delegationConfig.maxSpawnDepth) {
      return await this.#spawnDepthExceeded(request, allowedToolsets, allowedTools, role, depth);
    }

    const startedAt = Date.now();
    let childSessionId: string | undefined;
    let subagentId: string | undefined;
    let child: ChildAgentLoopRuntime | undefined;
    let parentAbortCleanup: (() => void) | undefined;
    let childAbortController: AbortController | undefined;
    try {
      child = await this.#childFactory.createChild({
        parentSessionId: request.parentSessionId,
        profileId: request.profileId,
        task: request.task,
        context: request.context,
        allowedToolsets,
        allowedTools,
        role,
        depth,
        channel: request.channel,
        trustedWorkspace: request.trustedWorkspace,
        parentVisibleTools: this.#parentVisibleTools()
      });
      childSessionId = child.childSessionId;

      if (isSignalAborted(request.signal)) {
        return this.#cancelledAfterConstruction(request, allowedToolsets, allowedTools, role, depth, childSessionId);
      }

      childAbortController = new AbortController();
      subagentId = child.childSessionId;
      parentAbortCleanup = linkParentAbort(request.signal, childAbortController, () =>
        this.#subagentRegistry.interruptChildrenForParent(request.parentSessionId, "parent-aborted")
      );
      this.#subagentRegistry.registerSubagent({
        subagentId,
        childSessionId: child.childSessionId,
        parentSessionId: request.parentSessionId,
        batchId: request.batchId,
        taskIndex: request.taskIndex,
        depth,
        role,
        goal: request.task,
        model: childModel(child),
        provider: childProvider(child),
        toolCount: child.toolAccess.effectiveAllowedTools.length,
        abortController: childAbortController
      });

      await this.#recordStarted({
        parentSessionId: request.parentSessionId,
        childSessionId,
        task: request.task,
        allowedToolsets,
        allowedTools,
        role,
        depth,
        batchId: request.batchId,
        taskIndex: request.taskIndex
      });

      this.#subagentRegistry.updateSubagent(subagentId, {
        status: "running",
        lastActivityAt: new Date().toISOString()
      });
      const runnerResult = await runDelegatedChild({
        child,
        childAbortController,
        parentSignal: request.signal,
        subagentRegistry: this.#subagentRegistry,
        subagentId,
        sessionDb: this.#sessionDb,
        delegationConfig: this.#delegationConfig,
        diagnosticsRoot: this.#diagnosticsRoot,
        parentSessionId: request.parentSessionId,
        childSessionId: child.childSessionId,
        role,
        depth,
        task: request.task,
        context: request.context,
        channel: request.channel,
        trustedWorkspace: request.trustedWorkspace,
        provider: childProvider(child),
        model: childModel(child),
        effectiveAllowedTools: child.toolAccess.effectiveAllowedTools,
        taskIndex: request.taskIndex,
        batchId: request.batchId,
        parentOnEvent: request.onEvent
      });
      if (runnerResult.kind === "timeout") {
        await appendDiagnosticEvent({
          sessionDb: this.#sessionDb,
          parentSessionId: request.parentSessionId,
          childSessionId: child.childSessionId,
          role,
          depth,
          taskIndex: request.taskIndex,
          batchId: request.batchId
        }, "timeout", runnerResult.diagnostic ?? {
          taskHash: "",
          taskPreview: ""
        });
        const result = timeoutDelegationSummary({
          childSessionId: child.childSessionId,
          task: request.task,
          summary: runnerResult.summary,
          role,
          depth,
          batchId: request.batchId,
          taskIndex: request.taskIndex,
          allowedToolsets,
          allowedTools,
          child,
          diagnostic: runnerResult.diagnostic
        });
        await this.#recordFinished({
          parentSessionId: request.parentSessionId,
          childSessionId: child.childSessionId,
          status: result.status,
          reason: result.reason,
          summary: result.summary,
          durationMs: Date.now() - startedAt,
          error: result.summary,
          diagnosticPath: result.diagnosticPath
        });
        return result;
      }
      if (runnerResult.kind === "cancelled") {
        const result: DelegationSummary = {
          childSessionId: child.childSessionId,
          status: "failed",
          reason: "cancelled",
          task: request.task,
          summary: runnerResult.summary,
          role,
          depth,
          batchId: request.batchId,
          taskIndex: request.taskIndex,
          allowedToolsets,
          allowedTools,
          effectiveAllowedToolsets: child.toolAccess.effectiveAllowedToolsets,
          effectiveAllowedTools: child.toolAccess.effectiveAllowedTools,
          strippedTools: child.toolAccess.strippedTools,
          blockedTools: child.toolAccess.blockedTools,
          rejectedRequestedTools: child.toolAccess.rejectedRequestedTools,
          rejectedRequestedToolsets: child.toolAccess.rejectedRequestedToolsets,
          toolExecutions: []
        };
        await this.#recordFinished({
          parentSessionId: request.parentSessionId,
          childSessionId: child.childSessionId,
          status: result.status,
          reason: result.reason,
          summary: result.summary,
          durationMs: Date.now() - startedAt,
          error: result.summary
        });
        return result;
      }
      const childResponse = runnerResult.response;
      const summary = childResponse.text;
      const status = await this.#statusFromChildResponse(child.childSessionId, childResponse, request.signal);
      const result: DelegationSummary = {
        childSessionId: child.childSessionId,
        status: status.status,
        reason: status.reason,
        task: request.task,
        summary,
        role,
        depth,
        batchId: request.batchId,
        taskIndex: request.taskIndex,
        allowedToolsets,
        allowedTools,
        effectiveAllowedToolsets: child.toolAccess.effectiveAllowedToolsets,
        effectiveAllowedTools: child.toolAccess.effectiveAllowedTools,
        strippedTools: child.toolAccess.strippedTools,
        blockedTools: child.toolAccess.blockedTools,
        rejectedRequestedTools: child.toolAccess.rejectedRequestedTools,
        rejectedRequestedToolsets: child.toolAccess.rejectedRequestedToolsets,
        usage: usageFromProviderResponse(childResponse.providerExecution?.response?.usage),
        toolExecutions: childResponse.toolExecutions.map((execution) => ({
          tool: execution.tool.name,
          decision: execution.decision,
          ok: execution.result?.ok
        }))
      };
      this.#subagentRegistry.updateSubagent(subagentId, {
        status: result.status === "completed" ? "completed" : "failed",
        lastActivityAt: new Date().toISOString()
      });
      await this.#recordFinished({
        parentSessionId: request.parentSessionId,
        childSessionId: child.childSessionId,
        status: result.status,
        reason: result.reason,
        summary: result.summary,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      const summary = error instanceof Error ? error.message : "Unknown child delegation error.";
      const result: DelegationSummary = {
        childSessionId: childSessionId ?? "unavailable",
        status: "failed",
        reason: childSessionId === undefined ? "construction-error" : "runtime-error",
        task: request.task,
        summary,
        role,
        depth,
        batchId: request.batchId,
        taskIndex: request.taskIndex,
        allowedToolsets,
        allowedTools,
        effectiveAllowedToolsets: [],
        effectiveAllowedTools: [],
        strippedTools: [],
        blockedTools: [],
        rejectedRequestedTools: [],
        rejectedRequestedToolsets: [],
        toolExecutions: []
      };
      if (subagentId !== undefined) {
        this.#subagentRegistry.updateSubagent(subagentId, {
          status: isSignalAborted(request.signal) ? "cancelling" : "failed",
          lastActivityAt: new Date().toISOString()
        });
      }
      if (childSessionId !== undefined) {
        await this.#recordFinished({
          parentSessionId: request.parentSessionId,
          childSessionId,
          status: "failed",
          reason: result.reason,
          summary,
          durationMs: Date.now() - startedAt,
          error: summary
        });
      }
      return result;
    } finally {
      parentAbortCleanup?.();
      if (subagentId !== undefined) {
        this.#subagentRegistry.unregisterSubagent(subagentId);
      }
      await child?.cleanup().catch(() => undefined);
    }
  }

  async #cancelledBeforeStart(
    request: DelegationRequest,
    allowedToolsets: ToolsetName[],
    allowedTools: string[],
    role: DelegateRole,
    depth: number
  ): Promise<DelegationSummary> {
    const summary = "Delegation cancelled before child start.";
    this.#trajectoryRecorder.record("delegation-finished", {
      parentSessionId: request.parentSessionId,
      childSessionId: "unavailable",
      status: "failed",
      reason: "cancelled",
      summary
    });
    return {
      childSessionId: "unavailable",
      status: "failed",
      reason: "cancelled",
      task: request.task,
      summary,
      role,
      depth,
      batchId: request.batchId,
      taskIndex: request.taskIndex,
      allowedToolsets,
      allowedTools,
      effectiveAllowedToolsets: [],
      effectiveAllowedTools: [],
      strippedTools: [],
      blockedTools: [],
      rejectedRequestedTools: [],
      rejectedRequestedToolsets: [],
      toolExecutions: []
    };
  }

  #cancelledAfterConstruction(
    request: DelegationRequest,
    allowedToolsets: ToolsetName[],
    allowedTools: string[],
    role: DelegateRole,
    depth: number,
    childSessionId: string
  ): DelegationSummary {
    const summary = "Delegation cancelled before child start.";
    return {
      childSessionId,
      status: "failed",
      reason: "cancelled",
      task: request.task,
      summary,
      role,
      depth,
      batchId: request.batchId,
      taskIndex: request.taskIndex,
      allowedToolsets,
      allowedTools,
      effectiveAllowedToolsets: [],
      effectiveAllowedTools: [],
      strippedTools: [],
      blockedTools: [],
      rejectedRequestedTools: [],
      rejectedRequestedToolsets: [],
      toolExecutions: []
    };
  }

  #spawnPaused(
    request: DelegationRequest,
    allowedToolsets: ToolsetName[],
    allowedTools: string[],
    role: DelegateRole,
    depth: number
  ): DelegationSummary {
    const reason = this.#subagentRegistry.spawnPausedReason();
    const summary = reason === undefined || reason.length === 0
      ? "Delegation spawn is paused."
      : `Delegation spawn is paused: ${reason}`;
    return {
      childSessionId: "unavailable",
      status: "failed",
      reason: "spawn-paused",
      task: request.task,
      summary,
      role,
      depth,
      batchId: request.batchId,
      taskIndex: request.taskIndex,
      allowedToolsets,
      allowedTools,
      effectiveAllowedToolsets: [],
      effectiveAllowedTools: [],
      strippedTools: [],
      blockedTools: [],
      rejectedRequestedTools: [],
      rejectedRequestedToolsets: [],
      toolExecutions: []
    };
  }

  async #spawnDepthExceeded(
    request: DelegationRequest,
    allowedToolsets: ToolsetName[],
    allowedTools: string[],
    role: DelegateRole,
    depth: number
  ): Promise<DelegationSummary> {
    const summary = `Delegation spawn depth ${depth} exceeds maxSpawnDepth ${this.#delegationConfig.maxSpawnDepth}.`;
    this.#trajectoryRecorder.record("delegation-finished", {
      parentSessionId: request.parentSessionId,
      childSessionId: "unavailable",
      status: "failed",
      reason: "spawn-depth-exceeded",
      role,
      depth,
      summary
    });
    return {
      childSessionId: "unavailable",
      status: "failed",
      reason: "spawn-depth-exceeded",
      task: request.task,
      summary,
      role,
      depth,
      batchId: request.batchId,
      taskIndex: request.taskIndex,
      allowedToolsets,
      allowedTools,
      effectiveAllowedToolsets: [],
      effectiveAllowedTools: [],
      strippedTools: [],
      blockedTools: [],
      rejectedRequestedTools: [],
      rejectedRequestedToolsets: [],
      toolExecutions: []
    };
  }

  async #recordStarted(input: {
    parentSessionId: string;
    childSessionId: string;
    task: string;
    allowedToolsets: ToolsetName[];
    allowedTools: string[];
    role: DelegateRole;
    depth: number;
    batchId?: string;
    taskIndex?: number;
  }): Promise<void> {
    await this.#sessionDb.appendEvent(input.parentSessionId, {
      kind: "delegation-started",
      childSessionId: input.childSessionId,
      task: input.task,
      allowedToolsets: input.allowedToolsets,
      allowedTools: input.allowedTools,
      role: input.role,
      depth: input.depth,
      batchId: input.batchId,
      taskIndex: input.taskIndex
    });
    this.#trajectoryRecorder.record("delegation-started", input);
  }

  async #recordFinished(input: {
    parentSessionId: string;
    childSessionId: string;
    status: DelegationSummary["status"];
    reason?: DelegationSummary["reason"];
    summary: string;
    durationMs: number;
    error?: string;
    diagnosticPath?: string;
  }): Promise<void> {
    await this.#sessionDb.appendEvent(input.parentSessionId, {
      kind: "delegation-finished",
      childSessionId: input.childSessionId,
      summary: input.summary,
      status: input.status,
      reason: input.reason,
      durationMs: input.durationMs,
      error: input.error,
      diagnosticPath: input.diagnosticPath
    });
    this.#trajectoryRecorder.record("delegation-finished", input);
  }

  async #statusFromChildResponse(
    childSessionId: string,
    response: AgentLoopResponse,
    signal: AbortSignal | undefined
  ): Promise<{ status: DelegationSummary["status"]; reason?: DelegationSummary["reason"] }> {
    if (signal?.aborted === true) {
      return { status: "failed", reason: "cancelled" };
    }
    const events = await this.#sessionDb.listEvents(childSessionId);
    if (hasStructuredBlock(response.toolExecutions, events)) {
      return { status: "blocked", reason: "blocked" };
    }
    if (response.providerExecution?.ok === false) {
      return { status: "failed", reason: "provider-error" };
    }
    return { status: "completed" };
  }
}

export function delegatedPrompt(task: string, context: string | undefined): string {
  if (context === undefined || context.trim().length === 0) {
    return task;
  }
  return [
    `Delegated task: ${task}`,
    "",
    `Context: ${context}`
  ].join("\n");
}

function hasStructuredBlock(toolExecutions: ToolExecutionRecord[], events: SessionEvent[]): boolean {
  if (toolExecutions.some((execution) => execution.decision !== "allow")) {
    return true;
  }
  return events.some((event) =>
    event.kind === "tool-gated" && event.decision !== "allow" ||
    event.kind === "security-assessed" && event.assessment.decision !== "allow"
  );
}

function usageFromProviderResponse(usage: ProviderUsage | undefined): DelegationUsageMetadata | undefined {
  if (usage === undefined) {
    return undefined;
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens
  };
}

function childModel(child: ChildAgentLoopRuntime): string {
  const routes = child.builtSession.providerRoutes as Partial<ChildAgentLoopRuntime["builtSession"]["providerRoutes"]> | undefined;
  return routes?.primaryModelRoute?.id ??
    routes?.mainRoute?.id ??
    routes?.model?.id ??
    "unknown";
}

function childProvider(child: ChildAgentLoopRuntime): string {
  const routes = child.builtSession.providerRoutes as Partial<ChildAgentLoopRuntime["builtSession"]["providerRoutes"]> | undefined;
  return routes?.primaryModelRoute?.provider ??
    routes?.mainRoute?.provider ??
    routes?.model?.provider ??
    "unknown";
}

function linkParentAbort(
  parentSignal: AbortSignal | undefined,
  childAbortController: AbortController,
  onAbort: () => void
): (() => void) | undefined {
  if (parentSignal === undefined) {
    return undefined;
  }
  const abortChild = () => {
    onAbort();
    if (!childAbortController.signal.aborted) {
      childAbortController.abort(parentSignal.reason ?? "parent-aborted");
    }
  };
  if (parentSignal.aborted) {
    abortChild();
    return undefined;
  }
  parentSignal.addEventListener("abort", abortChild, { once: true });
  return () => parentSignal.removeEventListener("abort", abortChild);
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
