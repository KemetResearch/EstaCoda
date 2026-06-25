import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyApprovalCardKey,
  buildApprovalCardRenderRows,
  createApprovalCardState,
  selectFocusedApprovalCardAction,
} from "./approvalCardModel.js";

describe("Papyrus approval card model", () => {
  it("creates generic approval card state with display-only risk metadata", () => {
    const state = createApprovalCardState({
      title: "Permission required",
      body: "Review this action before continuing.",
      severity: "warning",
      riskLabel: "workspace-write",
      details: [
        { kind: "detail", label: "Tool", value: "workspace.write" },
        { kind: "hint", text: "Core approval policy interprets this intent." },
      ],
      actions: [
        { value: "approve", label: "Approve" },
        { value: "reject", label: "Reject" },
        { value: "cancel", label: "Cancel" },
      ],
      keyboardHints: [{ key: "Enter", label: "Select" }],
    });

    expect(state).toMatchObject({
      title: "Permission required",
      body: "Review this action before continuing.",
      severity: "warning",
      riskLabel: "workspace-write",
      focusedAction: "approve",
      cancelable: true,
    });
    expect(state.details).toHaveLength(2);
    expect(state.keyboardHints).toEqual([{ key: "Enter", label: "Select" }]);
  });

  it("moves focus across enabled actions and skips disabled actions", () => {
    const state = createApprovalCardState({
      title: "Permission required",
      actions: [
        { value: "approve", label: "Approve" },
        { value: "always", label: "Always", disabled: true },
        { value: "reject", label: "Reject" },
      ],
    });

    const next = applyApprovalCardKey(state, { key: "arrowRight" }).state;
    expect(next.focusedAction).toBe("reject");
    expect(applyApprovalCardKey(next, { key: "arrowLeft" }).state.focusedAction).toBe("approve");
    expect(applyApprovalCardKey(next, { key: "home" }).state.focusedAction).toBe("approve");
    expect(applyApprovalCardKey(state, { key: "end" }).state.focusedAction).toBe("reject");
  });

  it("prevents disabled actions from receiving focus or selected intent", () => {
    const state = createApprovalCardState({
      title: "Permission required",
      focusedAction: "always",
      actions: [
        { value: "approve", label: "Approve" },
        { value: "always", label: "Always", disabled: true },
      ],
    });

    expect(state.focusedAction).toBe("approve");
    expect(selectFocusedApprovalCardAction({
      ...state,
      focusedAction: "always",
    })).toEqual({
      state: {
        ...state,
        focusedAction: "always",
      },
    });
  });

  it("returns selected action intent data only on enter", () => {
    const state = createApprovalCardState({
      title: "Permission required",
      focusedAction: "reject",
      actions: [
        { value: "approve", label: "Approve" },
        { value: "reject", label: "Reject" },
      ],
    });

    expect(applyApprovalCardKey(state, { key: "enter" }).intent).toEqual({
      type: "action",
      value: "reject",
    });
  });

  it("returns cancel intent only when cancelable", () => {
    const cancelable = createApprovalCardState({
      title: "Permission required",
      actions: [{ value: "approve", label: "Approve" }],
    });
    expect(applyApprovalCardKey(cancelable, { key: "escape" }).intent).toEqual({
      type: "cancel",
    });

    const required = createApprovalCardState({
      title: "Permission required",
      cancelable: false,
      actions: [{ value: "approve", label: "Approve" }],
    });
    expect(applyApprovalCardKey(required, { key: "escape" })).toEqual({ state: required });
  });

  it("builds inert render rows with action focus and disabled metadata", () => {
    const state = createApprovalCardState({
      title: "Permission required",
      body: "Run tool?",
      severity: "danger",
      riskLabel: "destructive-local",
      details: [{ kind: "detail", label: "Command", value: "rm -rf tmp" }],
      actions: [
        { value: "approve", label: "Approve", description: "Allow once" },
        { value: "reject", label: "Reject", disabled: true },
      ],
      keyboardHints: [{ key: "Esc", label: "Cancel" }],
    });

    expect(buildApprovalCardRenderRows(state)).toEqual([
      { kind: "title", text: "Permission required", severity: "danger", riskLabel: "destructive-local" },
      { kind: "body", text: "Run tool?" },
      { kind: "detail", label: "Command", value: "rm -rf tmp" },
      {
        kind: "action",
        value: "approve",
        label: "Approve",
        description: "Allow once",
        focused: true,
        disabled: false,
      },
      {
        kind: "action",
        value: "reject",
        label: "Reject",
        description: undefined,
        focused: false,
        disabled: true,
      },
      { kind: "keyboardHint", key: "Esc", label: "Cancel" },
    ]);
  });

  it("contains no security, approval grant, CLI, runtime, or provider imports", () => {
    const source = readFileSync(fileURLToPath(new URL("./approvalCardModel.ts", import.meta.url)), "utf8");

    expect(source).not.toMatch(/\bsrc\/(security|runtime|providers|cli)\//u);
    expect(source).not.toMatch(/\.\.\/\.\.\/(security|runtime|providers|cli)\//u);
    expect(source).not.toMatch(/\bgrantApproval\b/u);
    expect(source).not.toMatch(/\bWorkspaceApproval/u);
  });
});
