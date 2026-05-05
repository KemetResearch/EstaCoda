// v0.95 ViewModel Builders
// Pure factory functions. No formatting, ANSI, terminal-width, or rendering logic.

import type {
  ActivityTimelineViewModel,
  ApprovalAction,
  ApprovalSecurityViewModel,
  CommandResultViewModel,
  KeyValueBlockViewModel,
  KeyValueEntry,
  ListItem,
  ListViewModel,
  PlainFallbackViewModel,
  PickerOption,
  PickerViewModel,
  ProgressContextRailViewModel,
  ProgressStep,
  ProgressStepStatus,
  StartupViewModel,
  StatusViewModel,
  TableColumn,
  TableViewModel,
  TimelineEvent,
  WarningErrorViewModel,
  ViewModel,
  ViewModelSeverity,
} from "../../contracts/view-model.js";

// ─────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────

export interface BuildStatusInput {
  readonly agentName: string;
  readonly model: { readonly provider: string; readonly id: string };
  readonly securityMode: string;
  readonly skillCount: number;
  readonly skillAutonomy?: string;
  readonly toolCount: number;
  readonly mcpActive: number;
  readonly mcpTotal: number;
  readonly taskflowActive: boolean;
  readonly warnings?: readonly WarningErrorViewModel[];
  readonly sections?: readonly ViewModel[];
}

export function buildStatusViewModel(input: BuildStatusInput): StatusViewModel {
  return {
    kind: "status",
    agentName: input.agentName,
    model: input.model,
    securityMode: input.securityMode,
    skillCount: input.skillCount,
    skillAutonomy: input.skillAutonomy,
    toolCount: input.toolCount,
    mcp: { active: input.mcpActive, total: input.mcpTotal },
    taskflowActive: input.taskflowActive,
    warnings: input.warnings ?? [],
    sections: input.sections,
  };
}

// ─────────────────────────────────────────────────────────────
// Table
// ─────────────────────────────────────────────────────────────

export interface BuildTableInput {
  readonly title?: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly Record<string, string | number | boolean | undefined>[];
  readonly emptyMessage?: string;
}

export function buildTableViewModel(input: BuildTableInput): TableViewModel {
  return {
    kind: "table",
    title: input.title,
    columns: input.columns,
    rows: input.rows,
    emptyMessage: input.emptyMessage,
  };
}

// ─────────────────────────────────────────────────────────────
// Key-Value Block
// ─────────────────────────────────────────────────────────────

export interface BuildKeyValueBlockInput {
  readonly title?: string;
  readonly entries: readonly KeyValueEntry[];
}

export function buildKeyValueBlockViewModel(
  input: BuildKeyValueBlockInput
): KeyValueBlockViewModel {
  return {
    kind: "kv",
    title: input.title,
    entries: input.entries,
  };
}

// ─────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────

export interface BuildListInput {
  readonly title?: string;
  readonly items: readonly ListItem[];
  readonly ordered?: boolean;
  readonly emptyMessage?: string;
}

export function buildListViewModel(input: BuildListInput): ListViewModel {
  return {
    kind: "list",
    title: input.title,
    items: input.items,
    ordered: input.ordered,
    emptyMessage: input.emptyMessage,
  };
}

// ─────────────────────────────────────────────────────────────
// Warning / Error
// ─────────────────────────────────────────────────────────────

export interface BuildWarningErrorInput {
  readonly severity: "warn" | "error" | "info";
  readonly title: string;
  readonly message: string;
  readonly details?: readonly string[];
}

export function buildWarningErrorViewModel(
  input: BuildWarningErrorInput
): WarningErrorViewModel {
  return {
    kind: "warning",
    severity: input.severity,
    title: input.title,
    message: input.message,
    details: input.details,
  };
}

// ─────────────────────────────────────────────────────────────
// Approval / Security
// ─────────────────────────────────────────────────────────────

export interface BuildApprovalSecurityInput {
  readonly toolName: string;
  readonly riskClass?: string;
  readonly targetSummary: string;
  readonly severity: "warn" | "error" | "info";
  readonly actions: readonly ApprovalAction[];
  readonly details?: readonly string[];
}

