import { stringWidth } from "../screen/stringWidth.js";
import { padVisibleEnd, truncateVisible } from "../../renderers/layout.js";
import type { StartupCommandState, StartupDashboardState } from "./operatorConsoleState.js";
import { styleBold, styleColor, type OperatorConsoleStyle } from "./operatorConsoleStyle.js";

export type StartupDashboardRenderOptions = {
  readonly width: number;
  readonly height?: number;
  readonly style?: OperatorConsoleStyle;
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
    updateStatus: "Unknown.",
    commands: [
      { command: "/tools", description: "inspect tools" },
      { command: "/skills", description: "loaded skills" },
      { command: "/model", description: "switch primary model" },
      { command: "/status", description: "runtime state" },
      { command: "/compact", description: "compact session context" },
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
    ? Math.max(7, Math.max(sessionRows(state, undefined).length, commandRows(state.commands).length) + 2)
    : sessionRows(state, undefined).length + commandRows(state.commands).length + 6;
  const infoRows = normalizedWidth >= WIDE_LAYOUT_MIN_WIDTH ? 3 : 4;
  return 1 + panelRows + 1 + infoRows + 2;
}

export function renderStartupDashboardSurface(
  input: StartupDashboardState | undefined,
  options: StartupDashboardRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0) return [];

  const state = input ?? createDefaultStartupDashboardState();
  const rows = width >= WIDE_LAYOUT_MIN_WIDTH
    ? renderWideStartupDashboard(state, width, options.style)
    : renderNarrowStartupDashboard(state, width, options.style);
  const height = options.height === undefined ? rows.length : normalizeDimension(options.height);
  return rows.slice(0, height);
}

function renderWideStartupDashboard(
  state: StartupDashboardState,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const bodyWidth = Math.max(0, width - 4);
  const gapWidth = 2;
  const leftWidth = Math.max(3, Math.floor((bodyWidth - gapWidth) / 2));
  const rightWidth = Math.max(3, bodyWidth - leftWidth - gapWidth);
  const session = renderInnerBox("Session", sessionRows(state, style), leftWidth, style);
  const commands = renderInnerBox("Commands", commandRows(state.commands), rightWidth, style);
  const boxHeight = Math.max(session.length, commands.length);
  const output = [
    renderTopBorder(`${state.productName}  𓂀  ${state.version}`, width, style),
  ];

  for (let index = 0; index < boxHeight; index += 1) {
    output.push(renderOuterRow(
      `${session[index] ?? padVisibleEnd("", leftWidth)}${" ".repeat(gapWidth)}${commands[index] ?? padVisibleEnd("", rightWidth)}`,
      bodyWidth,
      width
    ));
  }

  output.push(renderOuterRow("", bodyWidth, width));
  for (const row of renderInfoColumns(state, leftWidth, rightWidth, gapWidth, bodyWidth, width, style)) {
    output.push(row);
  }
  output.push(renderOuterRow(styleSecondaryText(`☥ ${state.orgName} ☥`, style), bodyWidth, width));
  output.push(renderBottomBorder(width));
  return output;
}

