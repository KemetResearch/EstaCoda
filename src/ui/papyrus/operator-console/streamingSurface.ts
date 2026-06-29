import { truncateVisible } from "../../renderers/layout.js";
import { stringWidth } from "../screen/stringWidth.js";
import type {
  StreamingSegment,
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
  _width: number
): number {
  if (!hasStreamingSurface(state)) return 0;
  const contentRows = [
    ...state.segments.flatMap((segment) => estimateTextRows(segment.text)),
    ...estimateTextRows(state.tail),
  ].length;
  return Math.min(MAX_STREAMING_SURFACE_ROWS, Math.max(3, contentRows + 2));
}

export function renderStreamingSurface(
  state: StreamingState | undefined,
  options: StreamingSurfaceRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0 || !hasStreamingSurface(state)) return [];

  const height = normalizeDimension(options.height ?? getStreamingSurfaceDesiredHeight(state, width));
  if (height <= 0) return [];
  if (height < 3) return [truncateVisibleCells(streamingSummary(state), width)];

  const contentWidth = Math.max(0, width - 4);
  const contentRows = Math.max(1, height - 2);
  const rows = padRows(renderStreamingContentRows(state, contentRows, contentWidth), contentRows);

  return [
    renderTopBorder("Assistant stream", width),
    ...rows.map((row) => renderContentRow(row, contentWidth, width)),
    renderBottomBorder(width),
  ];
}

function renderStreamingContentRows(
  state: StreamingState,
  maxRows: number,
  width: number
): readonly string[] {
  const rows: string[] = [];

  for (const segment of state.segments) {
    rows.push(...renderSegmentRows(segment, width));
    if (rows.length >= maxRows) return rows.slice(0, maxRows);
  }

  if (state.tail.length > 0) {
    rows.push(...renderTextRows(`assistant: ${state.tail}▍`, width));
  }

  return rows.slice(0, maxRows);
}

function renderSegmentRows(segment: StreamingSegment, width: number): readonly string[] {
  return renderTextRows(`${segment.role}: ${segment.text}`, width);
}

function renderTextRows(text: string, width: number): readonly string[] {
  const lines = text.split("\n");
  return lines.map((line) => truncateVisibleCells(line, width));
}

function estimateTextRows(text: string): readonly string[] {
  if (text.length === 0) return [];
  return text.split("\n");
}

function padRows(rows: readonly string[], count: number): readonly string[] {
  if (rows.length >= count) return rows.slice(0, count);
  return [...rows, ...Array.from({ length: count - rows.length }, () => "")];
}

function streamingSummary(state: StreamingState): string {
  const segmentCount = state.segments.filter((segment) => segment.text.trim().length > 0).length;
  return `Assistant stream: ${segmentCount} segment${segmentCount === 1 ? "" : "s"}`;
}

function renderTopBorder(title: string, width: number): string {
  if (width <= 0) return "";
  if (width < 4) return "─".repeat(width);
  const label = ` ${truncateVisibleCells(title, Math.max(0, width - 4))} `;
  const remaining = Math.max(0, width - stringWidth(label));
  return `${label}${"─".repeat(remaining)}`.slice(0, width);
}

function renderBottomBorder(width: number): string {
  return "─".repeat(Math.max(0, width));
}

function renderContentRow(row: string, contentWidth: number, width: number): string {
  if (width < 4) return truncateVisibleCells(row, width);
  const visible = truncateVisibleCells(row, contentWidth);
  const padding = " ".repeat(Math.max(0, contentWidth - stringWidth(visible)));
  return `│ ${visible}${padding} │`;
}

function truncateVisibleCells(value: string, width: number): string {
  if (width <= 0) return "";
  return truncateVisible(value, width);
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
