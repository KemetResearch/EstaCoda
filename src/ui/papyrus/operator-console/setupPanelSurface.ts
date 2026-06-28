import { stringWidth } from "../screen/stringWidth.js";
import { closeOpenBidiIsolates, isolateLtr, isolateRtl } from "../../../ui/bidi.js";
import type {
  SecretEntryPanelState,
  SetupPanelState,
  SetupPanelStatusLine,
  SetupSurfaceState,
} from "./operatorConsoleState.js";
import { styleColor, type OperatorConsoleStyle } from "./operatorConsoleStyle.js";

export type SetupPanelRenderOptions = {
  readonly width: number;
  readonly height?: number;
  readonly style?: OperatorConsoleStyle;
};

const WIDE_TABLE_MIN_WIDTH = 72;

export function getSetupPanelSurfaceDesiredHeight(state: SetupSurfaceState, width: number): number {
  if (state.kind === "secret") return state.optional === true ? 9 : 11;
  const statusLineCount = state.statusLines?.length ?? 0;
  const navigationSeparatorCount = state.rows.some((row) => row.group === "navigation") ? 1 : 0;
  const baseRows = state.rows.length + navigationSeparatorCount + 8 + statusLineCount;
  return normalizeDimension(width) >= WIDE_TABLE_MIN_WIDTH
    ? Math.max(8, baseRows)
    : Math.max(8, state.rows.length * 4 + 5 + statusLineCount);
}

export function renderSetupPanelSurface(
  state: SetupSurfaceState,
  options: SetupPanelRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0) return [];
  const rows = state.kind === "secret"
    ? renderSecretEntryPanel(state, width, options.style)
    : renderSetupTablePanel(state, width, options.style);
  return options.height === undefined ? rows : rows.slice(0, normalizeDimension(options.height));
}

function renderSetupTablePanel(
  state: SetupPanelState,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const contentWidth = Math.max(0, width - 4);
  const copy = resolveSetupCopy(state.locale);
  const description = state.description ?? copy.modelDescription;
  const footer = state.footer ?? copy.footer;
  const rows = [
    renderSetupEditorTopBorder(width, style),
    renderContentRow(state.title, contentWidth, width),
    renderContentRow(description, contentWidth, width),
    ...renderStatusLines(state.statusLines, contentWidth, width, style),
    renderContentRow("", contentWidth, width),
    ...(width >= WIDE_TABLE_MIN_WIDTH
      ? state.layout === "choiceMenu"
        ? renderChoiceMenuRows(state, contentWidth, width, style)
        : renderWideTableRows(state, copy, contentWidth, width, style)
      : renderNarrowTableRows(state, contentWidth, width, style)),
    renderContentRow("", contentWidth, width),
    renderContentRow(styleFooter(footer, style), contentWidth, width),
    renderBottomBorder(width),
  ];
  return rows;
}

function renderChoiceMenuRows(
  state: SetupPanelState,
  contentWidth: number,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const markerWidth = 2;
  const gap = 2;
  const labelNaturalWidth = Math.max(
    10,
    ...state.rows.map((row) => stringWidth(row.provider))
  );
  const labelWidth = Math.min(Math.max(12, labelNaturalWidth), Math.max(12, Math.floor(contentWidth * 0.34)));
  const detailWidth = Math.max(1, contentWidth - labelWidth - markerWidth - gap * 2);
  const selectedMarker = state.locale === "ar" ? "◂" : "❯";
  const rows: string[] = [];
  let renderedNavigationSeparator = false;

  for (const row of state.rows) {
    if (row.group === "navigation" && !renderedNavigationSeparator && rows.length > 0) {
      rows.push(renderContentRow("", contentWidth, width));
      renderedNavigationSeparator = true;
    }

    const selected = row.id === state.selectedRowId;
    const marker = selected ? selectedMarker : "";
    const detail = choiceMenuDetail(row);
    const line = state.locale === "ar"
      ? [
        physicalChoiceCell(detail, detailWidth, "left", state.locale),
        " ".repeat(gap),
        physicalChoiceCell(row.provider, labelWidth, "right", state.locale),
        " ".repeat(gap),
        physicalChoiceCell(marker, markerWidth, "left", state.locale),
      ].join("")
      : [
        padVisibleEnd(marker, markerWidth),
        " ".repeat(gap),
        padVisibleEnd(row.provider, labelWidth),
        " ".repeat(gap),
        padVisibleEnd(detail, detailWidth),
      ].join("");
    rows.push(renderSelectedContentRow(line, selected, style, contentWidth, width));
  }

  return rows;
}

