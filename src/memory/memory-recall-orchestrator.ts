import type {
  MemoryPromptContext,
  MemoryRecallDecision,
  MemoryScope,
  PromptMemoryBlock
} from "../contracts/memory.js";
import type { RuntimeEventSink } from "../contracts/runtime-event.js";
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
};

export type MemoryRecallOrchestratorResult = {
  context: MemoryPromptContext;
  decisions: MemoryRecallDecision[];
};

const LOCAL_AND_SESSION_SCOPES: MemoryScope[] = ["user-global", "project", "session"];

export class MemoryRecallOrchestrator {
  readonly #builder: MemoryPromptContextBuilderLike;
  readonly #sessionRecallService: SessionRecallServiceLike | undefined;
  readonly #recorder: SessionRecallDecisionRecorder | undefined;

  constructor(options: MemoryRecallOrchestratorOptions) {
    this.#builder = options.builder;
    this.#sessionRecallService = options.sessionRecallService;
    this.#recorder = options.recorder;
  }

  async prepareForTurn(input: {
    text: string;
    onEvent?: RuntimeEventSink;
  }): Promise<MemoryRecallOrchestratorResult> {
    const intent = detectSessionRecallIntent(input.text);

    if (!intent.triggered || this.#sessionRecallService === undefined) {
      const reason = intent.triggered ? "session recall service unavailable" : intent.reason;
      const warnings = await this.#recordSessionRecallDecision({
        triggered: false,
        reason,
        query: intent.query,
        sourceSessionIds: [],
        warningCount: 0,
        onEvent: input.onEvent
      });
      const decision: MemoryRecallDecision = {
        included: false,
        reason,
        query: intent.query,
        scopesConsidered: LOCAL_AND_SESSION_SCOPES,
        sourceSessions: [],
        warnings
      };
      const context = await this.#builder.build({
        recallTriggered: false,
        recallWarnings: warnings,
        recallDecisions: [decision]
      });
      return {
        context,
        decisions: [decision]
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
      onEvent: input.onEvent
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
    const context = await this.#builder.build({
      recallTriggered: true,
      sessionRecall: blocks,
      recallWarnings: warnings,
      recallDecisions: [decision]
    });
    return {
      context,
      decisions: [decision]
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
