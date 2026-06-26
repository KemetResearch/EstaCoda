import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import {
  createFileExcerptAttachment,
  createInitialOperatorConsoleState,
  createPastedTextAttachment,
  focusNextAttachment,
  focusPreviousAttachment,
  formatSubmittedPromptWithAttachmentReferences,
  getFocusedAttachment,
  renderAttachmentSurface,
  routeAttachmentKey,
  type AttachmentCardState,
  type OperatorConsoleState,
} from "./index.js";

describe("Papyrus operator console attachment surface", () => {
  it("stores pasted text content separately from prompt text", () => {
    const pasted = createPastedTextAttachment({
      id: "paste-1",
      content: "MVP known issue\nfull payload stays out of prompt",
      preview: "MVP known issue...",
    });
    const state = createState({
      prompt: {
        value: "summarize this and turn it into a regression test",
        cursorOffset: 49,
        multiline: false,
        scrollOffset: 0,
        mode: "prompt",
      },
      attachments: [pasted],
    });

    expect(state.prompt.value).not.toContain("full payload");
    expect(state.attachments[0]?.content).toContain("full payload stays out of prompt");
  });

  it("renders pasted text preview and character count", () => {
    const output = renderAttachmentSurface([pastedAttachment("paste-1", { chars: 2_481 })], { width: 50 });

    expect(output.join("\n")).toContain("MVP known issue");
    expect(output.join("\n")).toContain("2,481 chars");
  });

  it("renders file excerpt path and line count", () => {
    const output = renderAttachmentSurface([fileAttachment("file-1", "src/cli/session-loop.ts", 184)], { width: 50 });

    expect(output.join("\n")).toContain("src/cli/session-loop.ts");
    expect(output.join("\n")).toContain("184 lines");
  });

  it("renders horizontal cards on wide terminals", () => {
    const output = renderAttachmentSurface(sampleAttachments(), { width: 120 });

    expect(output).toHaveLength(5);
    expect(output[1]).toContain("╭─ pasted text");
    expect(output[1]).toContain("╭─ file excerpt");
    expect(output[1]?.match(/╭─/gu)).toHaveLength(3);
    expect(output.every((line) => stringWidth(line) <= 120)).toBe(true);
  });

  it("wraps cards at mid width", () => {
    const output = renderAttachmentSurface(sampleAttachments(), { width: 100 });

    expect(output).toHaveLength(9);
    expect(output[1]?.match(/╭─/gu)).toHaveLength(2);
    expect(output[5]?.match(/╭─/gu)).toHaveLength(1);
    expect(output.every((line) => stringWidth(line) <= 100)).toBe(true);
  });

  it("stacks cards on narrow terminals", () => {
    const output = renderAttachmentSurface([
      pastedAttachment("paste-1", { chars: 2_481 }),
      fileAttachment("file-1", "src/runtime/provider-turn-loop.ts", 184),
    ], { width: 50 });

    expect(output).toHaveLength(9);
    expect(output[1]).toContain("╭─ pasted text");
    expect(output[5]).toContain("╭─ file excerpt");
    expect(output.join("\n")).toContain("Enter open · Esc remove");
  });

  it("enforces at most two visible card rows by default", () => {
    const output = renderAttachmentSurface(manyAttachments(7), { width: 120 });

    expect(output.filter((line) => line.includes("╭─"))).toHaveLength(2);
    expect(output.at(-1)).toContain("+1 more attachments");
  });

  it("renders overflow when constrained to one card row", () => {
    const output = renderAttachmentSurface(manyAttachments(7), { width: 120, height: 6 });

    expect(output).toHaveLength(6);
    expect(output.at(-1)).toBe("+4 more attachments · Enter open attachment tray");
  });

  it("moves focus from prompt to attachments and back", () => {
    const state = createState({ attachments: sampleAttachments() });
    const first = focusNextAttachment(state);
    const second = focusNextAttachment(first);
    const third = focusNextAttachment(second);
    const prompt = focusNextAttachment(third);

    expect(first.focus.target).toEqual({ kind: "attachment", attachmentId: "paste-1" });
    expect(second.focus.target).toEqual({ kind: "attachment", attachmentId: "file-1" });
    expect(third.focus.target).toEqual({ kind: "attachment", attachmentId: "paste-2" });
    expect(prompt.focus.target).toEqual({ kind: "prompt" });
  });

  it("moves focus in reverse with shift direction", () => {
    const state = createState({ attachments: sampleAttachments() });
    const last = focusPreviousAttachment(state);
    const previous = focusPreviousAttachment(last);

    expect(last.focus.target).toEqual({ kind: "attachment", attachmentId: "paste-2" });
    expect(previous.focus.target).toEqual({ kind: "attachment", attachmentId: "file-1" });
  });

  it("routes tab and shift-tab through attachment focus", () => {
    const state = createState({ attachments: sampleAttachments() });
    const first = routeAttachmentKey(state, { type: "key", key: "tab" });
    const prompt = routeAttachmentKey(first.state, { type: "key", key: "tab", shift: true });

    expect(first.state.focus.target).toEqual({ kind: "attachment", attachmentId: "paste-1" });
    expect(first.intent).toEqual({ type: "none" });
    expect(prompt.state.focus.target).toEqual({ kind: "prompt" });
  });

  it("submits prompt with Enter when prompt is focused", () => {
    const result = routeAttachmentKey(createState({ attachments: sampleAttachments() }), { type: "key", key: "enter" });

    expect(result.intent).toEqual({ type: "submitPrompt" });
  });

  it("opens focused attachment preview with Enter", () => {
    const state = focusNextAttachment(createState({ attachments: sampleAttachments() }));
    const result = routeAttachmentKey(state, { type: "key", key: "enter" });

    expect(getFocusedAttachment(state)?.id).toBe("paste-1");
    expect(result.intent).toEqual({ type: "openPreview", attachmentId: "paste-1" });
  });

  it("removes focused attachment with Escape", () => {
    const state = focusNextAttachment(createState({ attachments: sampleAttachments() }));
    const result = routeAttachmentKey(state, { type: "key", key: "escape" });

    expect(result.intent).toEqual({ type: "remove", attachmentId: "paste-1" });
  });

  it("formats submitted transcript attachment references without full payloads", () => {
    const transcript = formatSubmittedPromptWithAttachmentReferences(
      "summarize this and turn it into a regression test",
      [
        createPastedTextAttachment({
          id: "paste-1",
          content: "SECRET full pasted payload that should not appear",
          preview: "MVP known issue...",
        }),
        fileAttachment("file-1", "src/cli/session-loop.ts", 184),
      ]
    );

    expect(transcript).toBe([
      "summarize this and turn it into a regression test",
      "Attachments:",
      "- pasted text · 49 chars",
      "- file excerpt · src/cli/session-loop.ts · 184 lines",
    ].join("\n"));
    expect(transcript).not.toContain("SECRET full pasted payload");
  });

  it("emits no ANSI escape sequences or cursor-control strings", () => {
    const output = renderAttachmentSurface(sampleAttachments(), { width: 120 }).join("\n");

    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\\x1b");
    expect(output).not.toContain("\\u001b");
    expect(output).not.toContain("\\033");
    expect(output).not.toMatch(/\b(moveCursor|clearLine|clearScreenDown|cursorTo|setRawMode)\b/u);
    expect(output).not.toMatch(/\[[0-9;?]*[A-Za-z]/u);
  });

  it("does not mutate attachment state during render or focus routing", () => {
    const state = createState({ attachments: sampleAttachments() });
    const before = JSON.stringify(state);

    renderAttachmentSurface(state.attachments, { width: 120 });
    routeAttachmentKey(state, { type: "key", key: "tab" });

    expect(JSON.stringify(state)).toBe(before);
  });
});

function createState(input: Partial<OperatorConsoleState> = {}): OperatorConsoleState {
  return createInitialOperatorConsoleState({
    terminal: { width: 120, height: 24, isTty: true },
    ...input,
  });
}

function sampleAttachments(): readonly AttachmentCardState[] {
  return [
    pastedAttachment("paste-1", { preview: "MVP known issue...", chars: 2_481 }),
    fileAttachment("file-1", "src/cli/session-loop.ts", 184),
    pastedAttachment("paste-2", { preview: "Stack trace from setup...", chars: 918 }),
  ];
}

function manyAttachments(count: number): readonly AttachmentCardState[] {
  return Array.from({ length: count }, (_, index) => pastedAttachment(`paste-${index + 1}`, {
    preview: `Attachment ${index + 1}`,
    chars: 900 + index,
  }));
}

function pastedAttachment(
  id: string,
  options: { readonly preview?: string; readonly chars?: number } = {}
): AttachmentCardState {
  const content = "x".repeat(options.chars ?? 918);
  return createPastedTextAttachment({
    id,
    content,
    preview: options.preview ?? "MVP known issue...",
  });
}

function fileAttachment(id: string, path: string, lineCount: number): AttachmentCardState {
  return createFileExcerptAttachment({
    id,
    path,
    content: Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join("\n"),
  });
}
