import type {
  ExternalMemoryProvider,
  MemoryPromptContext,
  MemoryRecallDecision,
  MemoryScope,
  PromptMemoryBlock
} from "../contracts/memory.js";
import type { RuntimeEventSink } from "../contracts/runtime-event.js";
import type { ExternalMemoryRuntimeConfig } from "./external-memory-provider.js";
import { collectExternalMemoryRecall } from "./external-memory-provider.js";
import {
  detectSessionRecallIntent,
  sessionRecallResultToPromptBlocks,
  type SessionRecallService
} from "../session/session-recall-service.js";
import type { MemoryPromptContextBuilder } from "./memory-prompt-context-builder.js";

type MemoryPromptContextBuilderLike = Pick<MemoryPromptContextBuilder, "build">;
type SessionRecallServiceLike = Pick<SessionRecallService, "recall">;

type SessionRecallDecisionRecorder = {
  recordSessionRecallDecision(input: {
    triggered: boolean;
    reason: string;
    query?: string;
    sourceSessionIds: string[];
    warningCount: number;
    onEvent?: RuntimeEventSink;
  }): Promise<string[]>;
};

export type MemoryRecallOrchestratorOptions = {
  builder: MemoryPromptContextBuilderLike;
  sessionRecallService?: SessionRecallServiceLike;
  recorder?: SessionRecallDecisionRecorder;
  externalMemory?: ExternalMemoryRuntimeConfig;
  externalMemoryProviders?: ExternalMemoryProvider[];
  profileId?: string;
  sessionId?: string;
  workspaceRoot?: string;
};

export type MemoryRecallOrchestratorResult = {
  context: MemoryPromptContext;
  decisions: MemoryRecallDecision[];
};

const LOCAL_AND_SESSION_SCOPES: MemoryScope[] = ["user-global", "project", "session"];
const LOCAL_SESSION_EXTERNAL_SCOPES: MemoryScope[] = ["user-global", "project", "session", "external"];
const DEFAULT_EXTERNAL_MEMORY_CONFIG: ExternalMemoryRuntimeConfig = {
  enabled: false,
  timeoutMs: 750,
  maxResults: 3,
  maxChars: 2_500,
  mirrorWrites: false
};

export class MemoryRecallOrchestrator {
  readonly #builder: MemoryPromptContextBuilderLike;
  readonly #sessionRecallService: SessionRecallServiceLike | undefined;
  readonly #recorder: SessionRecallDecisionRecorder | undefined;
  readonly #externalMemory: ExternalMemoryRuntimeConfig;
  readonly #externalMemoryProviders: ExternalMemoryProvider[];
  readonly #profileId: string;
  readonly #sessionId: string | undefined;
  readonly #workspaceRoot: string | undefined;

  constructor(options: MemoryRecallOrchestratorOptions) {
    this.#builder = options.builder;
    this.#sessionRecallService = options.sessionRecallService;
    this.#recorder = options.recorder;
    this.#externalMemory = options.externalMemory ?? DEFAULT_EXTERNAL_MEMORY_CONFIG;
    this.#externalMemoryProviders = options.externalMemoryProviders ?? [];
    this.#profileId = options.profileId ?? "default";
    this.#sessionId = options.sessionId;
    this.#workspaceRoot = options.workspaceRoot;
  }

