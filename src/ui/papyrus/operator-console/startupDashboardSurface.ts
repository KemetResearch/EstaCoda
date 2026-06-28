import { stringWidth } from "../screen/stringWidth.js";
import type { StartupCommandState, StartupDashboardState } from "./operatorConsoleState.js";

export type StartupDashboardRenderOptions = {
  readonly width: number;
  readonly height?: number;
};

const WIDE_LAYOUT_MIN_WIDTH = 72;

export function createDefaultStartupDashboardState(): StartupDashboardState {
  return {
    productName: "EstaCoda",
    orgName: "Kemet Research",
    tagline: "sovereign agentic infrastructure",
    version: "v0.1.0",
    sessionId: "pending",
    session: {
      model: "model pending",
      context: "0",
      workspace: "unknown",
      security: "adaptive",
      autonomy: "manual",
    },
    commands: [
      { command: "/tools", description: "inspect tools" },
      { command: "/skills", description: "loaded skills" },
      { command: "/model", description: "active model route" },
      { command: "/status", description: "runtime state" },
      { command: "/setup", description: "setup editor" },
    ],
    tips: ["Paste large context as attachments.", "Use /model to switch routes."],
  };
}

export function getStartupDashboardSurfaceDesiredHeight(
  state: StartupDashboardState,
  width: number
): number {
  const normalizedWidth = normalizeDimension(width);
  const panelRows = normalizedWidth >= WIDE_LAYOUT_MIN_WIDTH
    ? Math.max(7, Math.max(sessionRows(state).length, commandRows(state.commands).length) + 2)
    : sessionRows(state).length + commandRows(state.commands).length + 6;
  return 4 + panelRows + Math.min(Math.max(1, state.tips.length), normalizedWidth >= WIDE_LAYOUT_MIN_WIDTH ? 3 : 2) + 3;
}

export function renderStartupDashboardSurface(
  input: StartupDashboardState | undefined,
  options: StartupDashboardRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0) return [];

  const state = input ?? createDefaultStartupDashboardState();
  const rows = width >= WIDE_LAYOUT_MIN_WIDTH
    ? renderWideStartupDashboard(state, width)
    : renderNarrowStartupDashboard(state, width);
  const height = options.height === undefined ? rows.length : normalizeDimension(options.height);
  return rows.slice(0, height);
}

function renderWideStartupDashboard(state: StartupDashboardState, width: number): readonly string[] {
  const bodyWidth = Math.max(0, width - 4);
  const leftWidth = Math.max(3, Math.floor((bodyWidth - 1) / 2));
  const rightWidth = Math.max(3, bodyWidth - leftWidth - 1);
  const session = renderInnerBox("Session", sessionRows(state), leftWidth);
  const commands = renderInnerBox("Commands", commandRows(state.commands), rightWidth);
  const boxHeight = Math.max(session.length, commands.length);
  const output = [
    centerText(state.productName, width),
    centerText(`𓋹 ${state.orgName} 𓋹`, width),
    centerText(state.tagline, width),
    centerMarker(`${state.version}  ☂ session ${state.sessionId}`, width),
    renderTopBorder(width),
  ];

  for (let index = 0; index < boxHeight; index += 1) {
    output.push(renderOuterRow(`${session[index] ?? padVisibleEnd("", leftWidth)} ${commands[index] ?? padVisibleEnd("", rightWidth)}`, bodyWidth, width));
  }

  output.push(renderOuterRow("", bodyWidth, width));
  output.push(renderOuterRow("Tips", bodyWidth, width));
  for (const tip of state.tips.slice(0, 2)) output.push(renderOuterRow(tip, bodyWidth, width));
  output.push(renderBottomBorder(width));
  return output;
}

