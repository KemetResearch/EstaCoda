import type { SessionCompressionConfig } from "../config/runtime-config.js";
import type { ResolvedAuxiliaryRoute, ResolvedModelRoute } from "../contracts/provider.js";
import type {
  ReplacementSessionMessage,
  SessionCompressionState,
  SessionDB,
  SessionEvent,
  SessionMessage
} from "../contracts/session.js";
import type { ProviderExecutor } from "../providers/provider-executor.js";
import { SessionCompressionLock } from "../session/session-compression-lock.js";
import { reconstructSessionCompressionState } from "../session/session-compression-state.js";
import {
  SemanticCompressor,
  type SemanticCompressionDiagnostics,
  SUMMARY_FORMAT_VERSION
} from "./semantic-compressor.js";
import { estimateMessageTokensRough } from "./token-estimator.js";

export type SessionCompressionServiceOptions = {
  sessionDb: SessionDB;
  config: SessionCompressionConfig;
  route?: ResolvedAuxiliaryRoute;
  mainRoute?: ResolvedModelRoute;
  providerExecutor?: Pick<ProviderExecutor, "complete">;
  lock?: SessionCompressionLock;
  now?: () => Date;
  id?: () => string;
};

export type SessionCompressionRequest = {
  profileId: string;
  sessionId: string;
  focusTopic?: string;
  signal?: AbortSignal;
};

export type CompactResult = {
  didCompress: boolean;
  messages: readonly ReplacementSessionMessage[];
  diagnostics: Readonly<SemanticCompressionDiagnostics & {
    eventWarnings: readonly string[];
  }>;
  userFacingMessage?: string;
};

export class SessionCompressionService {
  readonly #sessionDb: SessionDB;
  readonly #compressor: SemanticCompressor;
  readonly #lock: SessionCompressionLock;
  readonly #now: () => Date;

  constructor(options: SessionCompressionServiceOptions) {
    this.#sessionDb = options.sessionDb;
    this.#lock = options.lock ?? new SessionCompressionLock();
    this.#now = options.now ?? (() => new Date());
    this.#compressor = new SemanticCompressor({
      config: options.config,
      route: options.route,
      mainRoute: options.mainRoute,
      providerExecutor: options.providerExecutor,
      now: options.now,
      id: options.id
    });
  }

  async compactIfNeeded(input: SessionCompressionRequest): Promise<CompactResult> {
    return this.#compact(input, false);
  }

  async compactNow(input: SessionCompressionRequest): Promise<CompactResult> {
    return this.#compact(input, true);
  }

  async #compact(input: SessionCompressionRequest, force: boolean): Promise<CompactResult> {
    return this.#lock.runExclusive(input.sessionId, async () => {
      const messages = await this.#sessionDb.listMessages(input.sessionId);
      const previousState = reconstructSessionCompressionState(await this.#sessionDb.listEvents(input.sessionId));
      const compressed = await this.#compressor.compress({
        messages,
        profileId: input.profileId,
        sessionId: input.sessionId,
        previousState,
        focusTopic: input.focusTopic,
        force,
        signal: input.signal
      });

      if (!compressed.didCompress) {
        return freezeCompactResult({
          didCompress: false,
          messages: compressed.messages,
          diagnostics: {
            ...compressed.diagnostics,
            eventWarnings: []
          },
          userFacingMessage: compressed.userFacingMessage
        });
      }

      const written = await this.#sessionDb.replaceMessages({
        sessionId: input.sessionId,
        messages: compressed.messages
      });
      const eventWarnings = await this.#recordEventsBestEffort({
        sessionId: input.sessionId,
        messagesBefore: messages,
        messagesAfter: written,
        previousState,
        diagnostics: compressed.diagnostics
      });

      return freezeCompactResult({
        didCompress: true,
        messages: written.map(toReplacementMessage),
        diagnostics: {
          ...compressed.diagnostics,
          eventWarnings
        },
        userFacingMessage: compressed.userFacingMessage
      });
    });
  }

  async #recordEventsBestEffort(input: {
    sessionId: string;
    messagesBefore: SessionMessage[];
    messagesAfter: SessionMessage[];
    previousState: SessionCompressionState;
    diagnostics: SemanticCompressionDiagnostics;
  }): Promise<string[]> {
    const warnings: string[] = [];
    const firstSource = input.messagesBefore.find((message) =>
      !input.messagesAfter.some((candidate) => candidate.id === message.id)
    );
    const lastSource = [...input.messagesBefore].reverse().find((message) =>
      !input.messagesAfter.some((candidate) => candidate.id === message.id)
    );
    const summaryMessage = input.messagesAfter.find((message) => message.metadata?.semanticCompression === true);
    const summaryEstimatedTokens = summaryMessage === undefined ? undefined : estimateMessageTokensRough({
      role: summaryMessage.role,
      content: summaryMessage.content,
      metadata: summaryMessage.metadata
    });
    const compressedEvent: SessionEvent = {
      kind: "session-history-compressed",
      trigger: input.diagnostics.reason === "forced" ? "manual" : "auto",
      source: {
        startMessageId: firstSource?.id,
        endMessageId: lastSource?.id,
        messageCount: input.diagnostics.summarizedMessageCount,
        estimatedTokens: input.diagnostics.preTokens
      },
      protectedFirstN: input.diagnostics.protectedFirstN,
      protectedLastN: input.diagnostics.protectedLastN,
      protectedSpans: input.diagnostics.protectedSpans,
      summaryFormatVersion: SUMMARY_FORMAT_VERSION,
      summaryChars: input.diagnostics.summaryChars,
      ...(summaryEstimatedTokens === undefined ? {} : { summaryEstimatedTokens }),
      estimatedSavingsTokens: input.diagnostics.estimatedSavingsTokens,
      estimatedSavingsRatio: input.diagnostics.estimatedSavingsRatio,
      fallbackUsed: input.diagnostics.fallbackUsed,
      fallbackReason: input.diagnostics.fallbackReason,
      model: input.diagnostics.model,
      warnings: input.diagnostics.warnings
    };
    const stateEvent: SessionEvent = {
      kind: "session-compression-state",
      state: {
        status: "compressed",
        trigger: compressedEvent.trigger,
        lastCompressedAt: this.#now().toISOString(),
        source: compressedEvent.source,
        protectedFirstN: input.diagnostics.protectedFirstN,
        protectedLastN: input.diagnostics.protectedLastN,
        protectedSpans: input.diagnostics.protectedSpans,
        summaryFormatVersion: SUMMARY_FORMAT_VERSION,
        summaryMessageId: summaryMessage?.id,
        summaryChars: input.diagnostics.summaryChars,
        ...(summaryEstimatedTokens === undefined ? {} : { summaryEstimatedTokens }),
        estimatedSavingsTokens: input.diagnostics.estimatedSavingsTokens,
        fallbackUsed: input.diagnostics.fallbackUsed,
        model: input.diagnostics.model,
        warnings: input.diagnostics.warnings
      }
    };

    for (const event of [compressedEvent, stateEvent]) {
      try {
        await this.#sessionDb.appendEvent(input.sessionId, event);
      } catch (error) {
        warnings.push(`session compression event write failed: ${errorMessage(error)}`);
      }
    }

    return warnings;
  }
}

