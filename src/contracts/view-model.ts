// v0.95 ViewModel Contract
// Pure structured data types for all CLI output surfaces.
// No ANSI, formatting, terminal-width, or rendering logic.

export type ViewModelSeverity = "ok" | "warn" | "error" | "info";

// ─────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────

export interface StatusViewModel {
  readonly kind: "status";
  readonly agentName: string;
  readonly model: {
    readonly provider: string;
    readonly id: string;
  };
  readonly securityMode: string;
  readonly skillCount: number;
  readonly skillAutonomy?: string;
  readonly toolCount: number;
  readonly mcp: {
    readonly active: number;
    readonly total: number;
  };
  readonly taskflowActive: boolean;
  readonly warnings: readonly WarningErrorViewModel[];
  readonly sections?: readonly ViewModel[];
}

// ─────────────────────────────────────────────────────────────
// Table
// ─────────────────────────────────────────────────────────────

export type TableAlignment = "left" | "right" | "center";

export interface TableColumn {
  readonly key: string;
  readonly header: string;
  readonly alignment?: TableAlignment;
}

export interface TableViewModel {
  readonly kind: "table";
  readonly title?: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly Record<string, string | number | boolean | undefined>[];
  readonly emptyMessage?: string;
}

// ─────────────────────────────────────────────────────────────
// Key-Value Block
// ─────────────────────────────────────────────────────────────

export interface KeyValueEntry {
  readonly key: string;
  readonly value: string | number | boolean;
  readonly severity?: ViewModelSeverity;
}

export interface KeyValueBlockViewModel {
  readonly kind: "kv";
  readonly title?: string;
  readonly entries: readonly KeyValueEntry[];
}

// ─────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────

export interface ListItem {
  readonly label: string;
  readonly value?: string;
  readonly severity?: ViewModelSeverity;
}

export interface ListViewModel {
  readonly kind: "list";
  readonly title?: string;
  readonly items: readonly ListItem[];
  readonly ordered?: boolean;
  readonly emptyMessage?: string;
}

// ─────────────────────────────────────────────────────────────
// Warning / Error
// ─────────────────────────────────────────────────────────────

export interface WarningErrorViewModel {
  readonly kind: "warning";
  readonly severity: "warn" | "error" | "info";
  readonly title: string;
  readonly message: string;
  readonly details?: readonly string[];
}

// ─────────────────────────────────────────────────────────────
// Approval / Security
// ─────────────────────────────────────────────────────────────

export interface ApprovalAction {
  readonly id: string;
  readonly label: string;
  readonly severity?: ViewModelSeverity;
}

export interface ApprovalSecurityViewModel {
  readonly kind: "approval";
  readonly toolName: string;
  readonly riskClass?: string;
  readonly targetSummary: string;
  readonly severity: "warn" | "error" | "info";
  readonly actions: readonly ApprovalAction[];
  readonly details?: readonly string[];
}

// ─────────────────────────────────────────────────────────────
// Activity Timeline
// ─────────────────────────────────────────────────────────────

export type TimelineEventStatus = "pending" | "running" | "done" | "failed" | "gated";

export interface TimelineEvent {
  readonly tool: string;
  readonly status: TimelineEventStatus;
  readonly elapsedMs?: number;
  readonly chars?: number;
  readonly sentChars?: number;
  readonly decision?: "allow" | "block" | "ask";
  readonly riskClass?: string;
  readonly truncated?: boolean;
}

export interface ActivityTimelineViewModel {
  readonly kind: "timeline";
  readonly events: readonly TimelineEvent[];
}

// ─────────────────────────────────────────────────────────────
// Progress / Context Rail
// ─────────────────────────────────────────────────────────────

export type ProgressStepStatus = "pending" | "active" | "done" | "failed";

export interface ProgressStep {
  readonly label: string;
  readonly status: ProgressStepStatus;
}

export interface ProgressContextRailViewModel {
  readonly kind: "progress";
  readonly title?: string;
  readonly steps: readonly ProgressStep[];
  readonly sessionElapsedMs?: number;
  readonly taskElapsedMs?: number | "idle";
}

// ─────────────────────────────────────────────────────────────
// Picker
// ─────────────────────────────────────────────────────────────

export interface PickerOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly selected?: boolean;
}

export interface PickerViewModel {
  readonly kind: "picker";
  readonly title: string;
  readonly options: readonly PickerOption[];
}

// ─────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────

export interface StartupViewModel {
  readonly kind: "startup";
  readonly agentName: string;
  readonly taglines: readonly string[];
  readonly model: {
    readonly provider: string;
    readonly id: string;
  };
  readonly readiness: "ready" | "degraded" | "missing-config";
  readonly warnings: readonly WarningErrorViewModel[];
}

// ─────────────────────────────────────────────────────────────
// Command Result
// ─────────────────────────────────────────────────────────────

export interface CommandResultViewModel {
  readonly kind: "commandResult";
  readonly ok: boolean;
  readonly title: string;
  readonly blocks: readonly ViewModel[];
}

// ─────────────────────────────────────────────────────────────
// Plain Fallback
// ─────────────────────────────────────────────────────────────

export interface PlainFallbackViewModel {
  readonly kind: "plainFallback";
  readonly lines: readonly string[];
}

// ─────────────────────────────────────────────────────────────
// Assistant Response
// ─────────────────────────────────────────────────────────────

export interface AssistantResponseViewModel {
  readonly kind: "assistantResponse";
  readonly label: string;
  readonly text: string;
  readonly matchedSkills?: readonly string[];
  readonly progress?: readonly string[];
}

// ─────────────────────────────────────────────────────────────
// Discriminated Union
// ─────────────────────────────────────────────────────────────

export type ViewModel =
  | StatusViewModel
  | TableViewModel
  | KeyValueBlockViewModel
  | ListViewModel
  | WarningErrorViewModel
  | ApprovalSecurityViewModel
  | ActivityTimelineViewModel
  | ProgressContextRailViewModel
  | PickerViewModel
  | StartupViewModel
  | CommandResultViewModel
  | PlainFallbackViewModel
  | AssistantResponseViewModel;
