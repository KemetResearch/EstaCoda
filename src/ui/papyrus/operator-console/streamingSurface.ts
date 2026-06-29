import {
  getAssistantMessageFrameDesiredHeight,
  renderAssistantMessageFrame,
} from "./assistantMessageFrame.js";
import type {
  StreamingState,
} from "./operatorConsoleState.js";

export type StreamingSurfaceRenderOptions = {
  readonly width: number;
  readonly height?: number;
};

const MAX_STREAMING_SURFACE_ROWS = 8;

export function hasStreamingSurface(state: StreamingState | undefined): state is StreamingState {
  return state !== undefined && state.isStreaming && (
    state.tail.trim().length > 0 ||
    state.segments.some((segment) => segment.text.trim().length > 0)
  );
}

export function getStreamingSurfaceDesiredHeight(
  state: StreamingState | undefined,
  width: number
): number {
  if (!hasStreamingSurface(state)) return 0;
  return Math.min(
    MAX_STREAMING_SURFACE_ROWS,
    getAssistantMessageFrameDesiredHeight({
      lines: streamingTextLines(state),
      cursor: true,
    }, width)
  );
}

export function renderStreamingSurface(
  state: StreamingState | undefined,
  options: StreamingSurfaceRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0 || !hasStreamingSurface(state)) return [];

  const height = normalizeDimension(options.height ?? getStreamingSurfaceDesiredHeight(state, width));
  if (height <= 0) return [];

  return renderAssistantMessageFrame({
    lines: streamingTextLines(state),
    cursor: true,
  }, { width, height });
}

function streamingTextLines(state: StreamingState): readonly string[] {
  return [
    ...state.segments.flatMap((segment) => normalizeStreamingText(segment.text)),
    ...normalizeStreamingText(state.tail),
  ];
}

function normalizeStreamingText(text: string): readonly string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  return lines.length === 0 ? [] : lines;
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
