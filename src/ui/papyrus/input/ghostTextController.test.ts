import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acceptPartialGhostText,
  acceptGhostText,
  clearGhostText,
  createGhostTextState,
  dismissGhostText,
  InvalidGhostTextRangeError,
  isGhostTextVisible,
  setGhostTextSuggestion,
  updateGhostTextInput,
} from "./ghostTextController.js";

describe("Papyrus ghost text controller", () => {
  it("creates empty no-ghost state", () => {
    expect(createGhostTextState()).toEqual({
      input: "",
      cursorOffset: 0,
      visible: false,
      dismissed: false,
      generation: undefined,
    });
  });

  it("sets, clears, and dismisses ghost suggestions as state data", () => {
    let state = createGhostTextState({ input: "hel", cursorOffset: 3 });

    state = setGhostTextSuggestion(state, {
      suggestionText: "help",
      replacementRange: { start: 0, end: 3 },
      generation: 1,
    });
    expect(state).toMatchObject({
      suggestionText: "help",
      replacementRange: { start: 0, end: 3 },
      visible: true,
      dismissed: false,
      generation: 1,
    });
    expect(isGhostTextVisible(state)).toBe(true);

    const dismissed = dismissGhostText(state);
    expect(dismissed.intent).toEqual({ type: "dismiss" });
    expect(dismissed.state.visible).toBe(false);
    expect(dismissed.state.dismissed).toBe(true);

    expect(clearGhostText(dismissed.state)).toEqual({
      input: "hel",
      cursorOffset: 3,
      visible: false,
      dismissed: false,
      generation: 1,
    });
  });

  it("accepts ghost text by returning replacement intent only", () => {
    const state = setGhostTextSuggestion(
      createGhostTextState({ input: "run /he now", cursorOffset: 7 }),
      {
        suggestionText: "/help",
        replacementRange: { start: 4, end: 7 },
      }
    );

    const result = acceptGhostText(state);
    expect(result.state).toBe(state);
    expect(result.intent).toEqual({
      type: "replace",
      replacementText: "/help",
      replacementRange: { start: 4, end: 7 },
      nextInput: "run /help now",
      nextCursorOffset: 9,
    });
    expect(state.input).toBe("run /he now");
  });

  it("partially accepts the next word or token without mutating state", () => {
    const state = setGhostTextSuggestion(
      createGhostTextState({ input: "hel", cursorOffset: 3 }),
      {
        suggestionText: "hello world",
        replacementRange: { start: 0, end: 3 },
      }
    );

    const result = acceptPartialGhostText(state);
    expect(result.state).toBe(state);
    expect(result.intent).toEqual({
      type: "replace",
      replacementText: "hello ",
      replacementRange: { start: 0, end: 3 },
      nextInput: "hello ",
      nextCursorOffset: 6,
      acceptedText: "lo ",
      remainingText: "world",
    });
    expect(state.input).toBe("hel");
  });

  it("partially accepts one grapheme when no word boundary is available", () => {
    const state = setGhostTextSuggestion(
      createGhostTextState({ input: "", cursorOffset: 0 }),
      {
        suggestionText: "abc",
        replacementRange: { start: 0, end: 0 },
      }
    );

    expect(acceptPartialGhostText(state).intent).toEqual({
      type: "replace",
      replacementText: "a",
      replacementRange: { start: 0, end: 0 },
      nextInput: "a",
      nextCursorOffset: 1,
      acceptedText: "a",
      remainingText: "bc",
    });
  });

  it("partially accepts Arabic text without splitting graphemes", () => {
    const state = setGhostTextSuggestion(
      createGhostTextState({ input: "مر", cursorOffset: "مر".length }),
      {
        suggestionText: "مرحبا عالم",
        replacementRange: { start: 0, end: "مر".length },
      }
    );

    expect(acceptPartialGhostText(state).intent).toMatchObject({
      replacementText: "مرحبا ",
      nextInput: "مرحبا ",
      acceptedText: "حبا ",
      remainingText: "عالم",
    });
  });

  it("partially accepts emoji clusters and combining marks without splitting graphemes", () => {
    const family = "👨‍👩‍👧‍👦";
    const emoji = setGhostTextSuggestion(
      createGhostTextState({ input: "say ", cursorOffset: 4 }),
      {
        suggestionText: `${family} family`,
        replacementRange: { start: 4, end: 4 },
      }
    );
    expect(acceptPartialGhostText(emoji).intent).toMatchObject({
      replacementText: family,
      nextInput: `say ${family}`,
      acceptedText: family,
      remainingText: " family",
    });

    const combining = "e\u0301";
    const accented = setGhostTextSuggestion(
      createGhostTextState({ input: "", cursorOffset: 0 }),
      {
        suggestionText: `${combining}clair`,
        replacementRange: { start: 0, end: 0 },
      }
    );
    expect(acceptPartialGhostText(accented).intent).toMatchObject({
      replacementText: combining,
      nextInput: combining,
      acceptedText: combining,
      remainingText: "clair",
    });
  });

  it("partially accepts CJK text one grapheme at a time when no word boundary is available", () => {
    const state = setGhostTextSuggestion(
      createGhostTextState({ input: "", cursorOffset: 0 }),
      {
        suggestionText: "東京駅",
        replacementRange: { start: 0, end: 0 },
      }
    );

    expect(acceptPartialGhostText(state).intent).toMatchObject({
      replacementText: "東",
      nextInput: "東",
      acceptedText: "東",
      remainingText: "京駅",
    });
  });

  it("ignores stale generations without overwriting newer state", () => {
    const newer = setGhostTextSuggestion(
      createGhostTextState({ input: "he", cursorOffset: 2 }),
      {
        suggestionText: "hello",
        replacementRange: { start: 0, end: 2 },
        generation: 2,
      }
    );

    expect(setGhostTextSuggestion(newer, {
      suggestionText: "help",
      replacementRange: { start: 0, end: 2 },
      generation: 1,
    })).toBe(newer);
  });

  it("does not partially accept hidden, dismissed, mismatched, or stale ghost text", () => {
    const hidden = createGhostTextState({ input: "he", cursorOffset: 2 });
    expect(acceptPartialGhostText(hidden).intent).toBeUndefined();

    const active = setGhostTextSuggestion(hidden, {
      suggestionText: "hello",
      replacementRange: { start: 0, end: 2 },
      generation: 2,
    });
    expect(acceptPartialGhostText(dismissGhostText(active).state).intent).toBeUndefined();

    const mismatched = setGhostTextSuggestion(
      createGhostTextState({ input: "hello", cursorOffset: 2 }),
      {
        suggestionText: "hello world",
        replacementRange: { start: 0, end: 5 },
      }
    );
    expect(acceptPartialGhostText(mismatched).intent).toBeUndefined();

    const staleBase = createGhostTextState({ input: "he", cursorOffset: 2, generation: 2 });
    const stale = setGhostTextSuggestion(staleBase, {
      suggestionText: "help",
      replacementRange: { start: 0, end: 2 },
      generation: 1,
    });
    expect(stale).toBe(staleBase);
    expect(acceptPartialGhostText(stale).intent).toBeUndefined();
  });

  it("hides ghost text when cursor and replacement range no longer match", () => {
    const state = setGhostTextSuggestion(
      createGhostTextState({ input: "hello", cursorOffset: 2 }),
      {
        suggestionText: "hello world",
        replacementRange: { start: 0, end: 5 },
      }
    );

    expect(state.visible).toBe(false);
    expect(acceptGhostText(state).intent).toBeUndefined();
  });

  it("requires explicit new suggestions after input changes", () => {
    let state = setGhostTextSuggestion(
      createGhostTextState({ input: "hel", cursorOffset: 3 }),
      {
        suggestionText: "hello",
        replacementRange: { start: 0, end: 3 },
      }
    );

    state = updateGhostTextInput(state, "hell", 4);
    expect(state.suggestionText).toBeUndefined();
    expect(state.visible).toBe(false);
    expect(state.dismissed).toBe(false);

    state = setGhostTextSuggestion(state, {
      suggestionText: "hello",
      replacementRange: { start: 0, end: 4 },
    });
    expect(state.visible).toBe(true);
  });

  it("keeps disabled or unavailable state as display data only", () => {
    const state = setGhostTextSuggestion(
      createGhostTextState({ input: "hel", cursorOffset: 3 }),
      {
        suggestionText: "hello",
        replacementRange: { start: 0, end: 3 },
        availability: { state: "unavailable", reason: "provider warming" },
      }
    );

    expect(state.availability).toEqual({ state: "unavailable", reason: "provider warming" });
    expect(state.visible).toBe(false);
    expect(acceptGhostText(state).intent).toBeUndefined();
  });

  it("accepts Arabic, emoji clusters, and combining marks without splitting graphemes", () => {
    const arabic = setGhostTextSuggestion(
      createGhostTextState({ input: "مرح", cursorOffset: "مرح".length }),
      {
        suggestionText: "مرحبا",
        replacementRange: { start: 0, end: "مرح".length },
      }
    );
    expect(acceptGhostText(arabic).intent).toMatchObject({
      type: "replace",
      nextInput: "مرحبا",
    });

    const family = "👨‍👩‍👧‍👦";
    const emoji = setGhostTextSuggestion(
      createGhostTextState({ input: `say ${family}`, cursorOffset: `say ${family}`.length }),
      {
        suggestionText: `${family}!`,
        replacementRange: { start: 4, end: `say ${family}`.length },
      }
    );
    expect(acceptGhostText(emoji).intent).toMatchObject({
      type: "replace",
      nextInput: `say ${family}!`,
    });

    const combining = "e\u0301";
    const accented = setGhostTextSuggestion(
      createGhostTextState({ input: `caf${combining}`, cursorOffset: `caf${combining}`.length }),
      {
        suggestionText: `caf${combining}s`,
        replacementRange: { start: 0, end: `caf${combining}`.length },
      }
    );
    expect(acceptGhostText(accented).intent).toMatchObject({
      type: "replace",
      nextInput: `caf${combining}s`,
    });
  });

  it("normalizes cursor offsets that start inside grapheme clusters", () => {
    const input = "a👨‍👩‍👧‍👦b";
    const state = createGhostTextState({ input, cursorOffset: 3 });

    expect(state.cursorOffset).toBe(1);
  });

  it("rejects replacement ranges that split grapheme clusters", () => {
    const input = "a👨‍👩‍👧‍👦b";

    expect(() => setGhostTextSuggestion(
      createGhostTextState({ input, cursorOffset: input.length - 1 }),
      {
        suggestionText: "family",
        replacementRange: { start: 2, end: input.length - 1 },
      }
    )).toThrow(InvalidGhostTextRangeError);
  });

  it("keeps implementation free of CLI, terminal, process, and provider coupling", () => {
    const source = readFileSync(fileURLToPath(new URL("./ghostTextController.ts", import.meta.url)), "utf8");

    expect(source).not.toMatch(/\bprocess\b|\bstdout\b|\bstderr\b|\bsetRawMode\b/u);
    expect(source).not.toMatch(/\bsrc\/(cli|security|runtime|providers|session)\//u);
    expect(source).not.toMatch(/\bchild_process\b|\bfs\b|readline\b|\bclipboard\b|\bhistory\b|\brawPrompt\b/u);
  });
});
