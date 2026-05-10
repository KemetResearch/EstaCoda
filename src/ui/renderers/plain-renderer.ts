// v0.95 Plain Renderer
// Deterministic, ASCII-safe plain-text output for all ViewModel types.
// No ANSI, no emoji, no color, no animation, no terminal-width detection.

import { measureTextWidth, padVisibleAlign, truncateVisible } from "./layout.js";
import type { UiLocale } from "../../ui/cli-ui-copy.js";
import { chromeCopy } from "../../ui/cli-ui-copy.js";
import { isolateLtr } from "../../ui/bidi.js";
import type {
  ActiveTurnSpinnerViewModel,
  ActivityTimelineViewModel,
  ApprovalSecurityViewModel,
  CommandResultViewModel,
  ConversationMessageViewModel,
  KeyValueBlockViewModel,
  ListViewModel,
  PlainFallbackViewModel,
  PickerViewModel,
  ProgressContextRailViewModel,
  StartupViewModel,
  StartupDashboardViewModel,
  StatusViewModel,
  TableViewModel,
  TimelineEvent,
  WarningErrorViewModel,
  AssistantResponseViewModel,
  SessionStatusRailViewModel,
  ShortcutHintRailViewModel,
  UserPromptRailViewModel,
  ViewModel,
  ToolActivityRailViewModel,
  ToolActivityRailEvent,
} from "../../contracts/view-model.js";

// ─────────────────────────────────────────────────────────────
// Generic dispatcher
// ─────────────────────────────────────────────────────────────

