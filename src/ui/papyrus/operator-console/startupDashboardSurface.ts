import { stringWidth } from "../screen/stringWidth.js";
import { closeOpenBidiIsolates, isolateLtr } from "../../bidi.js";
import type { UiLocale } from "../../cli-ui-copy.js";
import { padVisibleEnd, truncateVisible } from "../../renderers/layout.js";
import type { StartupCommandState, StartupDashboardState } from "./operatorConsoleState.js";
import { styleBold, styleColor, type OperatorConsoleStyle } from "./operatorConsoleStyle.js";

export type StartupDashboardRenderOptions = {
  readonly width: number;
  readonly height?: number;
  readonly locale?: UiLocale;
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
    ? Math.max(7, Math.max(sessionRows(state, "en", undefined).length, commandRows(state.commands, "en").length) + 2)
    : sessionRows(state, "en", undefined).length + commandRows(state.commands, "en").length + 6;
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
  const locale = options.locale ?? "en";
  const rows = width >= WIDE_LAYOUT_MIN_WIDTH
    ? renderWideStartupDashboard(state, width, locale, options.style)
    : renderNarrowStartupDashboard(state, width, locale, options.style);
  const height = options.height === undefined ? rows.length : normalizeDimension(options.height);
  const visibleRows = rows.slice(0, height);
  return locale === "ar" ? visibleRows.map(stabilizeTerminalBidiLine) : visibleRows;
}

function renderWideStartupDashboard(
  state: StartupDashboardState,
  width: number,
  locale: UiLocale,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const bodyWidth = Math.max(0, width - 4);
  const gapWidth = 2;
  const leftWidth = Math.max(3, Math.floor((bodyWidth - gapWidth) / 2));
  const rightWidth = Math.max(3, bodyWidth - leftWidth - gapWidth);
  const session = renderInnerBox(startupLabel(locale, "Session", "الجلسة"), sessionRows(state, locale, style), rightWidth, style);
  const commands = renderInnerBox(startupLabel(locale, "Commands", "الأوامر"), commandRows(state.commands, locale), leftWidth, style);
  const leftBox = locale === "ar" ? commands : renderInnerBox(startupLabel(locale, "Session", "الجلسة"), sessionRows(state, locale, style), leftWidth, style);
  const rightBox = locale === "ar" ? session : renderInnerBox(startupLabel(locale, "Commands", "الأوامر"), commandRows(state.commands, locale), rightWidth, style);
  const boxHeight = Math.max(leftBox.length, rightBox.length);
  const output = [
    renderTopBorder(`${state.productName}  𓂀  ${state.version}`, width, style),
  ];

  for (let index = 0; index < boxHeight; index += 1) {
    output.push(renderOuterRow(
      `${leftBox[index] ?? padVisibleEnd("", leftWidth)}${" ".repeat(gapWidth)}${rightBox[index] ?? padVisibleEnd("", rightWidth)}`,
      bodyWidth,
      width
    ));
  }

  output.push(renderOuterRow("", bodyWidth, width));
  for (const row of renderInfoColumns(state, locale, leftWidth, rightWidth, gapWidth, bodyWidth, width, style)) {
    output.push(row);
  }
  output.push(renderOuterRow(styleSecondaryText(`☥ ${state.orgName} ☥`, style), bodyWidth, width));
  output.push(renderBottomBorder(width));
  return output;
}