function styleSelectedChoiceRow(
  line: string,
  selected: boolean,
  style: OperatorConsoleStyle | undefined
): string {
  return selected && style !== undefined
    ? styleColor(style, line, style.tokens.contract.palette.action)
    : line;
}

function renderSelectedContentRow(
  row: string,
  selected: boolean,
  style: OperatorConsoleStyle | undefined,
  contentWidth: number,
  width: number
): string {
  if (!selected || style === undefined || width <= 3) {
    return renderContentRow(row, contentWidth, width);
  }
  const content = padVisibleEnd(truncateVisibleCells(row, contentWidth), contentWidth);
  return `│ ${styleSelectedChoiceRow(content, selected, style)} │`;
}

function physicalChoiceCell(
  value: string,
  width: number,
  align: "left" | "right",
  locale: SetupPanelState["locale"]
): string {
  const truncated = closeOpenBidiIsolates(truncateVisibleCells(value, width));
  const localized = locale === "ar" ? localizeChoiceCell(truncated) : truncated;
  const padded = align === "right"
    ? padVisibleStart(localized, width)
    : padVisibleEnd(localized, width);
  return locale === "ar" ? isolateLtr(padded) : padded;
}

function localizeChoiceCell(value: string): string {
  if (value.length === 0) return value;
  if (containsArabicScript(value)) {
    return isolateRtl(closeOpenBidiIsolates(value));
  }
  return /[A-Za-z0-9]/u.test(value)
    ? isolateLtr(value)
    : isolateRtl(closeOpenBidiIsolates(value));
}

function containsArabicScript(value: string): boolean {
  return /\p{Script=Arabic}/u.test(value);
}

function choiceMenuDetail(row: SetupPanelState["rows"][number]): string {
  if (row.notes.length === 0 || row.notes === row.status) return row.status;
  if (row.status.length === 0) return row.notes;
  return `${row.status} · ${row.notes}`;
}

function renderWideTableRows(
  state: SetupPanelState,
  copy: SetupCopy,
  contentWidth: number,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const markerWidth = 2;
  const providerWidth = Math.max(10, Math.floor(contentWidth * 0.2));
  const modelWidth = Math.max(14, Math.floor(contentWidth * 0.32));
  const statusWidth = Math.max(10, Math.floor(contentWidth * 0.18));
  const notesWidth = Math.max(6, contentWidth - markerWidth - providerWidth - modelWidth - statusWidth - 3);
  const header = [
    padVisibleEnd("", markerWidth),
    padVisibleEnd(copy.provider, providerWidth),
    padVisibleEnd(copy.model, modelWidth),
    padVisibleEnd(copy.status, statusWidth),
    padVisibleEnd(copy.notes, notesWidth),
  ].join(" ");
  const divider = "─".repeat(contentWidth);

  return [
    renderContentRow(header, contentWidth, width),
    renderContentRow(divider, contentWidth, width),
    ...state.rows.map((row) => {
      const selected = row.id === state.selectedRowId;
      const marker = selected ? "❯" : "";
      const line = [
        padVisibleEnd(marker, markerWidth),
        padVisibleEnd(row.provider, providerWidth),
        padVisibleEnd(row.model, modelWidth),
        padVisibleEnd(row.status, statusWidth),
        padVisibleEnd(row.notes, notesWidth),
      ].join(" ");
      return renderSelectedContentRow(line, selected, style, contentWidth, width);
    }),
  ];
}

function renderNarrowTableRows(
  state: SetupPanelState,
  contentWidth: number,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  return state.rows.flatMap((row) => {
    const selected = row.id === state.selectedRowId;
    const marker = selected ? "❯ " : "  ";
    return [
      renderSelectedContentRow(`${marker}${row.provider}`, selected, style, contentWidth, width),
      renderSelectedContentRow(`  ${row.model}`, selected, style, contentWidth, width),
      renderSelectedContentRow(`  ${row.status} · ${row.notes}`, selected, style, contentWidth, width),
      renderContentRow("", contentWidth, width),
    ];
  }).slice(0, Math.max(0, state.rows.length * 4 - 1));
}