export function renderPlain(viewModel: ViewModel, locale?: UiLocale): string {
  switch (viewModel.kind) {
    case "status":
      return renderStatus(viewModel);
    case "table":
      return renderTable(viewModel);
    case "kv":
      return renderKeyValueBlock(viewModel);
    case "list":
      return renderList(viewModel);
    case "warning":
      return renderWarningError(viewModel);
    case "approval":
      return renderApprovalSecurity(viewModel);
    case "timeline":
      return renderActivityTimeline(viewModel);
    case "progress":
      return renderProgressRail(viewModel);
    case "picker":
      return renderPicker(viewModel);
    case "startup":
      return renderStartup(viewModel);
    case "startupDashboard":
      return renderStartupDashboard(viewModel);
    case "commandResult":
      return renderCommandResult(viewModel);
    case "plainFallback":
      return renderPlainFallback(viewModel);
    case "assistantResponse":
      return renderAssistantResponse(viewModel);
    case "conversationMessage":
      return renderConversationMessage(viewModel, locale);
    case "sessionStatusRail":
      return renderSessionStatusRail(viewModel, locale);
    case "shortcutHintRail":
      return renderShortcutHintRail(viewModel, locale);
    case "userPromptRail":
      return renderUserPromptRail(viewModel);
    case "activeTurnSpinner":
      return renderActiveTurnSpinner(viewModel, locale);
    case "toolActivityRail":
      return renderToolActivityRail(viewModel, locale);
    case "startupDashboard":
    case "startupRuntime":
    case "fileChangePreview":
    case "slashMenu":
      return `[unsupported view model: ${viewModel.kind}]`;
    default: {
      const _exhaustive: never = viewModel;
      return String(_exhaustive);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Plain Fallback
// ─────────────────────────────────────────────────────────────

export function renderPlainFallback(vm: PlainFallbackViewModel): string {
  return vm.lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Warning / Error
// ─────────────────────────────────────────────────────────────

export function renderWarningError(vm: WarningErrorViewModel): string {
  const tag = severityTag(vm.severity);
  const lines = [`${tag} ${vm.title}: ${vm.message}`];
  if (vm.details !== undefined && vm.details.length > 0) {
    for (const detail of vm.details) {
      lines.push(`  ${detail}`);
    }
  }
  return lines.join("\n");
}

function severityTag(severity: "warn" | "error" | "info"): string {
  switch (severity) {
    case "error":
      return "[ERROR]";
    case "warn":
      return "[WARN]";
    case "info":
      return "[INFO]";
  }
}

// ─────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────

export function renderStatus(vm: StatusViewModel): string {
  const lines: string[] = [
    `${vm.agentName} is ready`,
    `model: ${vm.model.provider}/${vm.model.id}`,
    `security: ${vm.securityMode}`,
    `skills: ${vm.skillCount}${vm.skillAutonomy !== undefined ? ` (${vm.skillAutonomy})` : ""}`,
    `tools: ${vm.toolCount}`,
    `mcp: ${vm.mcp.active}/${vm.mcp.total}`,
    `taskflow: ${vm.taskflowActive ? "active" : "inactive"}`,
  ];

  for (const warning of vm.warnings) {
    lines.push(renderWarningError(warning));
  }

  if (vm.sections !== undefined && vm.sections.length > 0) {
    for (const section of vm.sections) {
      lines.push("");
      lines.push(renderPlain(section));
    }
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Table
// ─────────────────────────────────────────────────────────────

export function renderTable(vm: TableViewModel): string {
  if (vm.rows.length === 0) {
    const empty = vm.emptyMessage ?? "No data.";
    return vm.title !== undefined ? `${vm.title}\n${empty}` : empty;
  }

  const widths = computeColumnWidths(vm.columns, vm.rows);
  const lines: string[] = [];

  if (vm.title !== undefined) {
    lines.push(vm.title);
  }

  // Header row
  const headerCells = vm.columns.map((col, i) =>
    padVisibleAlign(col.header, widths[i], col.alignment ?? "left")
  );
  lines.push(headerCells.join("  "));

  // Separator
  const separatorCells = vm.columns.map((col, i) =>
    "-".repeat(Math.max(col.header.length, widths[i]))
  );
  lines.push(separatorCells.join("  "));

  // Data rows
  for (const row of vm.rows) {
    const cells = vm.columns.map((col, i) => {
      const raw = row[col.key];
      const text = raw === undefined ? "" : String(raw);
      return padVisibleAlign(text, widths[i], col.alignment ?? "left");
    });
    lines.push(cells.join("  "));
  }

  return lines.join("\n");
}

function computeColumnWidths(
  columns: readonly { readonly key: string; readonly header: string }[],
  rows: readonly Record<string, unknown>[]
): number[] {
  return columns.map((col) => {
    let width = measureTextWidth(col.header);
    for (const row of rows) {
      const raw = row[col.key];
      const text = raw === undefined ? "" : String(raw);
      width = Math.max(width, measureTextWidth(text));
    }
    return width;
  });
}

// ─────────────────────────────────────────────────────────────
// Key-Value Block
// ─────────────────────────────────────────────────────────────

export function renderKeyValueBlock(vm: KeyValueBlockViewModel): string {
  const lines: string[] = [];
  if (vm.title !== undefined) {
    lines.push(vm.title);
  }

  for (const entry of vm.entries) {
    const prefix = entry.severity !== undefined ? `[${entry.severity.toUpperCase()}] ` : "";
    lines.push(`${prefix}${entry.key}: ${entry.value}`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────

export function renderList(vm: ListViewModel): string {
  if (vm.items.length === 0) {
    const empty = vm.emptyMessage ?? "No items.";
    return vm.title !== undefined ? `${vm.title}\n${empty}` : empty;
  }

  const lines: string[] = [];
  if (vm.title !== undefined) {
    lines.push(vm.title);
  }

  for (let i = 0; i < vm.items.length; i++) {
    const item = vm.items[i];
    const bullet = vm.ordered ? `${i + 1}.` : "-";
    const prefix = item.severity !== undefined ? `[${item.severity.toUpperCase()}] ` : "";
    const valuePart = item.value !== undefined ? `: ${item.value}` : "";
    lines.push(`${bullet} ${prefix}${item.label}${valuePart}`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Approval / Security
// ─────────────────────────────────────────────────────────────

export function renderApprovalSecurity(vm: ApprovalSecurityViewModel): string {
  const lines: string[] = [
    `[${vm.severity.toUpperCase()}] Approval required: ${vm.toolName}`,
    `Target: ${vm.targetSummary}`,
  ];

  if (vm.riskClass !== undefined) {
    lines.push(`Risk: ${vm.riskClass}`);
  }

  if (vm.details !== undefined && vm.details.length > 0) {
    for (const detail of vm.details) {
      lines.push(`  ${detail}`);
    }
  }

  lines.push("");
  lines.push("Actions:");
  for (const action of vm.actions) {
    const tag = action.severity !== undefined ? `[${action.severity.toUpperCase()}] ` : "";
    lines.push(`  ${action.id}) ${tag}${action.label}`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Activity Timeline
// ─────────────────────────────────────────────────────────────

export function renderActivityTimeline(vm: ActivityTimelineViewModel): string {
  if (vm.events.length === 0) {
    return "No activity.";
  }

  const lines = vm.events.map((event) => renderTimelineEvent(event));
  return lines.join("\n");
}

function renderTimelineEvent(event: TimelineEvent): string {
  const marker = timelineStatusMarker(event.status);
  const parts: string[] = [`${marker} ${event.tool}`];

  if (event.elapsedMs !== undefined) {
    parts.push(`| ${formatDuration(event.elapsedMs)}`);
  }

  if (event.chars !== undefined && event.sentChars !== undefined) {
    parts.push(
      `| ${formatCount(event.chars)} captured / ${formatCount(event.sentChars)} sent`
    );
    if (event.truncated) {
      parts.push("/ compressed");
    }
  }

  if (event.decision !== undefined) {
    parts.push(`| decision: ${event.decision}`);
  }

  if (event.riskClass !== undefined) {
    parts.push(`| risk: ${event.riskClass}`);
  }

  return parts.join(" ");
}

function timelineStatusMarker(status: TimelineEvent["status"]): string {
  switch (status) {
    case "pending":
      return "[ ]";
    case "running":
      return "[>]";
    case "done":
      return "[x]";
    case "failed":
      return "[-]";
    case "gated":
      return "[?]";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, ms)}ms`;
  }
  return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
}

function formatCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return String(value);
}

function formatContextCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`;
  }
  return String(value);
}

// ─────────────────────────────────────────────────────────────
// Progress / Context Rail
// ─────────────────────────────────────────────────────────────

export function renderProgressRail(vm: ProgressContextRailViewModel): string {
  if (vm.steps.length === 0 && vm.sessionElapsedMs === undefined && vm.taskElapsedMs === undefined) {
    return vm.title !== undefined ? `${vm.title}\nNo steps.` : "No steps.";
  }

  const lines: string[] = [];
  if (vm.title !== undefined) {
    lines.push(vm.title);
  }

  for (const step of vm.steps) {
    const marker = progressStatusMarker(step.status);
    lines.push(`${marker} ${step.label}`);
  }

  const timerParts: string[] = [];
  if (vm.sessionElapsedMs !== undefined) {
    timerParts.push(`sess ${formatDuration(vm.sessionElapsedMs)}`);
  }
  if (vm.taskElapsedMs !== undefined) {
    if (vm.taskElapsedMs === "idle") {
      timerParts.push("task idle");
    } else {
      timerParts.push(`task ${formatDuration(vm.taskElapsedMs)}`);
    }
  }
  if (timerParts.length > 0) {
    lines.push(timerParts.join("  "));
  }

  return lines.join("\n");
}

function progressStatusMarker(status: ProgressContextRailViewModel["steps"][number]["status"]): string {
  switch (status) {
    case "pending":
      return "[ ]";
    case "active":
      return "[>]";
    case "done":
      return "[x]";
    case "failed":
      return "[-]";
  }
}

// ──────────────────────────────────────
// Tool Activity Rail
// ──────────────────────────────────────

export function renderToolActivityRail(vm: ToolActivityRailViewModel, locale?: UiLocale): string {
  if (vm.events.length === 0) {
    return "No activity.";
  }
  const copy = chromeCopy(locale ?? "en");
  const lines = vm.events.map((event) => {
    const marker = toolActivityStatusMarker(event.status);
    const labelKey = event.label ?? "run";
    const label = (copy as unknown as Record<string, string>)[labelKey] ?? labelKey;
    const targetRaw = event.target ?? "";
    const target = locale === "ar" && targetRaw.length > 0 ? isolateLtr(targetRaw) : targetRaw;
    const elapsed = event.elapsedMs !== undefined ? formatDuration(event.elapsedMs) : "";
    const parts: string[] = [`| ${marker} ${label}`];
    if (target.length > 0) {
      parts.push(target);
    }
    if (elapsed.length > 0) {
      parts.push(elapsed);
    }
    return truncateVisible(parts.join("  "), 120);
  });
  return lines.join("\n");
}

function toolActivityStatusMarker(status: ToolActivityRailEvent["status"]): string {
  switch (status) {
    case "pending":
      return "[ ]";
    case "running":
      return "[>]";
    case "done":
      return "[x]";
    case "failed":
      return "[-]";
    case "gated":
      return "[?]";
  }
}

// ──────────────────────────────────────
// Picker
// ──────────────────────────────────────

export function renderPicker(vm: PickerViewModel): string {
  const lines: string[] = [vm.title];

  for (let i = 0; i < vm.options.length; i++) {
    const opt = vm.options[i];
    const marker = opt.selected ? ">" : " ";
    const num = String(i + 1).padStart(2);
    lines.push(`${marker} ${num}) ${opt.label}`);
    if (opt.description !== undefined) {
      lines.push(`     ${opt.description}`);
    }
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────

export function renderStartup(vm: StartupViewModel): string {
  const lines: string[] = [vm.agentName];

  for (const tagline of vm.taglines) {
    if (tagline.length > 0) {
      lines.push(tagline);
    }
  }

  lines.push(`model: ${vm.model.provider}/${vm.model.id}`);
  lines.push(`readiness: ${vm.readiness}`);

  for (const warning of vm.warnings) {
    lines.push("");
    lines.push(renderWarningError(warning));
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Command Result
// ─────────────────────────────────────────────────────────────

export function renderCommandResult(vm: CommandResultViewModel): string {
  const lines: string[] = [`${vm.ok ? "[OK]" : "[FAIL]"} ${vm.title}`];

  if (vm.blocks.length > 0) {
    lines.push("");
    for (const block of vm.blocks) {
      lines.push(renderPlain(block));
      lines.push("");
    }
    lines.pop(); // remove trailing blank line
  }

  return lines.join("\n");
}

// ──────────────────────────────────────
// Startup Dashboard
// ──────────────────────────────────────

export function renderStartupDashboard(vm: StartupDashboardViewModel): string {
  const lines: string[] = [vm.agentName];

  for (const tagline of vm.taglines) {
    if (tagline.length > 0) {
      lines.push(tagline);
    }
  }

  lines.push("");

  if (vm.version !== undefined) {
    lines.push(`version: ${vm.version}`);
  }
  if (vm.sessionId !== undefined) {
    lines.push(`session: ${vm.sessionId}`);
  }

  // Model route readiness line
  const readiness = vm.providerReadiness;
  let modelLabel: string;
  let readinessText: string;

  switch (readiness) {
    case "ready":
      modelLabel = vm.model.id;
      readinessText = "ready";
      break;
    case "degraded":
      modelLabel = vm.model.id;
      readinessText = "degraded";
      break;
    case "missing-config":
      modelLabel = "model not configured";
      readinessText = "missing config";
      break;
    case "unknown":
    default:
      modelLabel = vm.model.id;
      readinessText = "unknown";
      break;
  }

  lines.push(`model: ${modelLabel} - ${readinessText}`);

  lines.push(`workspace trust: ${vm.workspaceTrust}`);
  lines.push(`workspace verification: ${vm.workspaceVerification}`);

  if (vm.workspaceDirectory !== undefined) {
    lines.push(`workspace: ${vm.workspaceDirectory}`);
  }
  if (vm.securityMode !== undefined) {
    lines.push(`security: ${vm.securityMode}`);
  }
  if (vm.skillAutonomy !== undefined) {
    lines.push(`skills: ${vm.skillAutonomy}`);
  }
  if (vm.versionStatus !== undefined) {
    lines.push(`version status: ${vm.versionStatus}`);
  }

  lines.push("");
  lines.push("Interactive commands:");
  lines.push("  /tools   Browse runtime tools");
  lines.push("  /skills  Browse skills");
  lines.push("  /model   Show or switch model");
  lines.push("  /status  Show session status");

  for (const warning of vm.warnings) {
    lines.push("");
    lines.push(renderWarningError(warning));
  }

  return lines.join("\n");
}

// ──────────────────────────────────────
// Command Result
// ──────────────────────────────────────

export function renderAssistantResponse(vm: AssistantResponseViewModel): string {
  const plainLabel = /^[\x00-\x7F]+$/.test(vm.label) ? vm.label : "EstaCoda";
  const lines: string[] = [
    `${plainLabel}:`,
    ...vm.text.split("\n"),
  ];

  if (vm.matchedSkills !== undefined && vm.matchedSkills.length > 0) {
    lines.push("");
    lines.push(`skills: ${vm.matchedSkills.join(", ")}`);
  }

  if (vm.progress !== undefined && vm.progress.length > 0) {
    lines.push(`progress: ${vm.progress.join(" -> ")}`);
  }

  return lines.join("\n");
}

// ──────────────────────────────────────
// Conversation Message
// ──────────────────────────────────────

export function renderConversationMessage(vm: ConversationMessageViewModel, locale?: UiLocale): string {
  if (vm.role === "assistant") {
    const copy = chromeCopy(locale ?? "en");
    const plainLabel = vm.label !== undefined && /^[\x00-\x7F]+$/.test(vm.label)
      ? vm.label
      : copy.assistantCardTitle;
    const lines: string[] = [
      `${plainLabel}:`,
      ...vm.text.split("\n"),
    ];

    if (vm.matchedSkills !== undefined && vm.matchedSkills.length > 0) {
      lines.push("");
      lines.push(`skills: ${vm.matchedSkills.join(", ")}`);
    }

    if (vm.progress !== undefined && vm.progress.length > 0) {
      lines.push(`progress: ${vm.progress.join(" -> ")}`);
    }

    return lines.join("\n");
  }

  // User messages: plain text until user prompt rail is implemented
  return vm.text;
}

// ──────────────────────────────────────
// Prompt Chrome Rails
// ──────────────────────────────────────

export function renderSessionStatusRail(vm: SessionStatusRailViewModel, locale?: UiLocale): string {
  const copy = chromeCopy(locale ?? "en");
  const parts: string[] = [`* ${vm.modelLabel}`];

  if (vm.contextUsage !== undefined) {
    const filled = formatContextCount(vm.contextUsage.filled);
    const total = formatContextCount(vm.contextUsage.total);
    parts.push(`${copy.context} ${filled}/${total}`);
    parts.push(`${vm.contextUsage.total > 0 ? Math.round((vm.contextUsage.filled / vm.contextUsage.total) * 100) : 0}%`);
  }

  if (vm.sessionElapsedMs !== undefined) {
    parts.push(`session ${formatDuration(vm.sessionElapsedMs)}`);
  }

  if (vm.currentTurnSeconds !== undefined) {
    parts.push(`turn ${vm.currentTurnSeconds}s`);
  }

  parts.push(turnStateLabel(vm.turnState, copy));
  return parts.join(" | ");
}

export function renderShortcutHintRail(vm: ShortcutHintRailViewModel, locale?: UiLocale): string {
  const copy = chromeCopy(locale ?? "en");
  const text = vm.hints.length === 0
    ? copy.shortcuts
    : vm.hints.map((hint) => hint.key.length === 0 ? hint.description : `${hint.key} ${hint.description}`).join(" · ");
  return `> ${text}`;
}

export function renderUserPromptRail(vm: UserPromptRailViewModel): string {
  const width = 60;
  const line = `+${"-".repeat(Math.max(0, width - 2))}+`;
  return `> ${vm.text}\n${line}`;
}

export function renderActiveTurnSpinner(vm: ActiveTurnSpinnerViewModel, locale?: UiLocale): string {
  const copy = chromeCopy(locale ?? "en");
  const eye = "*";
  const label = vm.label ?? (vm.phase !== undefined ? ((copy as unknown) as Record<string, string>)[vm.phase] : undefined);
  if (label !== undefined) {
    return `${eye} ${label}`;
  }
  return eye;
}

function turnStateLabel(state: SessionStatusRailViewModel["turnState"], copy: ReturnType<typeof chromeCopy>): string {
  switch (state) {
    case "idle":
      return copy.idle;
    case "running":
      return copy.running;
    case "blocked":
      return copy.blocked;
    case "error":
      return copy.error;
    case "unknown":
      return "unknown";
  }
}