function renderNarrowStartupDashboard(state: StartupDashboardState, width: number): readonly string[] {
  const bodyWidth = Math.max(0, width - 4);
  const output = [
    centerText(state.productName, width),
    centerText(state.orgName, width),
    centerText(state.tagline, width),
    truncateVisibleCells(`${state.version} · session ${state.sessionId}`, width),
    renderTopBorder(width),
  ];
  for (const row of renderInnerBox("Session", sessionRows(state).slice(0, 4), bodyWidth)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  for (const row of renderInnerBox("Commands", commandRows(state.commands).slice(0, 4), bodyWidth)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  output.push(renderOuterRow("", bodyWidth, width));
  output.push(renderOuterRow("Tips", bodyWidth, width));
  if (state.tips[0] !== undefined) output.push(renderOuterRow(state.tips[0], bodyWidth, width));
  output.push(renderBottomBorder(width));
  return output;
}

function sessionRows(state: StartupDashboardState): readonly string[] {
  return [
    formatKeyValue("model", state.session.model),
    formatKeyValue("context", state.session.context),
    formatKeyValue("workspace", state.session.workspace),
    formatKeyValue("security", state.session.security),
    formatKeyValue("autonomy", state.session.autonomy),
  ];
}

function commandRows(commands: readonly StartupCommandState[]): readonly string[] {
  return commands.map((command) => formatKeyValue(command.command, command.description));
}

function formatKeyValue(key: string, value: string): string {
  return `${padVisibleEnd(key, 11)}${value}`;
}

function renderInnerBox(title: string, rows: readonly string[], width: number): readonly string[] {
  if (width <= 0) return [];
  if (width < 3) return [truncateVisibleCells(title, width)];
  const contentWidth = Math.max(0, width - 4);
  return [
    renderTitledTopBorder(title, width),
    ...rows.map((row) => renderContentRow(row, contentWidth, width)),
    renderInnerBottomBorder(width),
  ];
}

function renderTopBorder(width: number): string {
  if (width <= 1) return "╭".slice(0, width);
  return `╭${"─".repeat(Math.max(0, width - 2))}╮`;
}

function renderBottomBorder(width: number): string {
  if (width <= 1) return "╰".slice(0, width);
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

function renderTitledTopBorder(title: string, width: number): string {
  if (width <= 1) return "╭".slice(0, width);
  const label = `─ ${title} `;
  const remaining = Math.max(0, width - 2 - stringWidth(label));
  return truncateVisibleCells(`╭${label}${"─".repeat(remaining)}╮`, width);
}

function renderInnerBottomBorder(width: number): string {
  if (width <= 1) return "╰".slice(0, width);
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

function renderContentRow(row: string, contentWidth: number, width: number): string {
  if (width <= 1) return "│".slice(0, width);
  const content = padVisibleEnd(truncateVisibleCells(row, contentWidth), contentWidth);
  return truncateVisibleCells(`│ ${content} │`, width);
}

function renderOuterRow(row: string, contentWidth: number, width: number): string {
  if (width <= 1) return "│".slice(0, width);
  const content = padVisibleEnd(truncateVisibleCells(row, contentWidth), contentWidth);
  return truncateVisibleCells(`│ ${content} │`, width);
}

function centerMarker(text: string, width: number): string {
  if (width <= 0) return "";
  const label = ` ${text} `;
  const side = Math.max(0, Math.floor((width - stringWidth(label)) / 2));
  return truncateVisibleCells(`${"─".repeat(side)}${label}${"─".repeat(Math.max(0, width - side - stringWidth(label)))}`, width);
}

function centerText(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateVisibleCells(text, width);
  const pad = Math.max(0, Math.floor((width - stringWidth(truncated)) / 2));
  return truncateVisibleCells(`${" ".repeat(pad)}${truncated}`, width);
}

function padVisibleEnd(value: string, width: number): string {
  const padCells = Math.max(0, width - stringWidth(value));
  return `${value}${" ".repeat(padCells)}`;
}

function truncateVisibleCells(value: string, maxCells: number): string {
  const width = normalizeDimension(maxCells);
  if (width <= 0) return "";
  if (stringWidth(value) <= width) return value;

  let output = "";
  for (const char of value) {
    if (stringWidth(output + char) > width) break;
    output += char;
  }
  return output;
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
