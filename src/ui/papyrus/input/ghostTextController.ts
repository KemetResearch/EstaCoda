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
  readonly acceptedText?: string;
  readonly remainingText?: string;
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
  const intent = createGhostTextAcceptIntent(state, state.suggestionText);
  if (intent === undefined) return { state };
  return {
    state,
    intent,
  };
}

export function acceptPartialGhostText(state: GhostTextState): GhostTextResult {
  const suggestion = partialGhostReplacementText(state);
  const intent = createGhostTextAcceptIntent(state, suggestion);
  if (intent === undefined) return { state };
  return {
    state,
    intent: {
      ...intent,
      acceptedText: partialGhostAcceptedText(state),
      remainingText: remainingGhostText(state, suggestion),
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

function createGhostTextAcceptIntent(
  state: GhostTextState,
  replacementText: string | undefined
): GhostTextAcceptIntent | undefined {
  if (!state.visible || state.dismissed || replacementText === undefined || state.replacementRange === undefined) {
    return undefined;
  }

  assertGhostTextRange(state.input, state.replacementRange);
  const nextInput = applySuggestionReplacement(state.input, state.replacementRange, replacementText);
  return {
    type: "replace",
    replacementText,
    replacementRange: state.replacementRange,
    nextInput,
    nextCursorOffset: state.replacementRange.start + replacementText.length,
  };
}

function partialGhostReplacementText(state: GhostTextState): string | undefined {
  if (state.suggestionText === undefined || state.replacementRange === undefined) return undefined;
  const currentText = state.input.slice(state.replacementRange.start, state.replacementRange.end);
  const suffix = ghostSuffix(state.suggestionText, currentText);
  const accepted = nextPartialAcceptSegment(suffix);
  if (accepted.length === 0) return undefined;
  return state.suggestionText.startsWith(currentText) ? `${currentText}${accepted}` : accepted;
}

function partialGhostAcceptedText(state: GhostTextState): string | undefined {
  if (state.suggestionText === undefined || state.replacementRange === undefined) return undefined;
  const currentText = state.input.slice(state.replacementRange.start, state.replacementRange.end);
  return nextPartialAcceptSegment(ghostSuffix(state.suggestionText, currentText));
}

function remainingGhostText(state: GhostTextState, partialReplacementText: string | undefined): string | undefined {
  if (state.suggestionText === undefined || partialReplacementText === undefined) return undefined;
  const remaining = state.suggestionText.slice(partialReplacementText.length);
  return remaining.length === 0 ? undefined : remaining;
}

function ghostSuffix(suggestionText: string, currentText: string): string {
  return suggestionText.startsWith(currentText) ? suggestionText.slice(currentText.length) : suggestionText;
}

function nextPartialAcceptSegment(text: string): string {
  const spans = graphemeSpans(text);
  if (spans.length === 0) return "";

  for (const span of spans) {
    if (isTokenBoundaryGrapheme(text.slice(span.start, span.end))) return text.slice(0, span.end);
  }

  return text.slice(0, spans[0]!.end);
}

function isTokenBoundaryGrapheme(grapheme: string): boolean {
  return /\s|\p{P}|\p{S}/u.test(grapheme);
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
