import {
  applySuggestionReplacement,
  assertValidReplacementRange,
  type SuggestionAvailability,
  type SuggestionReplacementRange,
} from "./suggestionTypes.js";

export type GhostTextState = {
  readonly input: string;
  readonly cursorOffset: number;
  readonly suggestionText?: string;
  readonly replacementRange?: SuggestionReplacementRange;
  readonly visible: boolean;
  readonly dismissed: boolean;
  readonly generation?: number;
  readonly availability?: SuggestionAvailability;
};

export type CreateGhostTextStateInput = {
  readonly input?: string;
  readonly cursorOffset?: number;
  readonly generation?: number;
};

export type SetGhostTextSuggestionInput = {
  readonly suggestionText: string;
  readonly replacementRange?: SuggestionReplacementRange;
  readonly generation?: number;
  readonly availability?: SuggestionAvailability;
};

export type GhostTextAcceptIntent = {
  readonly type: "replace";
  readonly replacementText: string;
  readonly replacementRange: SuggestionReplacementRange;
  readonly nextInput: string;
  readonly nextCursorOffset: number;
};

export type GhostTextDismissIntent = {
  readonly type: "dismiss";
};

export type GhostTextResult = {
  readonly state: GhostTextState;
  readonly intent?: GhostTextAcceptIntent | GhostTextDismissIntent;
};

export class InvalidGhostTextRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGhostTextRangeError";
  }
}

export function createGhostTextState(input: CreateGhostTextStateInput = {}): GhostTextState {
  const text = input.input ?? "";
  return {
    input: text,
    cursorOffset: normalizeGraphemeOffset(text, input.cursorOffset ?? text.length),
    visible: false,
    dismissed: false,
    generation: input.generation,
  };
}

export function setGhostTextSuggestion(
  state: GhostTextState,
  input: SetGhostTextSuggestionInput
): GhostTextState {
  if (isStaleGeneration(state.generation, input.generation)) return state;

  const replacementRange = input.replacementRange ?? {
    start: state.cursorOffset,
    end: state.cursorOffset,
  };
  assertGhostTextRange(state.input, replacementRange);
  const matchesCursor = state.cursorOffset === replacementRange.end;
  const available = input.availability?.state !== "disabled" && input.availability?.state !== "unavailable";

  return {
    ...state,
    suggestionText: input.suggestionText,
    replacementRange,
    visible: matchesCursor && available,
    dismissed: false,
    generation: input.generation ?? state.generation,
    availability: input.availability,
  };
}

export function clearGhostText(state: GhostTextState): GhostTextState {
  return {
    input: state.input,
    cursorOffset: state.cursorOffset,
    visible: false,
    dismissed: false,
    generation: state.generation,
  };
}

export function dismissGhostText(state: GhostTextState): GhostTextResult {
  return {
    state: {
      ...state,
      visible: false,
      dismissed: true,
    },
    intent: { type: "dismiss" },
  };
}

export function updateGhostTextInput(
  state: GhostTextState,
  input: string,
  cursorOffset: number
): GhostTextState {
  return {
    input,
    cursorOffset: normalizeGraphemeOffset(input, cursorOffset),
    visible: false,
    dismissed: false,
    generation: state.generation,
  };
}

export function acceptGhostText(state: GhostTextState): GhostTextResult {
  if (!state.visible || state.suggestionText === undefined || state.replacementRange === undefined) {
    return { state };
  }

  assertGhostTextRange(state.input, state.replacementRange);
  const nextInput = applySuggestionReplacement(state.input, state.replacementRange, state.suggestionText);
  return {
    state,
    intent: {
      type: "replace",
      replacementText: state.suggestionText,
      replacementRange: state.replacementRange,
      nextInput,
      nextCursorOffset: state.replacementRange.start + state.suggestionText.length,
    },
  };
}

export function isGhostTextVisible(state: GhostTextState): boolean {
  return state.visible;
}

export function assertGhostTextRange(
  input: string,
  range: SuggestionReplacementRange
): SuggestionReplacementRange {
  assertValidReplacementRange(input, range);
  if (!isGraphemeBoundary(input, range.start) || !isGraphemeBoundary(input, range.end)) {
    throw new InvalidGhostTextRangeError("Ghost text replacement range must align to grapheme boundaries");
  }
  return range;
}

function isStaleGeneration(current: number | undefined, next: number | undefined): boolean {
  return current !== undefined && next !== undefined && next < current;
}

function normalizeGraphemeOffset(input: string, offset: number): number {
  const bounded = Math.max(0, Math.min(input.length, Number.isFinite(offset) ? Math.trunc(offset) : input.length));
  if (isGraphemeBoundary(input, bounded)) return bounded;
  for (const span of graphemeSpans(input)) {
    if (bounded > span.start && bounded < span.end) return span.start;
  }
  return bounded;
}

function isGraphemeBoundary(input: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > input.length) return false;
  if (offset === 0 || offset === input.length) return true;
  return graphemeSpans(input).some((span) => span.start === offset || span.end === offset);
}

function graphemeSpans(input: string): Array<{ readonly start: number; readonly end: number }> {
  if (input.length === 0) return [];
  const segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;
  if (segmenter !== undefined) {
    return Array.from(segmenter.segment(input), (segment) => ({
      start: segment.index,
      end: segment.index + segment.segment.length,
    }));
  }

  const spans: Array<{ readonly start: number; readonly end: number }> = [];
  let index = 0;
  for (const value of Array.from(input)) {
    spans.push({ start: index, end: index + value.length });
    index += value.length;
  }
  return spans;
}
