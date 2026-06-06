import { describe, expect, it } from "vitest";
import { toolRegistrationPlan, type ToolRegistrationPhase } from "./index.js";

const validKinds = new Set(["static", "runtime", "session"]);
const validPhases = new Set<ToolRegistrationPhase>([
  "pre-skill-visibility",
  "post-skill-visibility",
  "post-memory-provider",
  "post-tool-executor"
]);

describe("toolRegistrationPlan", () => {
  it("uses valid provider kinds and registration phases", () => {
    for (const entry of toolRegistrationPlan) {
      expect(validKinds.has(entry.provider.kind)).toBe(true);
      expect(validPhases.has(entry.phase)).toBe(true);
    }
  });

  it("has no duplicate provider names", () => {
    const names = toolRegistrationPlan.map((entry) => entry.provider.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the builtin provider first", () => {
    expect(toolRegistrationPlan[0]?.provider.name).toBe("builtin");
    expect(toolRegistrationPlan[0]?.provider.kind).toBe("static");
  });

  it("keeps the config provider session-bound and pre-skill", () => {
    const configEntry = toolRegistrationPlan.find((entry) => entry.provider.name === "config");

    expect(configEntry?.provider.kind).toBe("session");
    expect(configEntry?.phase).toBe("pre-skill-visibility");
  });

  it("does not register local memory read/search tools yet", () => {
    const memoryEntry = toolRegistrationPlan.find((entry) => entry.provider.name === "memory");
    const sessionSearchEntry = toolRegistrationPlan.find((entry) => entry.provider.name === "sessionSearch");

    expect(memoryEntry?.provider.kind).toBe("session");
    expect(sessionSearchEntry?.provider.kind).toBe("session");
    expect(sessionSearchEntry?.phase).toBe("pre-skill-visibility");
    expect(toolRegistrationPlan.map((entry) => entry.provider.name)).not.toContain("memoryRetrieval");
  });

  it("static providers expose non-empty tool arrays", () => {
    const staticProviders = toolRegistrationPlan
      .map((entry) => entry.provider)
      .filter((provider) => provider.kind === "static");

    expect(staticProviders.length).toBeGreaterThan(0);
    for (const provider of staticProviders) {
      expect(provider.tools.length).toBeGreaterThan(0);
    }
  });
});
