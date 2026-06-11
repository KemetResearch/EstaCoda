import type { ChannelKind } from "../contracts/channel.js";
import type { DelegateRole, DelegationConfig } from "../contracts/delegation.js";
import type { SessionDB, SessionEvent } from "../contracts/session.js";
import type { ToolDefinition, ToolsetName } from "../contracts/tool.js";
import type { ProviderUsage } from "../contracts/provider.js";
import { DEFAULT_DELEGATION_CONFIG } from "../config/delegation-defaults.js";
import type { ToolExecutionRecord } from "../tools/tool-executor.js";
import type { TrajectoryRecorder } from "../trajectory/trajectory-recorder.js";
import type { AgentLoopResponse } from "../runtime/agent-loop.js";
import type { ChildAgentLoopFactory, ChildAgentLoopRuntime } from "../runtime/agent-loop-factory.js";
import type { ChildToolDiagnostic } from "./toolset-security.js";

export type DelegationRequest = {
  parentSessionId: string;
  profileId: string;
  task: string;
  context?: string;
  allowedToolsets?: ToolsetName[];
  allowedTools?: string[];
  role?: DelegateRole;
  channel?: ChannelKind;
  trustedWorkspace: boolean;
  signal?: AbortSignal;
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
  reason?: "cancelled" | "blocked" | "provider-error" | "runtime-error" | "construction-error" | "spawn-depth-exceeded";
  task: string;
  summary: string;
  role: DelegateRole;
  depth: number;
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
};

export type DelegationManagerOptions = {
  sessionDb: SessionDB;
  childFactory: ChildAgentLoopFactory;
  trajectoryRecorder: TrajectoryRecorder;
  delegationConfig?: DelegationConfig;
  currentDepth?: number;
  parentVisibleTools?: () => readonly ToolDefinition[];
};

export class DelegationManager {
  readonly #sessionDb: SessionDB;
  readonly #childFactory: ChildAgentLoopFactory;
  readonly #trajectoryRecorder: TrajectoryRecorder;
  readonly #delegationConfig: DelegationConfig;
  readonly #currentDepth: number;
  readonly #parentVisibleTools: () => readonly ToolDefinition[];

  constructor(options: DelegationManagerOptions) {
    this.#sessionDb = options.sessionDb;
    this.#childFactory = options.childFactory;
    this.#trajectoryRecorder = options.trajectoryRecorder;
    this.#delegationConfig = options.delegationConfig ?? DEFAULT_DELEGATION_CONFIG;
    this.#currentDepth = options.currentDepth ?? 0;
    this.#parentVisibleTools = options.parentVisibleTools ?? (() => []);
  }

  async delegate(request: DelegationRequest): Promise<DelegationSummary> {
    const allowedToolsets = request.allowedToolsets ?? [];
    const allowedTools = request.allowedTools ?? [];
    const role = request.role ?? "leaf";
    const depth = this.#currentDepth + 1;

    if (request.signal?.aborted === true) {
      return await this.#cancelledBeforeStart(request, allowedToolsets, allowedTools, role, depth);
    }

    if (depth > this.#delegationConfig.maxSpawnDepth) {
      return await this.#spawnDepthExceeded(request, allowedToolsets, allowedTools, role, depth);
    }

    const startedAt = Date.now();
    let childSessionId: string | undefined;
    let child: ChildAgentLoopRuntime | undefined;
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

      await this.#recordStarted({
        parentSessionId: request.parentSessionId,
        childSessionId,
        task: request.task,
        allowedToolsets,
        allowedTools,
        role,
        depth
      });

      const childResponse = await child.handle({
        text: delegatedPrompt(request.task, request.context),
        channel: request.channel ?? "cli",
        trustedWorkspace: request.trustedWorkspace,
        signal: request.signal,
        inputMetadata: {
          delegated: true,
          parentSessionId: request.parentSessionId
        }
      });
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
      await this.#recordFinished({
        parentSessionId: request.parentSessionId,
        childSessionId: child.childSessionId,
        status: result.status,
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
      if (childSessionId !== undefined) {
        await this.#recordFinished({
          parentSessionId: request.parentSessionId,
          childSessionId,
          status: "failed",
          summary,
          durationMs: Date.now() - startedAt,
          error: summary
        });
      }
      return result;
    } finally {
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
  }): Promise<void> {
    await this.#sessionDb.appendEvent(input.parentSessionId, {
      kind: "delegation-started",
      childSessionId: input.childSessionId,
      task: input.task,
      allowedToolsets: input.allowedToolsets,
      allowedTools: input.allowedTools,
      role: input.role,
      depth: input.depth
    });
    this.#trajectoryRecorder.record("delegation-started", input);
  }

  async #recordFinished(input: {
    parentSessionId: string;
    childSessionId: string;
    status: DelegationSummary["status"];
    summary: string;
    durationMs: number;
    error?: string;
  }): Promise<void> {
    await this.#sessionDb.appendEvent(input.parentSessionId, {
      kind: "delegation-finished",
      childSessionId: input.childSessionId,
      summary: input.summary,
      status: input.status,
      durationMs: input.durationMs,
      error: input.error
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