export function renderSessionCompactionResult(
  result: CompactResult,
  options: { focusTopic?: string } = {}
): string {
  const beforeCount = result.diagnostics.sourceMessageCount;
  const afterCount = result.messages.length;
  const savedTokens = Math.max(0, Math.round(result.diagnostics.estimatedSavingsTokens));
  const savingsPct = Math.max(0, Math.round(result.diagnostics.estimatedSavingsRatio * 100));
  const lines = result.didCompress
    ? [
        `Compacted ${beforeCount} messages -> ${afterCount} messages (~${savedTokens} tokens saved, ${savingsPct}%).`
      ]
    : [
        `Session compaction skipped: ${result.diagnostics.reason}.`
      ];

  const focusTopic = options.focusTopic?.trim();
  if (focusTopic !== undefined && focusTopic.length > 0) {
    lines.push(`Focus topic: ${focusTopic}`);
  }

  lines.push(`Token estimate: ${result.diagnostics.preTokens} -> ${result.diagnostics.postTokens}`);

  if (result.userFacingMessage !== undefined && result.userFacingMessage.length > 0) {
    lines.push(result.userFacingMessage);
  }

  const warnings = uniqueStrings([
    ...(result.diagnostics.fallbackUsed
      ? [`fallback summary used${result.diagnostics.fallbackReason === undefined ? "" : ` (${result.diagnostics.fallbackReason})`}`]
      : []),
    ...result.diagnostics.warnings,
    ...result.diagnostics.eventWarnings
  ]);
  for (const warning of warnings) {
    lines.push(`Warning: ${warning}`);
  }

  return lines.join("\n");
}

function freezeCompactResult(result: CompactResult): CompactResult {
  for (const message of result.messages) {
    if (message.metadata !== undefined) {
      Object.freeze(message.metadata);
    }
    Object.freeze(message);
  }
  for (const span of result.diagnostics.protectedSpans) {
    Object.freeze(span);
  }
  Object.freeze(result.messages);
  Object.freeze(result.diagnostics.eventWarnings);
  Object.freeze(result.diagnostics.protectedSpans);
  Object.freeze(result.diagnostics.protectedCategories);
  Object.freeze(result.diagnostics.warnings);
  Object.freeze(result.diagnostics);
  return Object.freeze(result);
}

function toReplacementMessage(message: SessionMessage): ReplacementSessionMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    channel: message.channel,
    metadata: message.metadata === undefined ? undefined : { ...message.metadata }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value.trim().length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
