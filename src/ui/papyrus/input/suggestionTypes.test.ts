import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applySuggestionReplacement,
  assertValidReplacementRange,
  createSuggestionTokenContext,
  InvalidSuggestionRangeError,
  isValidReplacementRange,
  normalizeSuggestionProviderResult,
  type SuggestionItem,
  type SuggestionProvider,
} from "./suggestionTypes.js";

const sampleItem: SuggestionItem = {
  id: "slash.help",
  label: "/help",
  description: "Show help",
  replacementText: "/help",
  replacementRange: { start: 0, end: 2 },
  providerId: "slash",
  kind: "slash",
};

describe("Papyrus suggestion contracts", () => {
  it("validates replacement ranges within input bounds", () => {
    expect(isValidReplacementRange("/h now", { start: 0, end: 2 })).toBe(true);
    expect(assertValidReplacementRange("/h now", { start: 0, end: 2 })).toEqual({
      start: 0,
      end: 2,
    });
  });

  it("rejects invalid replacement ranges deterministically", () => {
    expect(() => assertValidReplacementRange("abc", { start: -1, end: 1 })).toThrow(InvalidSuggestionRangeError);
    expect(() => assertValidReplacementRange("abc", { start: 2, end: 1 })).toThrow(InvalidSuggestionRangeError);
    expect(() => assertValidReplacementRange("abc", { start: 0, end: 4 })).toThrow(InvalidSuggestionRangeError);
    expect(() => assertValidReplacementRange("abc", { start: 0.5, end: 1 })).toThrow(InvalidSuggestionRangeError);
  });

  it("applies replacements while preserving text around the range", () => {
    expect(applySuggestionReplacement("run /he now", { start: 4, end: 7 }, "/help")).toBe("run /help now");
    expect(applySuggestionReplacement("prefix suffix", { start: 7, end: 7 }, "middle ")).toBe(
      "prefix middle suffix"
    );
  });

  it("creates and validates token context without mutating input", () => {
    const input = "ask /he please";
    const context = createSuggestionTokenContext({
      input,
      cursorOffset: 7,
      tokenRange: { start: 4, end: 7 },
      triggerKind: "slash",
    });

    expect(context).toEqual({
      input,
      cursorOffset: 7,
      token: "/he",
      tokenRange: { start: 4, end: 7 },
      triggerKind: "slash",
    });
    expect(input).toBe("ask /he please");
  });

  it("accepts cursor positions at token range boundaries", () => {
    expect(createSuggestionTokenContext({
      input: "/help now",
      cursorOffset: 0,
      tokenRange: { start: 0, end: 5 },
      triggerKind: "slash",
    }).token).toBe("/help");

    expect(createSuggestionTokenContext({
      input: "/help now",
      cursorOffset: 5,
      tokenRange: { start: 0, end: 5 },
      triggerKind: "slash",
    }).token).toBe("/help");
  });

  it("rejects token context when cursor or token range is out of bounds", () => {
    expect(() => createSuggestionTokenContext({ input: "abc", cursorOffset: 4 })).toThrow(
      InvalidSuggestionRangeError
    );
    expect(() =>
      createSuggestionTokenContext({
        input: "abc",
        cursorOffset: 0,
        tokenRange: { start: 1, end: 2 },
      })
    ).toThrow(InvalidSuggestionRangeError);
    expect(() =>
      createSuggestionTokenContext({
        input: "abc def",
        cursorOffset: 4,
        tokenRange: { start: 0, end: 3 },
      })
    ).toThrow(InvalidSuggestionRangeError);
  });

  it("normalizes successful and empty provider results", () => {
    expect(normalizeSuggestionProviderResult("slash", {
      suggestions: [sampleItem],
      requestId: "req-1",
      generation: 2,
    })).toEqual({
      type: "success",
      providerId: "slash",
      requestId: "req-1",
      generation: 2,
      stale: undefined,
      suggestions: [sampleItem],
    });

    expect(normalizeSuggestionProviderResult("slash")).toEqual({
      type: "empty",
      providerId: "slash",
      requestId: undefined,
      generation: undefined,
      stale: undefined,
      suggestions: [],
    });
  });

  it("normalizes provider errors and cancellation as data", () => {
    expect(normalizeSuggestionProviderResult("files", {
      error: { message: "permission denied", code: "EACCES", recoverable: true },
      stale: true,
    })).toEqual({
      type: "error",
      providerId: "files",
      requestId: undefined,
      generation: undefined,
      stale: true,
      suggestions: [],
      error: { message: "permission denied", code: "EACCES", recoverable: true },
    });

    expect(normalizeSuggestionProviderResult("files", {
      canceled: true,
      requestId: "req-2",
    })).toEqual({
      type: "canceled",
      providerId: "files",
      requestId: "req-2",
      generation: undefined,
      stale: undefined,
      suggestions: [],
      canceled: true,
    });
  });

  it("keeps disabled or unavailable item state as display metadata only", () => {
    const item: SuggestionItem = {
      ...sampleItem,
      id: "slash.restart",
      label: "/restart",
      availability: {
        state: "unavailable",
        reason: "Not available during an active turn",
      },
    };

    expect(item.availability).toEqual({
      state: "unavailable",
      reason: "Not available during an active turn",
    });
    expect(item).not.toHaveProperty("policy");
    expect(item).not.toHaveProperty("approval");
  });

  it("supports narrow provider contracts with sync or async result data", async () => {
    const syncProvider: SuggestionProvider = {
      id: "slash",
      name: "Slash commands",
      capabilityTags: ["commands"],
      getSuggestions: () => normalizeSuggestionProviderResult("slash", { suggestions: [sampleItem] }),
    };
    const asyncProvider: SuggestionProvider = {
      id: "history",
      name: "History",
      getSuggestions: async () => normalizeSuggestionProviderResult("history", { canceled: true }),
    };
    const context = createSuggestionTokenContext({
      input: "/h",
      cursorOffset: 2,
      tokenRange: { start: 0, end: 2 },
      triggerKind: "slash",
    });

    expect(syncProvider.getSuggestions(context)).toMatchObject({
      type: "success",
      providerId: "slash",
    });
    await expect(asyncProvider.getSuggestions(context)).resolves.toMatchObject({
      type: "canceled",
      providerId: "history",
    });
  });

  it("does not import command registry, policy, approval, or session code", () => {
    const source = readFileSync(fileURLToPath(new URL("./suggestionTypes.ts", import.meta.url)), "utf8");

    expect(source).not.toMatch(/\bslash-menu\b|src\/cli|src\/security|src\/session|grantApproval|approval/i);
  });
});