export function buildApprovalSecurityViewModel(
  input: BuildApprovalSecurityInput
): ApprovalSecurityViewModel {
  return {
    kind: "approval",
    toolName: input.toolName,
    riskClass: input.riskClass,
    targetSummary: input.targetSummary,
    severity: input.severity,
    actions: input.actions,
    details: input.details,
  };
}

// ─────────────────────────────────────────────────────────────
// Activity Timeline
// ─────────────────────────────────────────────────────────────

export interface BuildActivityTimelineInput {
  readonly events: readonly TimelineEvent[];
}

export function buildActivityTimelineViewModel(
  input: BuildActivityTimelineInput
): ActivityTimelineViewModel {
  return {
    kind: "timeline",
    events: input.events,
  };
}

// ─────────────────────────────────────────────────────────────
// Progress / Context Rail
// ─────────────────────────────────────────────────────────────

export interface BuildProgressRailInput {
  readonly title?: string;
  readonly steps: readonly ProgressStep[];
}

export function buildProgressContextRailViewModel(
  input: BuildProgressRailInput
): ProgressContextRailViewModel {
  return {
    kind: "progress",
    title: input.title,
    steps: input.steps,
  };
}

// ─────────────────────────────────────────────────────────────
// Picker
// ─────────────────────────────────────────────────────────────

export interface BuildPickerInput {
  readonly title: string;
  readonly options: readonly PickerOption[];
}

export function buildPickerViewModel(input: BuildPickerInput): PickerViewModel {
  return {
    kind: "picker",
    title: input.title,
    options: input.options,
  };
}

// ─────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────

export interface BuildStartupInput {
  readonly agentName: string;
  readonly taglines: readonly string[];
  readonly model: { readonly provider: string; readonly id: string };
  readonly readiness: "ready" | "degraded" | "missing-config";
  readonly warnings?: readonly WarningErrorViewModel[];
}

export function buildStartupViewModel(input: BuildStartupInput): StartupViewModel {
  return {
    kind: "startup",
    agentName: input.agentName,
    taglines: input.taglines,
    model: input.model,
    readiness: input.readiness,
    warnings: input.warnings ?? [],
  };
}

// ─────────────────────────────────────────────────────────────
// Command Result
// ─────────────────────────────────────────────────────────────

export interface BuildCommandResultInput {
  readonly ok: boolean;
  readonly title: string;
  readonly blocks: readonly ViewModel[];
}

export function buildCommandResultViewModel(
  input: BuildCommandResultInput
): CommandResultViewModel {
  return {
    kind: "commandResult",
    ok: input.ok,
    title: input.title,
    blocks: input.blocks,
  };
}

// ─────────────────────────────────────────────────────────────
// Plain Fallback
// ─────────────────────────────────────────────────────────────

export interface BuildPlainFallbackInput {
  readonly lines: readonly string[];
}

export function buildPlainFallbackViewModel(
  input: BuildPlainFallbackInput
): PlainFallbackViewModel {
  return {
    kind: "plainFallback",
    lines: input.lines,
  };
}

// ─────────────────────────────────────────────────────────────
// Convenience helpers (still pure, no rendering)
// ─────────────────────────────────────────────────────────────

export function kv(key: string, value: string | number | boolean, severity?: ViewModelSeverity): KeyValueEntry {
  return { key, value, severity };
}

export function listItem(label: string, value?: string, severity?: ViewModelSeverity): ListItem {
  return { label, value, severity };
}

export function timelineEvent(
  tool: string,
  status: TimelineEvent["status"],
  overrides?: Omit<Partial<TimelineEvent>, "tool" | "status">
): TimelineEvent {
  return { tool, status, ...overrides };
}

export function progressStep(label: string, status: ProgressStepStatus): ProgressStep {
  return { label, status };
}

export function pickerOption(
  id: string,
  label: string,
  overrides?: Omit<Partial<PickerOption>, "id" | "label">
): PickerOption {
  return { id, label, ...overrides };
}

export function approvalAction(
  id: string,
  label: string,
  severity?: ViewModelSeverity
): ApprovalAction {
  return { id, label, severity };
}
