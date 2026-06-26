import {
  createInitialFocusState,
  type FocusState,
} from "./focusModel.js";

export type TranscriptBlock = {
  readonly id: string;
  readonly role: "startup" | "user" | "assistant" | "system" | "tool" | "approval" | "summary";
  readonly text: string;
  readonly createdAtMs?: number;
  readonly attachmentIds?: readonly string[];
};

export type PromptSurfaceState = {
  readonly value: string;
  readonly cursorOffset: number;
  readonly multiline: boolean;
  readonly scrollOffset: number;
  readonly mode: "prompt" | "steer";
  readonly placeholder?: string;
};

export type StatusRailState = {
  readonly model: {
    readonly label: string;
    readonly state: "idle" | "working" | "degraded";
  };
  readonly context: {
    readonly usedTokens: number;
    readonly totalTokens?: number;
    readonly percent?: number;
  };
  readonly sessionTimer: {
    readonly elapsedMs: number;
    readonly startedAtMs?: number;
  };
};

export type AttachmentCardState = {
  readonly id: string;
  readonly kind: "pastedText" | "fileExcerpt";
  readonly title: string;
  readonly preview: string;
  readonly content: string;
  readonly metadata: {
    readonly chars?: number;
    readonly lines?: number;
    readonly path?: string;
  };
};

export type ToolActivityEvent = {
  readonly id: string;
  readonly label: string;
  readonly state: "queued" | "running" | "completed" | "failed" | "canceled";
  readonly detail?: string;
  readonly elapsedMs?: number;
};

export type ToolActivityState = {
  readonly events: readonly ToolActivityEvent[];
  readonly scrollOffset: number;
  readonly expanded: boolean;
  readonly turnSummary?: string;
};

export type ApprovalCardState = {
  readonly id: string;
  readonly title: string;
  readonly action: string;
  readonly target?: string;
  readonly risk?: string;
  readonly controls: readonly ("approve" | "reject" | "inspect")[];
};

export type SlashMenuItemState = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
};

export type SlashMenuState = {
  readonly query: string;
  readonly items: readonly SlashMenuItemState[];
  readonly activeItemId?: string;
};

export type SteerState = {
  readonly draft: string;
  readonly cursorOffset: number;
  readonly queued?: {
    readonly text: string;
    readonly submittedAtMs?: number;
  };
};

export type TerminalMetrics = {
  readonly width: number;
  readonly height: number;
  readonly isTty: boolean;
};

export type OperatorConsoleState = {
  readonly transcript: readonly TranscriptBlock[];
  readonly prompt: PromptSurfaceState;
  readonly status: StatusRailState;
  readonly attachments: readonly AttachmentCardState[];
  readonly activeWork: ToolActivityState;
  readonly approvals: readonly ApprovalCardState[];
  readonly slash?: SlashMenuState;
  readonly steer?: SteerState;
  readonly focus: FocusState;
  readonly terminal: TerminalMetrics;
};

export type OperatorConsoleSurface =
  | "transcript"
  | "activeWork"
  | "queuedSteer"
  | "attachments"
  | "prompt"
  | "slashMenu"
  | "statusRail";

export const OPERATOR_CONSOLE_SURFACE_ORDER: readonly OperatorConsoleSurface[] = [
  "transcript",
  "activeWork",
  "queuedSteer",
  "attachments",
  "prompt",
  "slashMenu",
  "statusRail",
] as const;

export type CreateInitialOperatorConsoleStateInput = {
  readonly transcript?: readonly TranscriptBlock[];
  readonly prompt?: PromptSurfaceState;
  readonly status?: StatusRailState;
  readonly attachments?: readonly AttachmentCardState[];
  readonly activeWork?: ToolActivityState;
  readonly approvals?: readonly ApprovalCardState[];
  readonly slash?: SlashMenuState;
  readonly steer?: SteerState;
  readonly focus?: FocusState;
  readonly terminal?: TerminalMetrics;
};

export function getOperatorConsoleSurfaceOrder(): readonly OperatorConsoleSurface[] {
  return [...OPERATOR_CONSOLE_SURFACE_ORDER];
}

export function createInitialOperatorConsoleState(
  input: CreateInitialOperatorConsoleStateInput = {}
): OperatorConsoleState {
  return {
    transcript: input.transcript ?? [],
    prompt: input.prompt ?? createDefaultPromptSurfaceState(),
    status: input.status ?? createDefaultStatusRailState(),
    attachments: input.attachments ?? [],
    activeWork: input.activeWork ?? createDefaultToolActivityState(),
    approvals: input.approvals ?? [],
    ...(input.slash === undefined ? {} : { slash: input.slash }),
    ...(input.steer === undefined ? {} : { steer: input.steer }),
    focus: input.focus ?? createInitialFocusState(),
    terminal: input.terminal ?? createDefaultTerminalMetrics(),
  };
}

export function createDefaultPromptSurfaceState(): PromptSurfaceState {
  return {
    value: "",
    cursorOffset: 0,
    multiline: false,
    scrollOffset: 0,
    mode: "prompt",
  };
}

export function createDefaultStatusRailState(): StatusRailState {
  return {
    model: {
      label: "",
      state: "idle",
    },
    context: {
      usedTokens: 0,
    },
    sessionTimer: {
      elapsedMs: 0,
    },
  };
}

export function createDefaultToolActivityState(): ToolActivityState {
  return {
    events: [],
    scrollOffset: 0,
    expanded: false,
  };
}

export function createDefaultTerminalMetrics(): TerminalMetrics {
  return {
    width: 80,
    height: 24,
    isTty: false,
  };
}
