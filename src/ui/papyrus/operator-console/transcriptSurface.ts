import {
  truncateVisible,
  wrapText,
} from "../../renderers/layout.js";
import { stringWidth } from "../screen/stringWidth.js";
import { renderAssistantMessageFrame } from "./assistantMessageFrame.js";
import type { TranscriptBlock } from "./operatorConsoleState.js";
import type { OperatorConsoleStyle } from "./operatorConsoleStyle.js";

export type TranscriptSurfaceRenderOptions = {
  readonly width: number;
  readonly height?: number;
  readonly style?: OperatorConsoleStyle;
};

const ROLE_LABELS: Record<TranscriptBlock["role"], string> = {
  startup: "Startup",
  user: "User",
  assistant: "Assistant",
  system: "System",
  tool: "Tool",
  approval: "Approval",
  summary: "Summary",
};

export function getTranscriptSurfaceDesiredHeight(
  transcript: readonly TranscriptBlock[],
  width: number
): number {
  if (transcript.length === 0) return 0;
  return renderTranscriptRows(transcript, normalizeDimension(width)).length;
}

export function renderTranscriptSurface(
  transcript: readonly TranscriptBlock[],
  options: TranscriptSurfaceRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0 || transcript.length === 0) return [];

  const rows = renderTranscriptRows(transcript, width, options.style);
  const height = normalizeDimension(options.height ?? rows.length);
  if (height <= 0) return [];
  return renderLatestTranscriptRows(transcript, width, height, options.style);
}

function renderTranscriptRows(
  transcript: readonly TranscriptBlock[],
  width: number,
  style?: OperatorConsoleStyle
): readonly string[] {
  if (width <= 0) return [];
  return transcript.flatMap((block) => renderTranscriptBlockRows(block, width, undefined, style));
}

function renderTranscriptBlockRows(
  block: TranscriptBlock,
  width: number,
  height?: number,
  style?: OperatorConsoleStyle
): readonly string[] {
  if (block.role === "assistant") {
    return renderAssistantMessageFrame({
      lines: normalizeTranscriptText(block.text),
      toolTrail: block.toolTrail,
    }, {
      width,
      height,
      style,
    });
  }

  const label = `${ROLE_LABELS[block.role] ?? block.role}`;
  const prefix = `${label} │ `;
  const continuationPrefix = `${" ".repeat(stringWidth(label))} │ `;
  const contentWidth = Math.max(1, width - stringWidth(prefix));
  const lines = normalizeTranscriptText(block.text).flatMap((line) => wrapText(line, contentWidth));
  if (lines.length === 0) return [truncateVisible(prefix.trimEnd(), width)];
  return lines.map((line, index) => truncateVisible(`${index === 0 ? prefix : continuationPrefix}${line}`, width));
}

function renderLatestTranscriptRows(
  transcript: readonly TranscriptBlock[],
  width: number,
  height: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const selected: string[][] = [];
  let remaining = height;

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const fullRows = renderTranscriptBlockRows(transcript[index]!, width, undefined, style);
    const rows = selected.length === 0 && fullRows.length > remaining
      ? renderTranscriptBlockRows(transcript[index]!, width, remaining, style)
      : fullRows;
    if (rows.length === 0) continue;
    if (rows.length > remaining) {
      if (selected.length === 0) {
        return rows.slice(Math.max(0, rows.length - height));
      }
      break;
    }
    selected.unshift([...rows]);
    remaining -= rows.length;
    if (remaining <= 0) break;
  }

  return selected.flat();
}

function normalizeTranscriptText(text: string): readonly string[] {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  return lines.length === 0 ? [""] : lines;
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
