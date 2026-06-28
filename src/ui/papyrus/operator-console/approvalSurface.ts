import type { ParsedKeypress } from "../../input/parseKeypress.js";
import { stringWidth } from "../screen/stringWidth.js";
import {
  APPROVAL_FOCUS_CONTROLS,
  createApprovalFocusTarget,
  setFocus,
  type ApprovalFocusControl,
} from "./focusModel.js";
import type {
  ApprovalCardState,
  ApprovalControl,
  OperatorConsoleState,
} from "./operatorConsoleState.js";

export type ApprovalSurfaceRenderOptions = {
  readonly width: number;
  readonly height?: number;
};

export type ApprovalIntent =
  | { readonly type: "approve"; readonly approvalId: string }
  | { readonly type: "reject"; readonly approvalId: string }
  | { readonly type: "inspect"; readonly approvalId: string }
  | { readonly type: "none" };

export type ApprovalKeyResult = {
  readonly state: OperatorConsoleState;
  readonly intent: ApprovalIntent;
};

const APPROVE_LABEL = "Approve once";
const REJECT_LABEL = "Reject";
const INSPECT_LABEL = "Inspect";

export function getApprovalSurfaceDesiredHeight(approvals: readonly ApprovalCardState[]): number {
  if (approvals.length === 0) return 0;
  return approvals.reduce((height, approval) => height + getApprovalCardHeight(approval), 0);
}

export function renderApprovalSurface(
  approvals: readonly ApprovalCardState[],
  options: ApprovalSurfaceRenderOptions
): readonly string[] {
  const width = normalizeDimension(options.width);
  if (width <= 0 || approvals.length === 0) return [];

  const rows = approvals.flatMap((approval) => renderApprovalCard(approval, width));
  return options.height === undefined ? rows : rows.slice(0, normalizeDimension(options.height));
}

export function routeApprovalKey(
  state: OperatorConsoleState,
  key: ParsedKeypress
): ApprovalKeyResult {
  if (key.type !== "key") return { state, intent: { type: "none" } };

  const focused = getFocusedApproval(state);
  if (key.key === "tab" || key.key === "right" || key.key === "left") {
    if (focused === undefined || focused.approval.status !== "pending") return { state, intent: { type: "none" } };
    const direction = key.key === "left" || key.shift === true ? -1 : 1;
    const control = moveApprovalControl(focused.control, direction);
    return {
      state: {
        ...state,
        approvals: state.approvals.map((approval) => approval.id === focused.approval.id
          ? { ...approval, focusedControl: control }
          : approval),
        focus: setFocus(state.focus, createApprovalFocusTarget(focused.approval.id, control)),
      },
      intent: { type: "none" },
    };
  }

  if (focused === undefined || focused.approval.status !== "pending") return { state, intent: { type: "none" } };

  if (key.key === "enter") {
    return { state, intent: intentForControl(focused.approval.id, focused.control) };
  }

  if (key.key === "escape") {
    return { state, intent: { type: "reject", approvalId: focused.approval.id } };
  }

  return { state, intent: { type: "none" } };
}

function renderApprovalCard(approval: ApprovalCardState, width: number): readonly string[] {
  if (width <= 0) return [];
  if (width < 3) return [truncateVisibleCells(formatApprovalTitle(approval), width)];

  const contentWidth = Math.max(0, width - 4);
  const rows = [
    renderTopBorder(formatApprovalTitle(approval), width),
    renderContentRow(`Action: ${approval.action}`, contentWidth, width),
    renderContentRow(`Target: ${approval.target}`, contentWidth, width),
  ];

  if (approval.risk !== undefined && approval.risk.length > 0) {
    rows.push(renderContentRow(`Risk: ${approval.risk}`, contentWidth, width));
  }

  if (approval.summary !== undefined && approval.summary.length > 0) {
    rows.push(renderContentRow(approval.summary, contentWidth, width));
  }

  if (approval.diffStats !== undefined) {
    rows.push(renderContentRow("", contentWidth, width));
    rows.push(renderContentRow(formatDiffStats(approval.diffStats), contentWidth, width));
  }

  if (approval.status === "pending") {
    rows.push(renderContentRow("", contentWidth, width));
    rows.push(renderContentRow(formatApprovalControls(approval.focusedControl), contentWidth, width));
  } else {
    rows.push(renderContentRow(formatTerminalStatus(approval.status), contentWidth, width));
  }

  rows.push(renderBottomBorder(width));
  return rows;
}