function renderNarrowStartupDashboard(
  state: StartupDashboardState,
  width: number,
  locale: UiLocale,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const bodyWidth = Math.max(0, width - 4);
  const output = [
    renderTopBorder(`${state.productName}  𓂀  ${state.version}`, width, style),
  ];
  for (const row of renderInnerBox(startupLabel(locale, "Session", "الجلسة"), sessionRows(state, locale, style).slice(0, 4), bodyWidth, style)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  for (const row of renderInnerBox(startupLabel(locale, "Commands", "الأوامر"), commandRows(state.commands, locale).slice(0, 4), bodyWidth, style)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  output.push(renderOuterRow("", bodyWidth, width));
  output.push(renderOuterRow(styleSectionLabel(startupLabel(locale, "Update", "التحديث"), style), bodyWidth, width));
  for (const row of updateRows(state, locale).slice(0, 2)) {
    output.push(renderOuterRow(row, bodyWidth, width));
  }
  output.push(renderOuterRow(styleSectionLabel(startupLabel(locale, "Tips", "تلميحات"), style), bodyWidth, width));
  if (tipRows(state, locale)[0] !== undefined) output.push(renderOuterRow(tipRows(state, locale)[0], bodyWidth, width));
  output.push(renderOuterRow(styleSecondaryText(`☥ ${state.orgName} ☥`, style), bodyWidth, width));
  output.push(renderBottomBorder(width));
  return output;
}

function sessionRows(
  state: StartupDashboardState,
  locale: UiLocale,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const labels = locale === "ar"
    ? {
      model: "النموذج",
      session: "الجلسة",
      workspace: "مساحة العمل",
      security: "الأمان",
      evolution: "التطوّر",
    }
    : {
      model: "model",
      session: "session",
      workspace: "workspace",
      security: "security",
      evolution: "evolution",
    };
  return [
    formatKeyValue(labels.model, formatModelValue(state.session.model, state.session.modelRoute, locale, style)),
    formatKeyValue(labels.session, localizeTechnicalValue(state.sessionId, locale)),
    formatKeyValue(labels.workspace, localizeTechnicalValue(state.session.workspace, locale)),
    formatKeyValue(labels.security, localizeSecurityValue(state.session.security, locale)),
    formatKeyValue(labels.evolution, localizeEvolutionValue(state.session.autonomy, locale)),
  ];
}

function commandRows(commands: readonly StartupCommandState[], locale: UiLocale): readonly string[] {
  return commands.map((command) => formatKeyValue(
    localizeTechnicalValue(command.command, locale),
    localizeCommandDescription(command, locale)
  ));
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
  locale: UiLocale,
  leftWidth: number,
  rightWidth: number,
  gapWidth: number,
  bodyWidth: number,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const update = [
    styleSectionLabel(startupLabel(locale, "Update", "التحديث"), style),
    ...updateRows(state, locale),
  ];
  const tips = [
    styleSectionLabel(startupLabel(locale, "Tips", "تلميحات"), style),
    ...tipRows(state, locale).slice(0, 2),
  ];
  const leftRows = update;
  const rightRows = tips;
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

function startupLabel(locale: UiLocale, english: string, arabic: string): string {
  return locale === "ar" ? arabic : english;
}

function localizeTechnicalValue(value: string, locale: UiLocale): string {
  return locale === "ar" ? isolateLtr(value) : value;
}

function localizeCommandDescription(command: StartupCommandState, locale: UiLocale): string {
  if (locale !== "ar") return command.description;
  switch (command.command) {
    case "/tools":
      return "فحص الأدوات";
    case "/skills":
      return "المهارات المحمّلة";
    case "/model":
      return "تغيير النموذج الأساسي";
    case "/status":
      return "حالة التشغيل";
    case "/compact":
      return "ضغط سياق الجلسة";
    default:
      return command.description;
  }
}

function localizeSecurityValue(value: string, locale: UiLocale): string {
  if (locale !== "ar") return value;
  switch (value.toLowerCase()) {
    case "open":
      return "مفتوح";
    case "adaptive":
      return "تكيفي";
    case "strict":
    case "high":
      return "صارم";
    default:
      return value;
  }
}

function localizeEvolutionValue(value: string, locale: UiLocale): string {
  if (locale !== "ar") return value;
  switch (value.toLowerCase()) {
    case "autonomous":
      return "تلقائي";
    case "proactive":
      return "استباقي";
    case "suggest":
      return "اقتراح";
    case "manual":
      return "يدوي";
    case "off":
      return "متوقف";
    default:
      return value;
  }
}

function updateRows(state: StartupDashboardState, locale: UiLocale): readonly string[] {
  const status = state.updateStatus ?? "Unknown.";
  if (locale !== "ar") return [status];
  switch (status) {
    case "Up to date.":
      return ["محدّث."];
    case "Update available.":
      return ["يوجد تحديث متاح.", `شغّل ${isolateLtr("estacoda update")}.`];
    case "Unknown.":
      return ["حالة التحديث غير معروفة."];
    default:
      return [status];
  }
}

function tipRows(state: StartupDashboardState, locale: UiLocale): readonly string[] {
  if (locale !== "ar") return state.tips;
  return [
    "الصق السياق الكبير كمرفقات.",
    `استخدم ${isolateLtr("/model")} لتغيير المسارات.`,
  ];
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
  locale: UiLocale,
  style: OperatorConsoleStyle | undefined
): string {
  const match = value.trimEnd().match(/^(.*?)([●◐○])$/u);
  if (match === null) return localizeTechnicalValue(value, locale);
  const color = modelRouteColor(route, style);
  const model = localizeTechnicalValue(match[1].trimEnd(), locale);
  const dot = color === undefined ? match[2] : styleColor(style, match[2], color);
  return `${model} ${dot}`;
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

  return closeOpenBidiIsolates(truncateVisible(value, width, ""));
}

function stabilizeTerminalBidiLine(value: string): string {
  return isolateLtr(closeOpenBidiIsolates(value));
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
