import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import {
  createInitialOperatorConsoleState,
  createOperatorConsoleLayout,
  renderOperatorConsoleTextLines,
  type OperatorConsoleState,
} from "./index.js";

describe("Papyrus operator console renderer", () => {
  it("returns deterministic output for the same state and layout", () => {
    const state = createState();
    const layout = createOperatorConsoleLayout(state, { width: 60, height: 8, isTty: true });

    expect(renderOperatorConsoleTextLines(state, layout)).toEqual(renderOperatorConsoleTextLines(state, layout));
  });

  it("returns deterministic output for attachment renders", () => {
    const state = createFullState();
    const layout = createOperatorConsoleLayout(state, { width: 120, height: 20, isTty: true });

    expect(renderOperatorConsoleTextLines(state, layout)).toEqual(renderOperatorConsoleTextLines(state, layout));
  });

  it("emits no ANSI escape sequences", () => {
    const output = renderOperatorConsoleTextLines(
      createFullState(),
      createOperatorConsoleLayout(createFullState(), { width: 80, height: 20, isTty: true })
    ).join("\n");

    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\\x1b");
    expect(output).not.toContain("\\u001b");
    expect(output).not.toContain("\\033");
  });

  it("emits no terminal cursor control sequences", () => {
    const output = renderOperatorConsoleTextLines(
      createFullState(),
      createOperatorConsoleLayout(createFullState(), { width: 80, height: 20, isTty: true })
    ).join("\n");

    expect(output).not.toMatch(/\b(moveCursor|clearLine|clearScreenDown|cursorTo|setRawMode)\b/);
    expect(output).not.toMatch(/\[[0-9;?]*[A-Za-z]/);
  });

  it("renders prompt before status rail", () => {
    const state = createState();
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 8, isTty: true });
    const output = renderOperatorConsoleTextLines(state, layout);

    expect(output[0]).toContain("Prompt");
    expect(output.at(-1)).toContain("session 00:00");
  });

  it("renders boxed prompt and status rail for minimal state", () => {
    const state = createState();
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 8, isTty: true });

    const output = renderOperatorConsoleTextLines(state, layout);
    expect(output[0]).toMatch(/^╭─ Prompt ─+╮$/u);
    expect(output[1]).toContain("│ ›");
    expect(output[2]).toMatch(/^╰─+╯$/u);
    expect(output[3]).toBe("model pending ○ │ ctx [▱▱▱▱▱▱▱▱▱▱] 0 0% │ session 00:00");
  });

  it("renders multiline prompt expansion with status rail below", () => {
    const state = createState({
      prompt: {
        value: [
          "write a migration plan for:",
          "- approval cards",
          "- pasted attachments",
          "- tool activity",
        ].join("\n"),
        cursorOffset: "write a migration plan for:\n- approval cards\n- pasted attachments\n- tool activity".length,
        multiline: true,
        scrollOffset: 0,
        mode: "prompt",
      },
      status: {
        model: { label: "kimi-k2.7-code", state: "working" },
        context: { usedTokens: 18400, totalTokens: 262000, percent: 7 },
        sessionTimer: { elapsedMs: 72_000 },
      },
    });
    const layout = createOperatorConsoleLayout(state, { width: 72, height: 20, isTty: true });

    const output = renderOperatorConsoleTextLines(state, layout);
    expect(output[0]).toContain("Prompt · multiline");
    expect(output).toContainEqual(expect.stringContaining("› write a migration plan for:"));
    expect(output).toContainEqual(expect.stringContaining("  - approval cards"));
    expect(output.at(-1)).toBe("kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 18.4k/262k 7% │ session 01:12");
    expect(output.every((line) => stringWidth(line) <= 72)).toBe(true);
  });

  it("renders attachments above steer input and status rail", () => {
    const state = createFullState();
    const layout = createOperatorConsoleLayout(state, { width: 120, height: 20, isTty: true });
    const output = renderOperatorConsoleTextLines(state, layout);

    expect(output[0]).toBe("Transcript: 1 block");
    expect(output).toContainEqual(expect.stringContaining("Active work"));
    expect(output).toContain("Attachments");
    expect(output.findIndex((line) => line.includes("Active work"))).toBeLessThan(
      output.findIndex((line) => line === "Attachments")
    );
    expect(output.findIndex((line) => line === "Attachments")).toBeLessThan(
      output.findIndex((line) => line.includes("Steer current turn"))
    );
    expect(output.at(-1)).toContain("session 01:12");
    expect(output.every((line) => stringWidth(line) <= 120)).toBe(true);
  });

  it("renders approval cards above active work, attachments, prompt, and status rail", () => {
    const state = createState({
      approvals: [{
        id: "approval-1",
        status: "pending",
        action: "write file",
        target: "src/runtime/provider-turn-loop.ts",
        risk: "runtime behavior change",
      }],
      activeWork: {
        items: [{
          id: "tool-1",
          toolName: "read_file",
          status: "running",
          summary: "src/cli/session-loop.ts",
          target: "src/cli/session-loop.ts",
          durationMs: 1_000,
        }],
        scrollOffset: 0,
        expanded: false,
      },
      attachments: [{
        id: "paste-1",
        kind: "pastedText",
        title: "pasted text",
        preview: "MVP known issue",
        content: "MVP known issue details",
        metadata: { chars: 2_481 },
      }],
      status: {
        model: { label: "kimi-k2.7-code", state: "working" },
        context: { usedTokens: 18400, totalTokens: 262000, percent: 7 },
        sessionTimer: { elapsedMs: 72_000 },
      },
    });
    const output = renderOperatorConsoleTextLines(
      state,
      createOperatorConsoleLayout(state, { width: 120, height: 24, isTty: true })
    );
    const approvalIndex = output.findIndex((line) => line.includes("Approval required"));
    const activeWorkIndex = output.findIndex((line) => line.includes("Active work"));
    const attachmentsIndex = output.findIndex((line) => line === "Attachments");
    const promptIndex = output.findIndex((line) => line.includes("Prompt"));
    const statusIndex = output.findIndex((line) => line.includes("session 01:12"));

    expect(approvalIndex).toBeGreaterThanOrEqual(0);
    expect(approvalIndex).toBeLessThan(activeWorkIndex);
    expect(approvalIndex).toBeLessThan(attachmentsIndex);
    expect(approvalIndex).toBeLessThan(promptIndex);
    expect(approvalIndex).toBeLessThan(statusIndex);
    expect(output).toContainEqual(expect.stringContaining("[Approve once]"));
    expect(output.every((line) => stringWidth(line) <= 120)).toBe(true);
  });

  it("includes approval card output deterministically without mutating state", () => {
    const state = createState({
      approvals: [{
        id: "approval-1",
        status: "pending",
        action: "write file",
        target: "src/runtime/provider-turn-loop.ts",
        risk: "runtime behavior change",
        focusedControl: "reject",
      }],
    });
    const before = JSON.stringify(state);
    const layout = createOperatorConsoleLayout(state, { width: 72, height: 12, isTty: true });
    const first = renderOperatorConsoleTextLines(state, layout);
    const second = renderOperatorConsoleTextLines(state, layout);

    expect(first).toEqual(second);
    expect(first).toContainEqual(expect.stringContaining("Approval required"));
    expect(first).toContainEqual(expect.stringContaining("Approve once        ❯ Reject        Inspect"));
    expect(first.every((line) => stringWidth(line) <= 72)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("places active work above queued steer, attachments, steer input, and status rail when present", () => {
    const state = createFullState();
    const layout = createOperatorConsoleLayout(state, { width: 120, height: 20, isTty: true });
    const output = renderOperatorConsoleTextLines(state, layout);
    const activeWorkIndex = output.findIndex((line) => line.includes("Active work"));
    const queuedSteerIndex = output.findIndex((line) => line.includes("Queued steer"));
    const attachmentsIndex = output.findIndex((line) => line === "Attachments");
    const steerInputIndex = output.findIndex((line) => line.includes("Steer current turn"));
    const statusIndex = output.findIndex((line) => line.includes("session 01:12"));

    expect(activeWorkIndex).toBeGreaterThanOrEqual(0);
    expect(queuedSteerIndex).toBeGreaterThan(activeWorkIndex);
    expect(queuedSteerIndex).toBeLessThan(attachmentsIndex);
    expect(activeWorkIndex).toBeLessThan(attachmentsIndex);
    expect(activeWorkIndex).toBeLessThan(steerInputIndex);
    expect(activeWorkIndex).toBeLessThan(statusIndex);
  });

  it("renders queued steer above steer input and keeps status rail below it", () => {
    const state = createState({
      steer: {
        draft: "",
        cursorOffset: 0,
        mode: "queued",
        queued: {
          id: "steer-1",
          text: "focus only on approval cards and pasted attachments",
          status: "queued",
        },
      },
      status: {
        model: { label: "kimi-k2.7-code", state: "working" },
        context: { usedTokens: 18400, totalTokens: 262000, percent: 7 },
        sessionTimer: { elapsedMs: 31_000 },
      },
    });
    const output = renderOperatorConsoleTextLines(
      state,
      createOperatorConsoleLayout(state, { width: 72, height: 12, isTty: true })
    );
    const queuedSteerIndex = output.findIndex((line) => line.includes("Queued steer"));
    const steerInputIndex = output.findIndex((line) => line.includes("Steer current turn"));
    const statusIndex = output.findIndex((line) => line.includes("session 00:31"));

    expect(queuedSteerIndex).toBeGreaterThanOrEqual(0);
    expect(queuedSteerIndex).toBeLessThan(steerInputIndex);
    expect(steerInputIndex).toBeLessThan(statusIndex);
    expect(output).toContainEqual(expect.stringContaining("Will apply at next safe boundary · Esc cancel"));
    expect(output).not.toContainEqual(expect.stringContaining("Prompt"));
    expect(output.every((line) => stringWidth(line) <= 72)).toBe(true);
  });

  it("keeps status rail limited to model, context, and timer while steer is active", () => {
    const state = createState({
      steer: {
        draft: "focus only on approvals",
        cursorOffset: 23,
        mode: "drafting",
      },
      status: {
        model: { label: "kimi-k2.7-code", state: "working" },
        context: { usedTokens: 18400, totalTokens: 262000, percent: 7 },
        sessionTimer: { elapsedMs: 31_000 },
      },
    });
    const output = renderOperatorConsoleTextLines(
      state,
      createOperatorConsoleLayout(state, { width: 72, height: 8, isTty: true })
    );
    const status = output.at(-1) ?? "";

    expect(status).toBe("kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 18.4k/262k 7% │ session 00:31");
    expect(status).not.toMatch(/\b(steer|approval|attachment|tool|workspace|trust|setup|channel)\b/iu);
  });

  it("renders steer draft instead of prompt when steering is active", () => {
    const state = createState({
      steer: {
        draft: "focus only on approval cards and pasted attachments",
        cursorOffset: 51,
        mode: "drafting",
      },
      status: {
        model: { label: "kimi-k2.7-code", state: "working" },
        context: { usedTokens: 18400, totalTokens: 262000, percent: 7 },
        sessionTimer: { elapsedMs: 31_000 },
      },
    });
    const output = renderOperatorConsoleTextLines(
      state,
      createOperatorConsoleLayout(state, { width: 72, height: 8, isTty: true })
    );
    const steerInputIndex = output.findIndex((line) => line.includes("Steer current turn"));
    const statusIndex = output.findIndex((line) => line.includes("session 00:31"));

    expect(steerInputIndex).toBeGreaterThanOrEqual(0);
    expect(output).not.toContainEqual(expect.stringContaining("Prompt"));
    expect(output).toContainEqual(expect.stringContaining("› focus only on approval cards"));
    expect(statusIndex).toBeGreaterThan(steerInputIndex);
    expect(output.every((line) => stringWidth(line) <= 72)).toBe(true);
  });

  it("does not reserve active work rows when active work is empty", () => {
    const state = createState();
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 8, isTty: true });
    const output = renderOperatorConsoleTextLines(state, layout);

    expect(output).not.toContainEqual(expect.stringContaining("Active work"));
    expect(output[0]).toContain("Prompt");
  });

  it("does not reserve attachment rows when attachments are absent", () => {
    const state = createState();
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 8, isTty: true });
    const output = renderOperatorConsoleTextLines(state, layout);

    expect(output).not.toContain("Attachments");
    expect(output[0]).toContain("Prompt");
  });

  it("keeps rendered line widths within the terminal width", () => {
    const state = createFullState();
    const layout = createOperatorConsoleLayout(state, { width: 20, height: 20, isTty: true });
    const output = renderOperatorConsoleTextLines(state, layout);

    expect(output.length).toBeGreaterThan(0);
    expect(output.every((line) => stringWidth(line) <= 20)).toBe(true);
  });

  it("does not render hidden regions", () => {
    const state = createFullState();
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 2, isTty: true });

    expect(renderOperatorConsoleTextLines(state, layout)).toEqual([
      "Steer: >",
      "kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 18.4k/262k 7% │ session 01:12",
    ]);
  });

  it("keeps prompt and status visible under constrained layout", () => {
    const state = createFullState();
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 2, isTty: true });
    const output = renderOperatorConsoleTextLines(state, layout);

    expect(output).toHaveLength(2);
    expect(output[0]).toContain("Steer:");
    expect(output[1]).toContain("session 01:12");
  });

  it("hidden optional regions do not affect prompt and status render", () => {
    const state = createFullState();
    const constrained = createOperatorConsoleLayout(state, { width: 80, height: 2, isTty: true });
    const withoutOptional = createOperatorConsoleLayout(createState({
      prompt: state.prompt,
      status: state.status,
      steer: state.steer,
    }), { width: 80, height: 2, isTty: true });

    expect(renderOperatorConsoleTextLines(state, constrained)).toEqual(
      renderOperatorConsoleTextLines(createState({
        prompt: state.prompt,
        status: state.status,
        steer: state.steer,
      }), withoutOptional)
    );
  });

  it("does not mutate state", () => {
    const state = createFullState();
    const snapshot = JSON.stringify(state);
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 20, isTty: true });

    renderOperatorConsoleTextLines(state, layout);

    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

