import { stringWidth } from "../screen/stringWidth.js";
import type {
  SecretEntryPanelState,
  SetupPanelState,
  SetupSurfaceState,
} from "./operatorConsoleState.js";

export type SetupPanelRenderOptions = {
  readonly width: number;
  readonly height?: number;
};

const WIDE_TABLE_MIN_WIDTH = 72;

export function getSetupPanelSurfaceDesiredHeight(state: SetupSurfaceState, width: number): number {
  if (state.kind === "secret") return state.optional === true ? 8 : 10;
  return normalizeDimension(width) >= WIDE_TABLE_MIN_WIDTH
    ? Math.max(8, state.rows.length + 7)
    : Math.max(8, state.rows.length * 4 + 4);
}

export function renderSetupPanelSurface(
  state: SetupSurfaceState,
  options: SetupPanelRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0) return [];
  const rows = state.kind === "secret"
    ? renderSecretEntryPanel(state, width)
    : renderSetupTablePanel(state, width);
  return options.height === undefined ? rows : rows.slice(0, normalizeDimension(options.height));
}

function renderSetupTablePanel(state: SetupPanelState, width: number): readonly string[] {
  const contentWidth = Math.max(0, width - 4);
  const copy = resolveSetupCopy(state.locale);
  const description = state.description ?? copy.modelDescription;
  const footer = state.footer ?? copy.footer;
  const rows = [
    renderTopBorder(state.title, width),
    renderContentRow(description, contentWidth, width),
    renderContentRow("", contentWidth, width),
    ...(width >= WIDE_TABLE_MIN_WIDTH
      ? renderWideTableRows(state, copy, contentWidth, width)
      : renderNarrowTableRows(state, contentWidth, width)),
    renderContentRow("", contentWidth, width),
    renderContentRow(footer, contentWidth, width),
    renderBottomBorder(width),
  ];
  return rows;
}

function renderWideTableRows(
  state: SetupPanelState,
  copy: SetupCopy,
  contentWidth: number,
  width: number
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
      const marker = row.id === state.selectedRowId ? "❯" : "";
      return renderContentRow([
        padVisibleEnd(marker, markerWidth),
        padVisibleEnd(row.provider, providerWidth),
        padVisibleEnd(row.model, modelWidth),
        padVisibleEnd(row.status, statusWidth),
        padVisibleEnd(row.notes, notesWidth),
      ].join(" "), contentWidth, width);
    }),
  ];
}

function renderNarrowTableRows(
  state: SetupPanelState,
  contentWidth: number,
  width: number
): readonly string[] {
  return state.rows.flatMap((row) => {
    const marker = row.id === state.selectedRowId ? "❯ " : "  ";
    return [
      renderContentRow(`${marker}${row.provider}`, contentWidth, width),
      renderContentRow(`  ${row.model}`, contentWidth, width),
      renderContentRow(`  ${row.status} · ${row.notes}`, contentWidth, width),
      renderContentRow("", contentWidth, width),
    ];
  }).slice(0, Math.max(0, state.rows.length * 4 - 1));
}

function renderSecretEntryPanel(state: SecretEntryPanelState, width: number): readonly string[] {
  const contentWidth = Math.max(0, width - 4);
  const value = state.optional === true && (state.maskedValue === undefined || state.maskedValue.length === 0)
    ? state.emptyLabel ?? "[leave empty]"
    : maskSecretValue(state);
  const rows = [
    renderTopBorder(state.title, width),
    renderContentRow(state.description, contentWidth, width),
    renderContentRow("", contentWidth, width),
    renderContentRow(value, contentWidth, width),
    renderContentRow("", contentWidth, width),
  ];

  if (state.envVar !== undefined && state.envVar.length > 0) {
    rows.push(renderContentRow(`Stored as: ${state.envVar}`, contentWidth, width));
    rows.push(renderContentRow("", contentWidth, width));
  }

  rows.push(renderContentRow(state.footer, contentWidth, width));
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

function renderTopBorder(title: string, width: number): string {
  if (width <= 1) return "╭".slice(0, width);
  const label = `─ ${title} `;
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

function padVisibleEnd(value: string, width: number): string {
  const truncated = truncateVisibleCells(value, width);
  const padCells = Math.max(0, width - stringWidth(truncated));
  return `${truncated}${" ".repeat(padCells)}`;
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