function renderNarrowStartupDashboard(
  state: StartupDashboardState,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const bodyWidth = Math.max(0, width - 4);
  const output = [
    renderTopBorder(`${state.productName}  𓂀  ${state.version}`, width, style),
  ];
  for (const row of renderInnerBox("Session", sessionRows(state, style).slice(0, 4), bodyWidth, style)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  for (const row of renderInnerBox("Commands", commandRows(state.commands).slice(0, 4), bodyWidth, style)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  output.push(renderOuterRow("", bodyWidth, width));
  output.push(renderOuterRow(styleSectionLabel("Update", style), bodyWidth, width));
  output.push(renderOuterRow(state.updateStatus ?? "Unknown.", bodyWidth, width));
  output.push(renderOuterRow(styleSectionLabel("Tips", style), bodyWidth, width));
  if (state.tips[0] !== undefined) output.push(renderOuterRow(state.tips[0], bodyWidth, width));
  output.push(renderOuterRow(styleSecondaryText(`☥ ${state.orgName} ☥`, style), bodyWidth, width));
  output.push(renderBottomBorder(width));
  return output;
}

function sessionRows(
  state: StartupDashboardState,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  return [
    formatKeyValue("model", formatModelValue(state.session.model, state.session.modelRoute, style)),
    formatKeyValue("session", state.sessionId),
    formatKeyValue("workspace", state.session.workspace),
    formatKeyValue("security", state.session.security),
    formatKeyValue("evolution", state.session.autonomy),
  ];
}

function commandRows(commands: readonly StartupCommandState[]): readonly string[] {
  return commands.map((command) => formatKeyValue(command.command, command.description));
}

function formatKeyValue(key: string, value: string): string {
  return `${padVisibleEnd(key, 11)}${value}`;
}

function renderInnerBox(
  title: string,
  rows: readonly string[],
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  if (width <= 0) return [];
  if (width < 3) return [truncateVisibleCells(title, width)];
  const contentWidth = Math.max(0, width - 4);
  return [
    renderTitledTopBorder(title, width, style),
    ...rows.map((row) => renderContentRow(row, contentWidth, width)),
    renderInnerBottomBorder(width),
  ];
}

function renderInfoColumns(
  state: StartupDashboardState,
  leftWidth: number,
  rightWidth: number,
  gapWidth: number,
  bodyWidth: number,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const leftRows = [
    styleSectionLabel("Update", style),
    state.updateStatus ?? "Unknown.",
  ];
  const rightRows = [
    styleSectionLabel("Tips", style),
    ...state.tips.slice(0, 2),
  ];
  const rowCount = Math.max(leftRows.length, rightRows.length);
  return Array.from({ length: rowCount }, (_, index) => renderOuterRow(
    `${padVisibleEnd(leftRows[index] ?? "", leftWidth)}${" ".repeat(gapWidth)}${padVisibleEnd(rightRows[index] ?? "", rightWidth)}`,
    bodyWidth,
    width
  ));
}

function renderTopBorder(
  labelText: string,
  width: number,
  style: OperatorConsoleStyle | undefined
): string {
  if (width <= 1) return "╭".slice(0, width);
  const styledLabel = styleColor(style, styleBold(style, labelText), style?.tokens.contract.palette.brand ?? "");
  const label = ` ${styledLabel} `;
  const remaining = Math.max(0, width - 2 - stringWidth(label));
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return truncateVisibleCells(`╭${"─".repeat(left)}${label}${"─".repeat(right)}╮`, width);
}

function renderBottomBorder(width: number): string {
  if (width <= 1) return "╰".slice(0, width);
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

function renderTitledTopBorder(title: string, width: number, style: OperatorConsoleStyle | undefined): string {
  if (width <= 1) return "╭".slice(0, width);
  const styledTitle = styleSectionLabel(title, style);
  const label = `─ ${styledTitle} `;
  const remaining = Math.max(0, width - 2 - stringWidth(label));
  return truncateVisibleCells(`╭${label}${"─".repeat(remaining)}╮`, width);
}

function styleSectionLabel(title: string, style: OperatorConsoleStyle | undefined): string {
  return styleColor(style, title, style?.tokens.contract.palette.accent ?? "");
}

function styleSecondaryText(text: string, style: OperatorConsoleStyle | undefined): string {
  return styleColor(style, text, style?.tokens.contract.text.secondary ?? "");
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
  if (width <= 0) return "";
  const content = padVisibleEnd(truncateVisibleCells(row, contentWidth), contentWidth);
  return truncateVisibleCells(`  ${content}`, width);
}

function formatModelValue(
  value: string,
  route: StartupDashboardState["session"]["modelRoute"],
  style: OperatorConsoleStyle | undefined
): string {
  const match = value.trimEnd().match(/^(.*?)([●◐○])$/u);
  if (match === null) return value;
  const color = modelRouteColor(route, style);
  return `${match[1]}${color === undefined ? match[2] : styleColor(style, match[2], color)}`;
}

function modelRouteColor(
  route: StartupDashboardState["session"]["modelRoute"],
  style: OperatorConsoleStyle | undefined
): string | undefined {
  const tokens = style?.tokens.contract;
  if (tokens === undefined) return undefined;
  if (route === "fallback") return tokens.palette.caution;
  if (route === "failed") return tokens.severity.warn;
  return tokens.severity.ok;
}

function truncateVisibleCells(value: string, maxCells: number): string {
  const width = normalizeDimension(maxCells);
  if (width <= 0) return "";
  if (stringWidth(value) <= width) return value;

  return truncateVisible(value, width, "");
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