function renderSecretEntryPanel(
  state: SecretEntryPanelState,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  const contentWidth = Math.max(0, width - 4);
  const value = state.optional === true && (state.maskedValue === undefined || state.maskedValue.length === 0)
    ? state.emptyLabel ?? "[leave empty]"
    : maskSecretValue(state);
  const rows = [
    renderSetupEditorTopBorder(width, style),
    renderContentRow(state.title, contentWidth, width),
    renderContentRow(state.description, contentWidth, width),
    renderContentRow("", contentWidth, width),
    renderContentRow(value, contentWidth, width),
    renderContentRow("", contentWidth, width),
  ];

  if (state.envVar !== undefined && state.envVar.length > 0) {
    rows.push(renderContentRow(`Stored as: ${state.envVar}`, contentWidth, width));
    rows.push(renderContentRow("", contentWidth, width));
  }

  rows.push(renderContentRow(styleFooter(state.footer, style), contentWidth, width));
  rows.push(renderBottomBorder(width));
  return rows;
}

function maskSecretValue(state: SecretEntryPanelState): string {
  if (state.maskedValue !== undefined && state.maskedValue.length > 0) return state.maskedValue;
  const rawWidth = state.rawValue === undefined ? 0 : stringWidth(state.rawValue);
  return "•".repeat(Math.max(8, Math.min(64, rawWidth)));
}

type SetupCopy = {
  readonly provider: string;
  readonly model: string;
  readonly status: string;
  readonly notes: string;
  readonly modelDescription: string;
  readonly footer: string;
};

function resolveSetupCopy(locale: SetupPanelState["locale"]): SetupCopy {
  if (locale === "ar") {
    return {
      provider: "المزود",
      model: "النموذج",
      status: "الحالة",
      notes: "ملاحظات",
      modelDescription: "اختر مزود النموذج والمسار النشط.",
      footer: "↑↓ تنقل · Enter اختيار · / بحث · Esc رجوع",
    };
  }
  return {
    provider: "Provider",
    model: "Model",
    status: "Status",
    notes: "Notes",
    modelDescription: "Choose the active provider and model route.",
    footer: "↑↓ navigate · Enter select · / filter · Esc back",
  };
}

function renderSetupEditorTopBorder(width: number, style: OperatorConsoleStyle | undefined): string {
  return renderTopBorder(styleBrand("𓂀  Setup Editor", style), width);
}

function renderTopBorder(title: string, width: number): string {
  if (width <= 1) return "╭".slice(0, width);
  const label = `──── ${title} `;
  const remaining = Math.max(0, width - 2 - stringWidth(label));
  return truncateVisibleCells(`╭${label}${"─".repeat(remaining)}╮`, width);
}

function renderBottomBorder(width: number): string {
  if (width <= 1) return "╰".slice(0, width);
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

function renderContentRow(row: string, contentWidth: number, width: number): string {
  if (width <= 1) return "│".slice(0, width);
  const content = padVisibleEnd(truncateVisibleCells(row, contentWidth), contentWidth);
  return truncateVisibleCells(`│ ${content} │`, width);
}

function renderStatusLines(
  statusLines: readonly SetupPanelStatusLine[] | undefined,
  contentWidth: number,
  width: number,
  style: OperatorConsoleStyle | undefined
): readonly string[] {
  return (statusLines ?? []).map((line) => {
    const localized = line.direction === "rtl" ? isolateRtl(line.text) : line.text;
    return renderContentRow(styleStatusLine(localized, line, style), contentWidth, width);
  });
}

function styleStatusLine(
  text: string,
  line: SetupPanelStatusLine,
  style: OperatorConsoleStyle | undefined
): string {
  const tokens = style?.tokens.contract;
  if (tokens === undefined) return text;
  if (line.tone === "active") return styleColor(style, text, tokens.severity.ok);
  if (line.tone === "warning") return styleColor(style, text, tokens.severity.warn);
  if (line.tone === "muted") return styleColor(style, text, tokens.text.secondary);
  return text;
}

function styleBrand(text: string, style: OperatorConsoleStyle | undefined): string {
  const brand = style?.tokens.contract.palette.brand;
  return brand === undefined ? text : styleColor(style, text, brand);
}

function styleFooter(text: string, style: OperatorConsoleStyle | undefined): string {
  const secondary = style?.tokens.contract.text.secondary;
  return secondary === undefined ? text : styleColor(style, text, secondary);
}

function padVisibleEnd(value: string, width: number): string {
  const truncated = truncateVisibleCells(value, width);
  const padCells = Math.max(0, width - stringWidth(truncated));
  return `${truncated}${" ".repeat(padCells)}`;
}

function padVisibleStart(value: string, width: number): string {
  const truncated = truncateVisibleCells(value, width);
  const padCells = Math.max(0, width - stringWidth(truncated));
  return `${" ".repeat(padCells)}${truncated}`;
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
