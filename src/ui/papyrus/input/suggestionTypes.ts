export type SuggestionKind =
  | "slash"
  | "directory"
  | "file"
  | "history"
  | "skill"
  | "mcp"
  | "custom";

export type SuggestionTriggerKind =
  | "slash"
  | "path"
  | "word"
  | "history"
  | "custom"
  | "unknown";

export type SuggestionReplacementRange = {
  readonly start: number;
  readonly end: number;
};

export type SuggestionAvailability =
  | { readonly state: "available" }
  | { readonly state: "disabled" | "unavailable"; readonly reason?: string };

export type SuggestionRankMetadata = {
  readonly score?: number;
  readonly priority?: number;
  readonly matchedRanges?: readonly SuggestionReplacementRange[];
};

export type SuggestionItem<TMetadata = unknown> = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly description?: string;
  readonly replacementText: string;
  readonly replacementRange: SuggestionReplacementRange;
  readonly providerId: string;
  readonly kind: SuggestionKind;
  readonly availability?: SuggestionAvailability;
  readonly rank?: SuggestionRankMetadata;
  readonly metadata?: TMetadata;
};

export type SuggestionTokenContext = {
  readonly input: string;
  readonly cursorOffset: number;
  readonly token: string;
  readonly tokenRange: SuggestionReplacementRange;
  readonly triggerKind?: SuggestionTriggerKind;
};

export type SuggestionProviderError = {
  readonly message: string;
  readonly code?: string;
  readonly recoverable?: boolean;
};

export type SuggestionResultBase = {
  readonly providerId: string;
  readonly requestId?: string;
  readonly generation?: number;
  readonly stale?: boolean;
};

export type SuggestionSuccessResult<TMetadata = unknown> = SuggestionResultBase & {
  readonly type: "success";
  readonly suggestions: readonly SuggestionItem<TMetadata>[];
};

export type SuggestionEmptyResult = SuggestionResultBase & {
  readonly type: "empty";
  readonly suggestions: readonly [];
};

export type SuggestionErrorResult = SuggestionResultBase & {
  readonly type: "error";
  readonly suggestions: readonly [];
  readonly error: SuggestionProviderError;
};

export type SuggestionCanceledResult = SuggestionResultBase & {
  readonly type: "canceled";
  readonly suggestions: readonly [];
  readonly canceled: true;
};

export type SuggestionProviderResult<TMetadata = unknown> =
  | SuggestionSuccessResult<TMetadata>
  | SuggestionEmptyResult
  | SuggestionErrorResult
  | SuggestionCanceledResult;

export type SuggestionProviderResultInput<TMetadata = unknown> = {
  readonly suggestions?: readonly SuggestionItem<TMetadata>[];
  readonly requestId?: string;
  readonly generation?: number;
  readonly stale?: boolean;
  readonly canceled?: boolean;
  readonly error?: string | SuggestionProviderError | Error;
};

export type SuggestionProvider<TMetadata = unknown> = {
  readonly id: string;
  readonly name: string;
  readonly capabilityTags?: readonly string[];
  readonly getSuggestions: (
    context: SuggestionTokenContext,
    signal?: AbortSignal
  ) => SuggestionProviderResult<TMetadata> | Promise<SuggestionProviderResult<TMetadata>>;
};

export class InvalidSuggestionRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSuggestionRangeError";
  }
}

export function isValidReplacementRange(
  input: string,
  range: SuggestionReplacementRange
): boolean {
  return Number.isInteger(range.start)
    && Number.isInteger(range.end)
    && range.start >= 0
    && range.end >= range.start
    && range.end <= input.length;
}

export function assertValidReplacementRange(
  input: string,
  range: SuggestionReplacementRange
): SuggestionReplacementRange {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new InvalidSuggestionRangeError("Suggestion replacement range must use integer offsets");
  }
  if (range.start < 0) {
    throw new InvalidSuggestionRangeError("Suggestion replacement range start must be non-negative");
  }
  if (range.end < range.start) {
    throw new InvalidSuggestionRangeError("Suggestion replacement range end must be after start");
  }
  if (range.end > input.length) {
    throw new InvalidSuggestionRangeError("Suggestion replacement range must be within input bounds");
  }
  return range;
}

export function applySuggestionReplacement(
  input: string,
  range: SuggestionReplacementRange,
  replacementText: string
): string {
  assertValidReplacementRange(input, range);
  return `${input.slice(0, range.start)}${replacementText}${input.slice(range.end)}`;
}

export function createSuggestionTokenContext(input: {
  readonly input: string;
  readonly cursorOffset: number;
  readonly tokenRange?: SuggestionReplacementRange;
  readonly triggerKind?: SuggestionTriggerKind;
}): SuggestionTokenContext {
  assertCursorInBounds(input.input, input.cursorOffset);
  const tokenRange = input.tokenRange ?? { start: input.cursorOffset, end: input.cursorOffset };
  assertValidReplacementRange(input.input, tokenRange);
  if (input.cursorOffset < tokenRange.start || input.cursorOffset > tokenRange.end) {
    throw new InvalidSuggestionRangeError("Suggestion cursor must be within the token range");
  }

  return {
    input: input.input,
    cursorOffset: input.cursorOffset,
    token: input.input.slice(tokenRange.start, tokenRange.end),
    tokenRange,
    triggerKind: input.triggerKind,
  };
}

export function normalizeSuggestionProviderResult<TMetadata = unknown>(
  providerId: string,
  result: SuggestionProviderResultInput<TMetadata> = {}
): SuggestionProviderResult<TMetadata> {
  const base = {
    providerId,
    requestId: result.requestId,
    generation: result.generation,
    stale: result.stale,
  };

  if (result.canceled === true) {
    return {
      ...base,
      type: "canceled",
      suggestions: [],
      canceled: true,
    };
  }

  if (result.error !== undefined) {
    return {
      ...base,
      type: "error",
      suggestions: [],
      error: normalizeSuggestionProviderError(result.error),
    };
  }

  const suggestions = result.suggestions ?? [];
  if (suggestions.length === 0) {
    return {
      ...base,
      type: "empty",
      suggestions: [],
    };
  }

  return {
    ...base,
    type: "success",
    suggestions,
  };
}

export function normalizeSuggestionProviderError(
  error: string | SuggestionProviderError | Error
): SuggestionProviderError {
  if (typeof error === "string") return { message: error };
  if (error instanceof Error) return { message: error.message };
  return error;
}

function assertCursorInBounds(input: string, cursorOffset: number): void {
  if (!Number.isInteger(cursorOffset)) {
    throw new InvalidSuggestionRangeError("Suggestion cursor offset must be an integer");
  }
  if (cursorOffset < 0 || cursorOffset > input.length) {
    throw new InvalidSuggestionRangeError("Suggestion cursor offset must be within input bounds");
  }
}