  async prepareForTurn(input: {
    text: string;
    onEvent?: RuntimeEventSink;
  }): Promise<MemoryRecallOrchestratorResult> {
    const intent = detectSessionRecallIntent(input.text);
    const session = await this.#sessionRecall(intent, input.onEvent);
    const external = await this.#externalRecall({
      query: intent.query,
      triggered: intent.triggered
    });
    const warnings = [
      ...session.warnings,
      ...external.warnings
    ];
    const decisions = [
      session.decision,
      external.decision
    ];
    const context = await this.#builder.build({
      recallTriggered: session.triggered,
      sessionRecall: session.blocks,
      externalRecall: external.blocks,
      recallWarnings: warnings,
      recallDecisions: decisions
    });
    return {
      context,
      decisions
    };
  }

  async #sessionRecall(
    intent: ReturnType<typeof detectSessionRecallIntent>,
    onEvent?: RuntimeEventSink
  ): Promise<{
    triggered: boolean;
    blocks: PromptMemoryBlock[];
    warnings: string[];
    decision: MemoryRecallDecision;
  }> {
    if (!intent.triggered || this.#sessionRecallService === undefined) {
      const reason = intent.triggered ? "session recall service unavailable" : intent.reason;
      const warnings = await this.#recordSessionRecallDecision({
        triggered: false,
        reason,
        query: intent.query,
        sourceSessionIds: [],
        warningCount: 0,
        onEvent
      });
      const decision: MemoryRecallDecision = {
        included: false,
        reason,
        query: intent.query,
        scopesConsidered: LOCAL_AND_SESSION_SCOPES,
        sourceSessions: [],
        warnings
      };
      return {
        triggered: false,
        blocks: [],
        warnings,
        decision
      };
    }

    const recall = await this.#sessionRecallService.recall(intent.query);
    const blocks = sessionRecallResultToPromptBlocks(recall);
    const sourceSessionIds = uniqueSourceSessionIds(blocks);
    const eventWarnings = await this.#recordSessionRecallDecision({
      triggered: true,
      reason: intent.reason,
      query: intent.query,
      sourceSessionIds,
      warningCount: recall.diagnostics.warnings.length,
      onEvent
    });
    const warnings = [
      ...recall.diagnostics.warnings,
      ...eventWarnings
    ];
    const decision: MemoryRecallDecision = {
      included: blocks.length > 0,
      reason: blocks.length > 0 ? intent.reason : "explicit recall trigger matched, but no recall blocks were returned",
      query: intent.query,
      scopesConsidered: LOCAL_AND_SESSION_SCOPES,
      sourceSessions: sourceSessionIds,
      warnings
    };
    return {
      triggered: true,
      blocks,
      warnings,
      decision
    };
  }

  async #externalRecall(input: {
    query: string;
    triggered: boolean;
  }): Promise<{
    blocks: PromptMemoryBlock[];
    warnings: string[];
    decision: MemoryRecallDecision;
  }> {
    if (this.#externalMemory.enabled !== true || this.#externalMemoryProviders.length === 0) {
      return {
        blocks: [],
        warnings: [],
        decision: {
          included: false,
          reason: this.#externalMemory.enabled === true ? "external memory provider unavailable" : "external memory disabled",
          query: input.query,
          scopesConsidered: LOCAL_SESSION_EXTERNAL_SCOPES,
          sourceSessions: []
        }
      };
    }

    if (!input.triggered) {
      return {
        blocks: [],
        warnings: [],
        decision: {
          included: false,
          reason: "no explicit recall trigger",
          query: input.query,
          scopesConsidered: LOCAL_SESSION_EXTERNAL_SCOPES,
          sourceSessions: []
        }
      };
    }

    const result = await collectExternalMemoryRecall({
      query: input.query,
      providers: this.#externalMemoryProviders,
      config: this.#externalMemory,
      context: {
        profileId: this.#profileId,
        sessionId: this.#sessionId,
        workspaceRoot: this.#workspaceRoot
      }
    });
    return {
      blocks: result.blocks,
      warnings: result.warnings,
      decision: {
        included: result.blocks.length > 0,
        reason: result.blocks.length > 0
          ? "explicit recall trigger matched external memory"
          : "external memory returned no recall blocks",
        query: input.query,
        scopesConsidered: LOCAL_SESSION_EXTERNAL_SCOPES,
        sourceSessions: result.sourceProviders,
        warnings: result.warnings
      }
    };
  }

  async #recordSessionRecallDecision(input: {
    triggered: boolean;
    reason: string;
    query?: string;
    sourceSessionIds: string[];
    warningCount: number;
    onEvent?: RuntimeEventSink;
  }): Promise<string[]> {
    if (this.#recorder === undefined) {
      return [];
    }
    return await this.#recorder.recordSessionRecallDecision(input);
  }
}

function uniqueSourceSessionIds(blocks: PromptMemoryBlock[]): string[] {
  return [...new Set(blocks.flatMap((block) => block.entryIds ?? []))];
}
