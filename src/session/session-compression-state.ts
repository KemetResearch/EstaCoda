import type {
  SessionCompressionFailure,
  SessionCompressionProtectedSpan,
  SessionCompressionSourceRange,
  SessionCompressionState,
  SessionCompressionTrigger
} from "../contracts/session.js";

const MAX_PERSISTED_SUMMARY_CHARS = 10_000;
const MAX_PERSISTED_FAILURE_MESSAGE_CHARS = 500;
const MAX_RECENT_SAVINGS_RATIOS = 2;

export const INITIAL_SESSION_COMPRESSION_STATE: SessionCompressionState = {
  status: "idle",
  compressionCount: 0,
  protectedFirstN: 0,
  protectedLastN: 0,
  protectedSpans: [],
  ineffectiveCompressionCount: 0,
  fallbackUsed: false,
  warnings: []
};

export function reconstructSessionCompressionState(events: readonly unknown[]): SessionCompressionState {
  let state = INITIAL_SESSION_COMPRESSION_STATE;

  for (const event of events) {
    if (!isRecord(event) || event.kind !== "session-compression-state" || !isRecord(event.state)) {
      continue;
    }
    state = normalizeSessionCompressionState(event.state);
  }

  return cloneSessionCompressionState(state);
}

export function normalizeSessionCompressionState(value: unknown): SessionCompressionState {
  if (!isRecord(value)) {
    return cloneSessionCompressionState(INITIAL_SESSION_COMPRESSION_STATE);
  }

  const status = value.status === "compressed" || value.status === "failed" ? value.status : "idle";
  const trigger = isCompressionTrigger(value.trigger) ? value.trigger : undefined;
  const compressionCount = normalizeNonNegativeInteger(value.compressionCount);
  const lastCompressedAt = typeof value.lastCompressedAt === "string" ? value.lastCompressedAt : undefined;
  const previousSummary = normalizeOptionalBoundedString(value.previousSummary, MAX_PERSISTED_SUMMARY_CHARS);
  const lastCompressedThroughMessageId = typeof value.lastCompressedThroughMessageId === "string"
    ? value.lastCompressedThroughMessageId
    : undefined;
  const lastPromptTokensEstimated = normalizeOptionalNonNegativeInteger(value.lastPromptTokensEstimated);
  const lastActualPromptTokens = normalizeOptionalNonNegativeInteger(value.lastActualPromptTokens);
  const source = normalizeSourceRange(value.source);
  const protectedFirstN = normalizeNonNegativeInteger(value.protectedFirstN);
  const protectedLastN = normalizeNonNegativeInteger(value.protectedLastN);
  const protectedSpans = Array.isArray(value.protectedSpans)
    ? value.protectedSpans.map(normalizeProtectedSpan).filter((span) => span !== undefined)
    : [];
  const sourceMessageCount = normalizeOptionalNonNegativeInteger(value.sourceMessageCount);
  const protectedMessageCount = normalizeOptionalNonNegativeInteger(value.protectedMessageCount);
  const summaryFormatVersion = typeof value.summaryFormatVersion === "string" ? value.summaryFormatVersion : undefined;
  const summaryMessageId = typeof value.summaryMessageId === "string" ? value.summaryMessageId : undefined;
  const summaryChars = normalizeOptionalNonNegativeInteger(value.summaryChars);
  const summaryEstimatedTokens = normalizeOptionalNonNegativeInteger(value.summaryEstimatedTokens);
  const summaryLengthTokens = normalizeOptionalNonNegativeInteger(value.summaryLengthTokens) ?? summaryEstimatedTokens;
  const droppedMessageCount = normalizeOptionalNonNegativeInteger(value.droppedMessageCount);
  const estimatedSavingsTokens = normalizeOptionalInteger(value.estimatedSavingsTokens);
  const lastCompressionSavingsPct = normalizeOptionalFiniteNumber(value.lastCompressionSavingsPct);
  const ineffectiveCompressionCount = normalizeNonNegativeInteger(value.ineffectiveCompressionCount);
  const recentSavingsRatios = normalizeRecentSavingsRatios(value.recentSavingsRatios);
  const summaryFailureCooldownUntil = typeof value.summaryFailureCooldownUntil === "string"
    ? value.summaryFailureCooldownUntil
    : undefined;
  const fallbackUsed = value.fallbackUsed === true;
  const fallbackReason = typeof value.fallbackReason === "string" ? value.fallbackReason : undefined;
  const model = typeof value.model === "string" ? value.model : undefined;
  const modelUsed = typeof value.modelUsed === "string" ? value.modelUsed : model;
  const auxModelFailure = normalizeFailure(value.auxModelFailure);
  const mainRetryFailure = normalizeFailure(value.mainRetryFailure);
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const failure = normalizeFailure(value.failure);

  return {
    status,
    trigger,
    compressionCount,
    lastCompressedAt,
    previousSummary,
    lastCompressedThroughMessageId,
    lastPromptTokensEstimated,
    lastActualPromptTokens,
    source,
    protectedFirstN,
    protectedLastN,
    protectedSpans,
    sourceMessageCount,
    protectedMessageCount,
    summaryFormatVersion,
    summaryMessageId,
    summaryChars,
    summaryEstimatedTokens,
    summaryLengthTokens,
    droppedMessageCount,
    estimatedSavingsTokens,
    lastCompressionSavingsPct,
    ineffectiveCompressionCount,
    recentSavingsRatios,
    summaryFailureCooldownUntil,
    fallbackUsed,
    fallbackReason,
    model,
    modelUsed,
    auxModelFailure,
    mainRetryFailure,
    warnings,
    failure
  };
}

