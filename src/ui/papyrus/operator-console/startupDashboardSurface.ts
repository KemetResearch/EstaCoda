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
  const session = renderInnerBox("Runtime", sessionRows(state, style), leftWidth, style);
  const commands = renderInnerBox("Commands", commandRows(state.commands), rightWidth, style);
  const boxHeight = Math.max(session.length, commands.length);
  const output = [
    centerText(styleColor(style, styleBold(style, state.productName), style?.tokens.contract.palette.brand ?? ""), width),
    centerText(`☥ ${state.orgName} ☥`, width),
    renderTopBorder(`${state.version}  𓂀  session ${state.sessionId}`, width),
  ];

  for (let index = 0; index < boxHeight; index += 1) {
    output.push(renderOuterRow(
      `${session[index] ?? padVisibleEnd("", leftWidth)}${" ".repeat(gapWidth)}${commands[index] ?? padVisibleEnd("", rightWidth)}`,
      bodyWidth,
      width
    ));
  }

  output.push(renderOuterRow("", bodyWidth, width));
  output.push(renderOuterRow("Tips", bodyWidth, width));
  for (const tip of state.tips.slice(0, 2)) output.push(renderOuterRow(tip, bodyWidth, width));
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
    centerText(styleColor(style, styleBold(style, state.productName), style?.tokens.contract.palette.brand ?? ""), width),
    centerText(`☥ ${state.orgName} ☥`, width),
    renderTopBorder(`${state.version}  𓂀  session ${state.sessionId}`, width),
  ];
  for (const row of renderInnerBox("Runtime", sessionRows(state, style).slice(0, 4), bodyWidth, style)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  for (const row of renderInnerBox("Commands", commandRows(state.commands).slice(0, 4), bodyWidth, style)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  output.push(renderOuterRow("", bodyWidth, width));
  output.push(renderOuterRow("Tips", bodyWidth, width));
  if (state.tips[0] !== undefined) output.push(renderOuterRow(state.tips[0], bodyWidth, width));
  output.push(renderBottomBorder(width));
  return output;
}

function sessionRows(
  state: StartupDashboardState,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  return [
    formatKeyValue("model", formatModelValue(state.session.model, state.session.modelRoute, style)),
    formatKeyValue("context", state.session.context),
    formatKeyValue("workspace", state.session.workspace),
    formatKeyValue("approval", state.session.security),
    formatKeyValue("autonomy", state.session.autonomy),
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

function renderTopBorder(labelText: string, width: number): string {
  if (width <= 1) return "╭".slice(0, width);
  const label = ` ${labelText} `;
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
  const styledTitle = styleColor(style, title, style?.tokens.contract.text.secondary ?? "");
  const label = `─ ${styledTitle} `;
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
  if (width <= 0) return "";
  const content = padVisibleEnd(truncateVisibleCells(row, contentWidth), contentWidth);
  return truncateVisibleCells(`  ${content}`, width);
}

function centerText(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateVisibleCells(text, width);
  const pad = Math.max(0, Math.floor((width - stringWidth(truncated)) / 2));
  return truncateVisibleCells(`${" ".repeat(pad)}${truncated}`, width);
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
