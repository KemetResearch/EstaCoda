import { describe, expect, it } from "vitest";
import type { Runtime } from "../runtime/create-runtime.js";
import { buildSlashCompletionViewModel } from "./slash-menu.js";

const runtime = {} as Runtime;

describe("buildSlashCompletionViewModel", () => {
  it("hides active-turn-only commands from idle slash completions", () => {
    const labels = buildSlashCompletionViewModel(runtime, "/", { limit: 100 }).options.map((option) => option.label);

    expect(labels).not.toContain("/interrupt");
    expect(labels).not.toContain("/steer");
  });

  it("includes active-turn-only commands for active-turn completions", () => {
    const labels = buildSlashCompletionViewModel(runtime, "/", {
      includeActiveTurnCommands: true,
      limit: 100,
    }).options.map((option) => option.label);

    expect(labels).toContain("/interrupt");
    expect(labels).toContain("/steer");
  });

  it("prioritizes active-turn-only commands inside the fixed active-turn panel", () => {
    const labels = buildSlashCompletionViewModel(runtime, "/", {
      includeActiveTurnCommands: true,
      limit: 6,
    }).options.map((option) => option.label);

    expect(labels).toContain("/interrupt");
    expect(labels).toContain("/steer");
  });

  it("uses free-form note usage for active-turn steer completion", () => {
    const option = buildSlashCompletionViewModel(runtime, "/steer", {
      includeActiveTurnCommands: true,
    }).options.find((candidate) => candidate.label === "/steer");

    expect(option?.description).toBe("/steer <note>");
  });
});