function getApprovalCardHeight(approval: ApprovalCardState): number {
  let height = 4;
  if (approval.risk !== undefined && approval.risk.length > 0) height += 1;
  if (approval.summary !== undefined && approval.summary.length > 0) height += 1;
  if (approval.diffStats !== undefined) height += 2;
  if (approval.status === "pending") height += 2;
  else height += 1;
  return height;
}

function getFocusedApproval(
  state: OperatorConsoleState
): { readonly approval: ApprovalCardState; readonly control: ApprovalFocusControl } | undefined {
  const target = state.focus.target;
  if (target.kind !== "approval") return undefined;
  const approval = state.approvals.find((candidate) => candidate.id === target.approvalId);
  if (approval === undefined) return undefined;
  return {
    approval,
    control: approval.focusedControl ?? target.control,
  };
}

function moveApprovalControl(control: ApprovalControl, direction: 1 | -1): ApprovalControl {
  const index = APPROVAL_FOCUS_CONTROLS.indexOf(control);
  const startIndex = index === -1 ? 0 : index;
  const nextIndex = (startIndex + direction + APPROVAL_FOCUS_CONTROLS.length) % APPROVAL_FOCUS_CONTROLS.length;
  return APPROVAL_FOCUS_CONTROLS[nextIndex]!;
}

function intentForControl(approvalId: string, control: ApprovalControl): ApprovalIntent {
  switch (control) {
    case "approve":
      return { type: "approve", approvalId };
    case "reject":
      return { type: "reject", approvalId };
    case "inspect":
      return { type: "inspect", approvalId };
  }
}

function formatApprovalTitle(approval: ApprovalCardState): string {
  switch (approval.status) {
    case "pending":
      return "Approval required";
    case "approved":
      return "Approval approved";
    case "rejected":
      return "Approval rejected";
    case "expired":
      return "Approval expired";
    case "superseded":
      return "Approval superseded";
  }
}

function formatTerminalStatus(status: ApprovalCardState["status"]): string {
  switch (status) {
    case "approved":
      return "Approved once";
    case "rejected":
      return "Rejected by operator";
    case "expired":
      return "Approval expired";
    case "superseded":
      return "Approval superseded";
    case "pending":
      return "";
  }
}

function formatApprovalControls(focusedControl: ApprovalControl | undefined): string {
  if (focusedControl === undefined) return `[${APPROVE_LABEL}]   [${REJECT_LABEL}]   [${INSPECT_LABEL}]`;

  return APPROVAL_FOCUS_CONTROLS
    .map((control) => control === focusedControl ? `❯ ${controlLabel(control)}` : controlLabel(control))
    .join("        ");
}

function controlLabel(control: ApprovalControl): string {
  switch (control) {
    case "approve":
      return APPROVE_LABEL;
    case "reject":
      return REJECT_LABEL;
    case "inspect":
      return INSPECT_LABEL;
  }
}

function formatDiffStats(diffStats: NonNullable<ApprovalCardState["diffStats"]>): string {
  const added = Math.max(0, Math.floor(diffStats.added ?? 0));
  const removed = Math.max(0, Math.floor(diffStats.removed ?? 0));
  return `+${formatNumber(added)} lines  -${formatNumber(removed)} lines`;
}

function renderTopBorder(title: string, width: number): string {
  if (width <= 1) return "┌".slice(0, width);
  const label = `─ ${title} `;
  const remaining = Math.max(0, width - 2 - stringWidth(label));
  return truncateVisibleCells(`┌${label}${"─".repeat(remaining)}┐`, width);
}

function renderBottomBorder(width: number): string {
  if (width <= 1) return "└".slice(0, width);
  return `└${"─".repeat(Math.max(0, width - 2))}┘`;
}

function renderContentRow(row: string, contentWidth: number, width: number): string {
  if (width <= 1) return "│".slice(0, width);
  const content = padVisibleEnd(truncateVisibleCells(row, contentWidth), contentWidth);
  return truncateVisibleCells(`│ ${content} │`, width);
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

function formatNumber(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}