function cloneSessionCompressionState(state: SessionCompressionState): SessionCompressionState {
  return {
    ...state,
    source: state.source === undefined ? undefined : { ...state.source },
    protectedSpans: state.protectedSpans.map((span) => ({ ...span })),
    recentSavingsRatios: state.recentSavingsRatios === undefined ? undefined : [...state.recentSavingsRatios],
    auxModelFailure: state.auxModelFailure === undefined ? undefined : { ...state.auxModelFailure },
    mainRetryFailure: state.mainRetryFailure === undefined ? undefined : { ...state.mainRetryFailure },
    warnings: [...state.warnings],
    failure: state.failure === undefined ? undefined : { ...state.failure }
  };
}

function normalizeSourceRange(value: unknown): SessionCompressionSourceRange | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const messageCount = normalizeNonNegativeInteger(value.messageCount);
  return {
    startMessageId: typeof value.startMessageId === "string" ? value.startMessageId : undefined,
    endMessageId: typeof value.endMessageId === "string" ? value.endMessageId : undefined,
    messageCount,
    estimatedTokens: normalizeOptionalNonNegativeInteger(value.estimatedTokens)
  };
}

function normalizeProtectedSpan(value: unknown): SessionCompressionProtectedSpan | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    startMessageId: typeof value.startMessageId === "string" ? value.startMessageId : undefined,
    endMessageId: typeof value.endMessageId === "string" ? value.endMessageId : undefined,
    messageCount: normalizeNonNegativeInteger(value.messageCount)
  };
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.trunc(value);
}

function normalizeOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalBoundedString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function normalizeRecentSavingsRatios(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ratios = value
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    .slice(-MAX_RECENT_SAVINGS_RATIOS);
  return ratios.length === 0 ? undefined : ratios;
}

function normalizeFailure(value: unknown): SessionCompressionFailure | undefined {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
    return undefined;
  }
  return {
    code: value.code,
    message: normalizeOptionalBoundedString(value.message, MAX_PERSISTED_FAILURE_MESSAGE_CHARS) ?? "",
    recoverable: typeof value.recoverable === "boolean" ? value.recoverable : undefined
  };
}

function isCompressionTrigger(value: unknown): value is SessionCompressionTrigger {
  return value === "auto" || value === "manual" || value === "hygiene";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
