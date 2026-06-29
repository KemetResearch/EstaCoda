import {
  type AssistantMessageFrameBlock,
  getAssistantMessageFrameDesiredHeight,
  renderAssistantMessageFrame,
} from "./assistantMessageFrame.js";
import type { StreamingState } from "./operatorConsoleState.js";
import type { OperatorConsoleStyle } from "./operatorConsoleStyle.js";

export type StreamingSurfaceRenderOptions = {
  readonly width: number;
  readonly height?: number;
  readonly terminalHeight?: number;
  readonly style?: OperatorConsoleStyle;
};

const MIN_STREAMING_SURFACE_ROWS = 8;
const MAX_STREAMING_SURFACE_ROWS = 32;
const STREAMING_SURFACE_HEIGHT_RATIO = 0.5;

export function hasStreamingSurface(state: StreamingState | undefined): state is StreamingState {
  return state !== undefined && state.isStreaming && (
    state.tail.trim().length > 0 ||
    state.segments.some((segment) => segment.text.trim().length > 0)
  );
}

export function getStreamingSurfaceDesiredHeight(
  state: StreamingState | undefined,
  width: number,
  options: { readonly terminalHeight?: number } = {}
): number {
  if (!hasStreamingSurface(state)) return 0;
  return Math.min(
    getStreamingSurfaceRowLimit(options.terminalHeight),
    getAssistantMessageFrameDesiredHeight({
      lines: [],
      blocks: streamingContentBlocks(state),
    }, width)
  );
}

export function renderStreamingSurface(
  state: StreamingState | undefined,
  options: StreamingSurfaceRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0 || !hasStreamingSurface(state)) return [];

  const height = normalizeDimension(options.height ?? getStreamingSurfaceDesiredHeight(state, width, {
    terminalHeight: options.terminalHeight,
  }));
  if (height <= 0) return [];

  return renderAssistantMessageFrame({
    lines: [],
    blocks: streamingContentBlocks(state),
  }, { width, height, style: options.style });
}

function streamingContentBlocks(state: StreamingState): readonly AssistantMessageFrameBlock[] {
  const blocks: AssistantMessageFrameBlock[] = [];
  const toolTrail = state.toolTrail ?? [];
  const emittedToolIds = new Set<string>();

  for (const segment of state.segments) {
    const textLines = normalizeStreamingText(segment.text);
    if (textLines.length > 0) {
      blocks.push({ kind: "text", lines: textLines });
    }
    const entries = toolTrail.filter((entry) => entry.afterSegmentId === segment.id);
    if (entries.length > 0) {
      blocks.push({ kind: "toolTrail", entries });
      for (const entry of entries) emittedToolIds.add(entry.id);
    }
  }

  const unanchoredEntries = toolTrail.filter((entry) => !emittedToolIds.has(entry.id));
  if (unanchoredEntries.length > 0) {
    blocks.push({ kind: "toolTrail", entries: unanchoredEntries });
  }

  const tailLines = normalizeStreamingText(state.tail);
  if (tailLines.length > 0) {
    blocks.push({ kind: "text", lines: tailLines, cursor: true });
  } else if (!hasToolTrailBlocks(blocks)) {
    const lastTextIndex = findLastTextBlockIndex(blocks);
    if (lastTextIndex >= 0) {
      const block = blocks[lastTextIndex] as Extract<AssistantMessageFrameBlock, { readonly kind: "text" }>;
      blocks[lastTextIndex] = { ...block, cursor: true };
    }
  }

  return blocks;
}

function normalizeStreamingText(text: string): readonly string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  return lines.length === 0 ? [] : lines;
}

function hasToolTrailBlocks(blocks: readonly AssistantMessageFrameBlock[]): boolean {
  return blocks.some((block) => block.kind === "toolTrail" && block.entries.length > 0);
}

function findLastTextBlockIndex(blocks: readonly AssistantMessageFrameBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.kind === "text") return index;
  }
  return -1;
}

function getStreamingSurfaceRowLimit(terminalHeight: number | undefined): number {
  const normalizedHeight = terminalHeight === undefined ? 0 : normalizeDimension(terminalHeight);
  if (normalizedHeight <= 0) return MAX_STREAMING_SURFACE_ROWS;
  return Math.min(
    MAX_STREAMING_SURFACE_ROWS,
    Math.max(MIN_STREAMING_SURFACE_ROWS, Math.floor(normalizedHeight * STREAMING_SURFACE_HEIGHT_RATIO))
  );
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