function createState(input: Partial<OperatorConsoleState> = {}): OperatorConsoleState {
  return createInitialOperatorConsoleState({
    terminal: { width: 80, height: 24, isTty: true },
    ...input,
  });
}

function createFullState(): OperatorConsoleState {
  return createState({
    transcript: [{ id: "t1", role: "assistant", text: "Ready." }],
    prompt: {
      value: "tell EstaCoda what to do",
      cursorOffset: 26,
      multiline: false,
      scrollOffset: 0,
      mode: "prompt",
    },
    status: {
      model: { label: "kimi-k2.7-code", state: "working" },
      context: { usedTokens: 18400, totalTokens: 262000, percent: 7 },
      sessionTimer: { elapsedMs: 72_000 },
    },
    activeWork: {
      items: [{
        id: "tool-1",
        toolName: "read_file",
        status: "running",
        summary: "src/cli/session-loop.ts",
        target: "src/cli/session-loop.ts",
        durationMs: 1_000,
      }],
      scrollOffset: 0,
      expanded: true,
    },
    steer: {
      draft: "",
      cursorOffset: 0,
      mode: "queued",
      queued: {
        id: "steer-1",
        text: "focus on approvals",
        status: "queued",
      },
    },
    attachments: [{
      id: "paste-1",
      kind: "pastedText",
      title: "pasted text",
      preview: "MVP known issue",
      content: "MVP known issue details",
      metadata: { chars: 2_481 },
    }],
    slash: {
      query: "/mo",
      items: [{ id: "model", label: "/model" }],
    },
  });
}
