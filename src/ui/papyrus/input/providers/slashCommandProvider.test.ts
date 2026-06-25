import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commandRegistry } from "../../../../cli/command-registry.js";
import { buildSlashCompletionViewModel, isImplementedSlashCommand } from "../../../../cli/slash-menu.js";
import {
  applySuggestionReplacement,
  createSuggestionTokenContext,
} from "../suggestionTypes.js";
import {
  createSlashCommandSuggestionProvider,
  createSlashSuggestionTokenContext,
  SLASH_COMMAND_SUGGESTION_PROVIDER_ID,
} from "./slashCommandProvider.js";

const runtime = {};

describe("Papyrus slash command suggestion provider", () => {
  it("returns slash command suggestions for an empty slash query", async () => {
    const provider = createSlashCommandSuggestionProvider({
      registry: commandRegistry,
      limit: 4,
    });
    const context = createSlashSuggestionTokenContext("/", 1);

    expect(context).toBeDefined();
    const result = await provider.getSuggestions(context!);

    expect(result.type).toBe("success");
    expect(result.providerId).toBe(SLASH_COMMAND_SUGGESTION_PROVIDER_ID);
    expect(result.suggestions.map((suggestion) => suggestion.label)).toEqual([
      "/help",
      "/status",
      "/model",
      "/tools",
    ]);
  });

  it("returns partial query matches using the existing registry/menu source", async () => {
    const provider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const context = createSlashSuggestionTokenContext("/mod", 4);
    const result = await provider.getSuggestions(context!);
    const model = result.suggestions.find((suggestion) => suggestion.label === "/model");

    expect(result.type).toBe("success");
    expect(result.suggestions.map((suggestion) => suggestion.label)).toContain("/model");
    expect(model).toMatchObject({
      kind: "slash",
      providerId: SLASH_COMMAND_SUGGESTION_PROVIDER_ID,
      replacementText: "/model",
    });
  });

  it("replaces only the slash token in mid-input text", async () => {
    const provider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const context = createSlashSuggestionTokenContext("run /mod now", 8);
    const result = await provider.getSuggestions(context!);
    const suggestion = result.suggestions.find((candidate) => candidate.label === "/model");

    expect(context?.tokenRange).toEqual({ start: 4, end: 8 });
    expect(suggestion?.replacementRange).toEqual({ start: 4, end: 8 });
    expect(applySuggestionReplacement(context!.input, suggestion!.replacementRange, suggestion!.replacementText)).toBe(
      "run /model now"
    );
  });

  it("detects slash tokens when the cursor is inside the token", async () => {
    const provider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const context = createSlashSuggestionTokenContext("run /model now", 6);
    const result = await provider.getSuggestions(context!);

    expect(context?.token).toBe("/model");
    expect(context?.tokenRange).toEqual({ start: 4, end: 10 });
    expect(result.suggestions.map((suggestion) => suggestion.label)).toContain("/model");
  });

  it("does not produce false positives for non-slash text", async () => {
    const provider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const plainContext = createSlashSuggestionTokenContext("hello status", 7);
    const embeddedContext = createSlashSuggestionTokenContext("docs/path", 7);
    const nonSlashContext = createSuggestionTokenContext({
      input: "status",
      cursorOffset: 6,
      tokenRange: { start: 0, end: 6 },
      triggerKind: "word",
    });

    expect(plainContext).toBeUndefined();
    expect(embeddedContext).toBeUndefined();
    expect(await provider.getSuggestions(nonSlashContext)).toMatchObject({
      type: "empty",
      suggestions: [],
    });
  });

  it("preserves alias and description parity from current command metadata", async () => {
    const provider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const context = createSlashSuggestionTokenContext("/continue", 9);
    const result = await provider.getSuggestions(context!);
    const resume = result.suggestions.find((candidate) => candidate.label === "/resume");

    expect(resume?.description).toBe("Show the latest interrupted-turn resume note");
    expect(resume?.metadata).toMatchObject({
      commandName: "resume",
      aliases: ["continue"],
      category: "Info",
    });
  });

  it("matches current slash completion menu ordering and implemented-command filtering", async () => {
    const provider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const context = createSlashSuggestionTokenContext("/", 1);
    const result = await provider.getSuggestions(context!);
    const menuLabels = buildSlashCompletionViewModel(runtime as never, "/", { limit: 100 })
      .options
      .map((option) => option.label);

    expect(result.suggestions.map((suggestion) => suggestion.label)).toEqual(menuLabels);
    expect(result.suggestions.every((suggestion) =>
      isImplementedSlashCommand(suggestion.metadata?.commandName ?? "")
    )).toBe(true);
  });

  it("keeps exact slash command queries aligned with the existing menu helper", async () => {
    const provider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const context = createSlashSuggestionTokenContext("/status", 7);
    const result = await provider.getSuggestions(context!);
    const menuLabels = buildSlashCompletionViewModel(runtime as never, "/status", { limit: 100 })
      .options
      .map((option) => option.label);

    expect(result.suggestions.map((suggestion) => suggestion.label)).toEqual(menuLabels);
    expect(result.suggestions[0]?.label).toBe("/status");
  });

  it("matches active-turn filtering parity with the current completion menu", async () => {
    const idleProvider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const activeProvider = createSlashCommandSuggestionProvider({
      registry: commandRegistry,
      includeActiveTurnCommands: true,
    });
    const context = createSlashSuggestionTokenContext("/", 1);
    const idleResult = await idleProvider.getSuggestions(context!);
    const activeResult = await activeProvider.getSuggestions(context!);
    const activeMenuLabels = buildSlashCompletionViewModel(runtime as never, "/", {
      includeActiveTurnCommands: true,
      limit: 100,
    }).options.map((option) => option.label);

    expect(idleResult.suggestions.map((suggestion) => suggestion.label)).not.toContain("/interrupt");
    expect(idleResult.suggestions.map((suggestion) => suggestion.label)).not.toContain("/steer");
    expect(activeResult.suggestions.map((suggestion) => suggestion.label)).toEqual(activeMenuLabels);
    expect(activeResult.suggestions.map((suggestion) => suggestion.label)).toContain("/interrupt");
    expect(activeResult.suggestions.map((suggestion) => suggestion.label)).toContain("/steer");
  });

  it("keeps ranking stable for prefix and alias matches without executing commands", async () => {
    const provider = createSlashCommandSuggestionProvider({ registry: commandRegistry });
    const context = createSlashSuggestionTokenContext("/s", 2);
    const result = await provider.getSuggestions(context!);
    const menuLabels = buildSlashCompletionViewModel(runtime as never, "/s", { limit: 100 })
      .options
      .map((option) => option.label);

    expect(result.suggestions.map((suggestion) => suggestion.label)).toEqual(menuLabels);
    expect(result.suggestions.map((suggestion) => suggestion.metadata?.commandName)).toContain("resume");
  });

  it("does not create a parallel registry or import command execution paths", () => {
    const source = readFileSync(fileURLToPath(new URL("./slashCommandProvider.ts", import.meta.url)), "utf8");
    const sharedSource = readFileSync(fileURLToPath(new URL("../../../slashCompletionSource.ts", import.meta.url)), "utf8");

    expect(source).not.toMatch(/commandRegistry\.register|new Set\(\[\s*["']help["']|execute|runSessionLoop/i);
    expect(source).not.toMatch(/src\/cli|src\/security|src\/runtime|src\/providers|grantApproval|approval/i);
    expect(sharedSource).not.toMatch(/fuse|match-sorter|commandRegistry\.register|execute|runSessionLoop/i);
  });
});
