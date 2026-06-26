import type { LineEditorState } from "../../input/lineEditor.js";
import { stringWidth } from "../screen/stringWidth.js";
import {
  createInitialOperatorConsoleState,
  type AttachmentCardState,
  type OperatorConsoleState,
  type StatusRailState,
  type TerminalMetrics,
} from "./operatorConsoleState.js";
import { createOperatorConsoleLayout } from "./operatorConsoleLayout.js";
import { getPromptSurfaceMetrics } from "./promptSurface.js";
import { renderOperatorConsoleTextLines } from "./operatorConsoleRenderer.js";
import {
  type OperatorConsoleRuntimeFrame,
  type OperatorConsoleRuntimeHost,
} from "./operatorConsoleRuntimeHost.js";

export type OperatorConsoleRawPromptOverlayRow = {
  readonly text: string;
};

export type OperatorConsoleRawPromptSnapshot = {
  readonly prompt: string;
  readonly state: LineEditorState;
  readonly status?: StatusRailState;
  readonly terminal?: Partial<TerminalMetrics>;
  readonly overlayRows?: readonly OperatorConsoleRawPromptOverlayRow[];
  readonly attachments?: readonly AttachmentCardState[];
};

export type OperatorConsoleRawPromptFrame = {
  readonly rows: readonly string[];
  readonly cursorRow: number;
  readonly cursorColumn: number;
  readonly state: OperatorConsoleState;
};

const DEFAULT_TERMINAL: TerminalMetrics = {
  width: 80,
  height: 24,
  isTty: true,
};

export function buildOperatorConsoleStateFromRawPrompt(
  snapshot: OperatorConsoleRawPromptSnapshot
): OperatorConsoleState {
  const terminal = normalizeTerminal(snapshot.terminal);
  return createInitialOperatorConsoleState({
    terminal,
    prompt: {
      value: snapshot.state.text,
      cursorOffset: snapshot.state.cursor,
      multiline: snapshot.state.text.includes("\n"),
      scrollOffset: 0,
      mode: "prompt",
    },
    status: snapshot.status ?? createDefaultOperatorConsoleRawPromptStatus(),
    attachments: snapshot.attachments ?? [],
  });
}

export function buildOperatorConsoleRawPromptFrame(
  snapshot: OperatorConsoleRawPromptSnapshot
): OperatorConsoleRawPromptFrame {
  const state = buildOperatorConsoleStateFromRawPrompt(snapshot);
  const layout = createOperatorConsoleLayout(state, state.terminal);
  const renderedRows = renderOperatorConsoleTextLines(state, layout);
  const promptRegion = layout.regions.find((region) => region.kind === "prompt");
  const cursor = promptRegion === undefined
    ? { row: 0, column: 0 }
    : getPromptCursorPosition(state, promptRegion.y, promptRegion.height);

  return {
    rows: insertOverlayRowsBeforeStatus(renderedRows, snapshot.overlayRows ?? []),
    cursorRow: cursor.row,
    cursorColumn: cursor.column,
    state,
  };
}

export function buildOperatorConsoleRawPromptFrameWithRuntimeHost(
  host: OperatorConsoleRuntimeHost,
  snapshot: OperatorConsoleRawPromptSnapshot
): OperatorConsoleRawPromptFrame {
  const terminal = normalizeTerminal(snapshot.terminal);
  host.clear();
  host.setTerminal(terminal);
  host.setStatus(snapshot.status ?? createDefaultOperatorConsoleRawPromptStatus());
  host.setAttachments(snapshot.attachments ?? []);
  host.setPrompt({
    text: snapshot.state.text,
    cursorOffset: snapshot.state.cursor,
    multiline: snapshot.state.text.includes("\n"),
    scrollOffset: 0,
    mode: "prompt",
  });
  return rawPromptFrameFromRuntimeFrame(host.render(), snapshot.overlayRows ?? []);
}

export function createDefaultOperatorConsoleRawPromptStatus(): StatusRailState {
  return {
    model: {
      label: "",
      state: "idle",
    },
    context: {
      usedTokens: 0,
    },
    sessionTimer: {
      elapsedMs: 0,
    },
  };
}

function rawPromptFrameFromRuntimeFrame(
  frame: OperatorConsoleRuntimeFrame,
  overlayRows: readonly OperatorConsoleRawPromptOverlayRow[]
): OperatorConsoleRawPromptFrame {
  const promptRegion = frame.layout.regions.find((region) => region.kind === "prompt");
  const cursor = promptRegion === undefined
    ? { row: 0, column: 0 }
    : getPromptCursorPosition(frame.state, promptRegion.y, promptRegion.height);

  return {
    rows: insertOverlayRowsBeforeStatus(frame.lines, overlayRows),
    cursorRow: cursor.row,
    cursorColumn: cursor.column,
    state: frame.state,
  };
}

function insertOverlayRowsBeforeStatus(
  rows: readonly string[],
  overlayRows: readonly OperatorConsoleRawPromptOverlayRow[]
): readonly string[] {
  if (overlayRows.length === 0) return rows;
  if (rows.length === 0) return overlayRows.map((row) => row.text);
  const statusIndex = rows.length - 1;
  return [
    ...rows.slice(0, statusIndex),
    ...overlayRows.map((row) => row.text),
    ...rows.slice(statusIndex),
  ];
}

function getPromptCursorPosition(
  state: OperatorConsoleState,
  promptRegionY: number,
  promptRegionHeight: number
): { readonly row: number; readonly column: number } {
  if (promptRegionHeight < 3) return { row: promptRegionY, column: 0 };
  const metrics = getPromptSurfaceMetrics(state.prompt, {
    width: state.terminal.width,
    height: promptRegionHeight,
    terminalHeight: state.terminal.height,
  });
  const visibleCursorRow = Math.max(0, metrics.cursorRow - metrics.scrollOffset);
  return {
    row: promptRegionY + 1 + visibleCursorRow,
    column: 2 + promptLogicalCursorColumn(state.prompt.value, state.prompt.cursorOffset),
  };
}

function promptLogicalCursorColumn(value: string, cursorOffset: number): number {
  const cursor = clampInteger(cursorOffset, 0, value.length);
  const beforeCursor = value.slice(0, cursor);
  const currentLine = beforeCursor.split(/\r\n|\n|\r/u).at(-1) ?? "";
  return 2 + stringWidth(currentLine);
}

function normalizeTerminal(input: Partial<TerminalMetrics> | undefined): TerminalMetrics {
  return {
    width: normalizeDimension(input?.width, DEFAULT_TERMINAL.width),
    height: normalizeDimension(input?.height, DEFAULT_TERMINAL.height),
    isTty: input?.isTty ?? DEFAULT_TERMINAL.isTty,
  };
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
