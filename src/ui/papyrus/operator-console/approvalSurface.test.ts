import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import {
  APPROVAL_FOCUS_CONTROLS,
  createInitialOperatorConsoleState,
  renderApprovalSurface,
  routeApprovalKey,
  type ApprovalCardState,
  type OperatorConsoleState,
} from "./index.js";

const thisDir = dirname(fileURLToPath(import.meta.url));

describe("Papyrus operator console approval surface", () => {
  it("renders a pending approval card with action, target, and risk", () => {
    const output = renderApprovalSurface([approval()], { width: 54 });
    const text = output.join("\n");

    expect(output[0]).toMatch(/^┌─ Approval required ─+┐$/u);
    expect(text).toContain("Action: run migration");
    expect(text).toContain("Target: production database");
    expect(text).toContain("Risk: schema change");
    expect(text).toContain("[Approve once]   [Reject]   [Inspect]");
  });

  it("renders file-write approval diff stats", () => {
    const output = renderApprovalSurface([
      approval({
        action: "write file",
        target: "src/runtime/provider-turn-loop.ts",
        risk: "runtime behavior change",
        diffStats: { added: 42, removed: 17 },
      }),
    ], { width: 64 });
    const text = output.join("\n");

    expect(text).toContain("Action: write file");
    expect(text).toContain("Target: src/runtime/provider-turn-loop.ts");
    expect(text).toContain("Risk: runtime behavior change");
    expect(text).toContain("+42 lines  -17 lines");
  });

  it("renders only approve once, reject, and inspect controls for pending approvals", () => {
    const text = renderApprovalSurface([approval()], { width: 64 }).join("\n");

    expect(text).toContain("[Approve once]");
    expect(text).toContain("[Reject]");
    expect(text).toContain("[Inspect]");
    expect(text).not.toMatch(/feedback|amend|session|persistent|always|do not ask/iu);
  });

  it("renders visual focus for the focused approval control", () => {
    const output = renderApprovalSurface([
      approval({
        action: "write file",
        focusedControl: "approve",
      }),
    ], { width: 64 });

    expect(output).toContainEqual(expect.stringContaining("❯ Approve once"));
    expect(output.join("\n")).not.toContain("[Approve once]");
  });

  it("cycles focus forward and backward across approval controls", () => {
    const state = createState({ focusedControl: "approve" });
    const reject = routeApprovalKey(state, { type: "key", key: "tab" }).state;
    const inspect = routeApprovalKey(reject, { type: "key", key: "right" }).state;
    const back = routeApprovalKey(inspect, { type: "key", key: "left" }).state;

    expect(focusedApproval(back).focusedControl).toBe("reject");
    expect(reject.focus.target).toEqual({ kind: "approval", approvalId: "approval-1", control: "reject" });
    expect(focusedApproval(inspect).focusedControl).toBe("inspect");
  });

  it("cycles reverse focus from inspect to reject to approve", () => {
    const reject = routeApprovalKey(createState({ focusedControl: "inspect" }), { type: "key", key: "tab", shift: true }).state;
    const approve = routeApprovalKey(reject, { type: "key", key: "left" }).state;

    expect(focusedApproval(reject).focusedControl).toBe("reject");
    expect(focusedApproval(approve).focusedControl).toBe("approve");
  });

  it("emits approve, reject, and inspect intents from focused controls", () => {
    expect(routeApprovalKey(createState({ focusedControl: "approve" }), { type: "key", key: "enter" }).intent).toEqual({
      type: "approve",
      approvalId: "approval-1",
    });
    expect(routeApprovalKey(createState({ focusedControl: "reject" }), { type: "key", key: "enter" }).intent).toEqual({
      type: "reject",
      approvalId: "approval-1",
    });
    expect(routeApprovalKey(createState({ focusedControl: "inspect" }), { type: "key", key: "enter" }).intent).toEqual({
      type: "inspect",
      approvalId: "approval-1",
    });
  });

  it("emits reject intent on Escape for pending approval", () => {
    expect(routeApprovalKey(createState({ focusedControl: "approve" }), { type: "key", key: "escape" }).intent).toEqual({
      type: "reject",
      approvalId: "approval-1",
    });
  });

  it("does not emit actionable intents for non-pending cards", () => {
    for (const status of ["approved", "rejected", "expired", "superseded"] as const) {
      const state = createState({ status, focusedControl: "approve" });

      expect(routeApprovalKey(state, { type: "key", key: "enter" }).intent).toEqual({ type: "none" });
      expect(routeApprovalKey(state, { type: "key", key: "escape" }).intent).toEqual({ type: "none" });
    }
  });

  it("renders approved, rejected, expired, and superseded cards as non-actionable", () => {
    const text = renderApprovalSurface([
      approval({ status: "approved" }),
      approval({ id: "approval-2", status: "rejected" }),
      approval({ id: "approval-3", status: "expired" }),
      approval({ id: "approval-4", status: "superseded" }),
    ], { width: 64 }).join("\n");

    expect(text).toContain("Approval approved");
    expect(text).toContain("Approved once");
    expect(text).toContain("Approval rejected");
    expect(text).toContain("Rejected by operator");
    expect(text).toContain("Approval expired");
    expect(text).toContain("Approval superseded");
    expect(text).not.toContain("[Approve once]");
    expect(text).not.toContain("[Reject]");
    expect(text).not.toContain("[Inspect]");
  });

  it("does not render actionable controls for hardline-like rejected approvals", () => {
    const text = renderApprovalSurface([
      approval({
        status: "rejected",
        risk: "hardline policy denial",
        summary: "Blocked by command policy",
      }),
    ], { width: 64 }).join("\n");

    expect(text).toContain("Blocked by command policy");
    expect(text).not.toContain("Approve once");
    expect(text).not.toContain("Inspect");
  });

  it("truncates long action, target, and risk text safely", () => {
    const output = renderApprovalSurface([
      approval({
        action: "write file with a very long generated migration and runtime policy change",
        target: "src/runtime/deeply/nested/provider-turn-loop-with-a-very-long-name.ts",
        risk: "runtime behavior change with persistence and approval implications",
      }),
    ], { width: 44 });
    const text = output.join("\n");

    expect(text).toContain("write file");
    expect(text).not.toContain("provider-turn-loop-with-a-very-long-name.ts");
    expect(output.every((line) => stringWidth(line) <= 44)).toBe(true);
  });

  it("emits no ANSI escape sequences or cursor-control strings", () => {
    const output = renderApprovalSurface([approval({ focusedControl: "approve" })], { width: 64 }).join("\n");

    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\\x1b");
    expect(output).not.toContain("\\u001b");
    expect(output).not.toContain("\\033");
    expect(output).not.toMatch(/\b(moveCursor|clearLine|clearScreenDown|cursorTo|setRawMode)\b/u);
  });

  it("does not mutate approval state while rendering or routing", () => {
    const state = createState({ focusedControl: "approve" });
    const before = JSON.stringify(state);

    renderApprovalSurface(state.approvals, { width: 64 });
    routeApprovalKey(state, { type: "key", key: "enter" });

    expect(JSON.stringify(state)).toBe(before);
  });

  it("keeps approval focus controls limited to approve, reject, and inspect", () => {
    expect(APPROVAL_FOCUS_CONTROLS).toEqual(["approve", "reject", "inspect"]);
  });

  it("keeps approval policy outside the UI surface", () => {
    const source = readFileSync(join(thisDir, "approvalSurface.ts"), "utf8");

    expect(source).not.toMatch(/\bgrantApproval\b/u);
    expect(source).not.toMatch(/\bpersist(?:ent)?Approval\b/u);
    expect(source).not.toMatch(/\bassessCommandSafety\b/u);
  });
});

function createState(input: Partial<ApprovalCardState> = {}): OperatorConsoleState {
  const card = approval(input);
  return createInitialOperatorConsoleState({
    approvals: [card],
    focus: {
      target: {
        kind: "approval",
        approvalId: card.id,
        control: card.focusedControl ?? "approve",
      },
    },
  });
}

function focusedApproval(state: OperatorConsoleState): ApprovalCardState {
  return state.approvals[0]!;
}

function approval(input: Partial<ApprovalCardState> = {}): ApprovalCardState {
  return {
    id: input.id ?? "approval-1",
    status: input.status ?? "pending",
    action: input.action ?? "run migration",
    target: input.target ?? "production database",
    risk: input.risk ?? "schema change",
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.diffStats === undefined ? {} : { diffStats: input.diffStats }),
    ...(input.focusedControl === undefined ? {} : { focusedControl: input.focusedControl }),
  };
}
