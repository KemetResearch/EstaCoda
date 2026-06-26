import { describe, expect, it } from "vitest";
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

  it("renders prompt and status placeholders for minimal state", () => {
    const state = createState();
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 8, isTty: true });

    expect(renderOperatorConsoleTextLines(state, layout)).toEqual([
      "Prompt: >",
      "prompt",
      "prompt",
      "model pending | ctx 0 | session 00:00",
    ]);
  });

  it("keeps rendered line widths within the terminal width", () => {
    const state = createFullState();
    const layout = createOperatorConsoleLayout(state, { width: 20, height: 20, isTty: true });
    const output = renderOperatorConsoleTextLines(state, layout);

    expect(output.length).toBeGreaterThan(0);
    expect(output.every((line) => line.length <= 20)).toBe(true);
  });

  it("does not render hidden regions", () => {
    const state = createFullState();
    const layout = createOperatorConsoleLayout(state, { width: 80, height: 2, isTty: true });

    expect(renderOperatorConsoleTextLines(state, layout)).toEqual([
      "Prompt: tell EstaCoda what to do",
      "kimi-k2.7-code | ctx 18400/262000 7% | session 01:12",
    ]);
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
      events: [{ id: "tool-1", label: "read_file", state: "running" }],
      scrollOffset: 0,
      expanded: true,
    },
    steer: {
      draft: "",
      cursorOffset: 0,
      queued: { text: "focus on approvals" },
    },
    attachments: [{
      id: "paste-1",
      kind: "pastedText",
      title: "pasted text",
      summary: "2,481 chars",
    }],
    slash: {
      query: "/mo",
      items: [{ id: "model", label: "/model" }],
    },
  });
}
