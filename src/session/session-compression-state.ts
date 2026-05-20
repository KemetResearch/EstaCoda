import type {
  SessionCompressionProtectedSpan,
  SessionCompressionSourceRange,
  SessionCompressionState,
  SessionCompressionTrigger
} from "../contracts/session.js";

export const INITIAL_SESSION_COMPRESSION_STATE: SessionCompressionState = {
  status: "idle",
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
  const lastCompressedAt = typeof value.lastCompressedAt === "string" ? value.lastCompressedAt : undefined;
  const source = normalizeSourceRange(value.source);
  const protectedFirstN = normalizeNonNegativeInteger(value.protectedFirstN);
  const protectedLastN = normalizeNonNegativeInteger(value.protectedLastN);
  const protectedSpans = Array.isArray(value.protectedSpans)
    ? value.protectedSpans.map(normalizeProtectedSpan).filter((span) => span !== undefined)
    : [];
  const summaryFormatVersion = typeof value.summaryFormatVersion === "string" ? value.summaryFormatVersion : undefined;
  const summaryMessageId = typeof value.summaryMessageId === "string" ? value.summaryMessageId : undefined;
  const summaryChars = normalizeOptionalNonNegativeInteger(value.summaryChars);
  const summaryEstimatedTokens = normalizeOptionalNonNegativeInteger(value.summaryEstimatedTokens);
  const estimatedSavingsTokens = normalizeOptionalInteger(value.estimatedSavingsTokens);
  const lastCompressionSavingsPct = normalizeOptionalFiniteNumber(value.lastCompressionSavingsPct);
  const ineffectiveCompressionCount = normalizeNonNegativeInteger(value.ineffectiveCompressionCount);
  const recentSavingsRatios = normalizeRecentSavingsRatios(value.recentSavingsRatios);
  const fallbackUsed = value.fallbackUsed === true;
  const model = typeof value.model === "string" ? value.model : undefined;
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const failure = isRecord(value.failure) &&
    typeof value.failure.code === "string" &&
    typeof value.failure.message === "string"
    ? {
        code: value.failure.code,
        message: value.failure.message,
        recoverable: typeof value.failure.recoverable === "boolean" ? value.failure.recoverable : undefined
      }
    : undefined;

  return {
    status,
    trigger,
    lastCompressedAt,
    source,
    protectedFirstN,
    protectedLastN,
    protectedSpans,
    summaryFormatVersion,
    summaryMessageId,
    summaryChars,
    summaryEstimatedTokens,
    estimatedSavingsTokens,
    lastCompressionSavingsPct,
    ineffectiveCompressionCount,
    recentSavingsRatios,
    fallbackUsed,
    model,
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

function normalizeRecentSavingsRatios(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ratios = value
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    .slice(-2);
  return ratios.length === 0 ? undefined : ratios;
}

function isCompressionTrigger(value: unknown): value is SessionCompressionTrigger {
  return value === "auto" || value === "manual" || value === "hygiene";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
