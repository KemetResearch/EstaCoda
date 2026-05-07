import { describe, it, expect } from "vitest";
import { SkillRegistry } from "./skill-registry.js";
import type { LoadedSkill } from "../contracts/skill.js";

function makeSkill(overrides: Partial<LoadedSkill> & { name: string; sourceKind: LoadedSkill["sourceKind"] }): LoadedSkill {
  return {
    ...overrides,
    description: overrides.description ?? "A test skill",
    version: overrides.version ?? "1.0.0",
    category: overrides.category ?? "test",
    requiredToolsets: overrides.requiredToolsets ?? ["core"],
    sourcePath: overrides.sourcePath ?? `/test/${overrides.name}/SKILL.md`,
    sourceRoot: overrides.sourceRoot ?? "/test",
    instructions: overrides.instructions ?? "# Test",
    whenToUse: overrides.whenToUse ?? ["test"],
    routing: overrides.routing ?? {
      labels: [],
      triggerPatterns: [],
      negativePatterns: [],
      requiredToolsets: ["core"]
    }
  } as LoadedSkill;
}

describe("SkillRegistry conflict resolution", () => {
  it("local skill overrides bundled skill", () => {
    const registry = new SkillRegistry();
    const bundled = makeSkill({ name: "git-helper", sourceKind: "bundled" });
    const local = makeSkill({ name: "git-helper", sourceKind: "local" });

    registry.register(bundled);
    registry.register(local);

    const result = registry.get("git-helper");
    expect(result).toBeDefined();
    expect((result as LoadedSkill).sourceKind).toBe("local");
    expect(registry.listConflicts()).toHaveLength(1);
    expect(registry.listConflicts()[0].reason).toBe("local-shadows-bundled");
  });

  it("local skill overrides external (pack) skill", () => {
    const registry = new SkillRegistry();
    const external = makeSkill({ name: "docker-helper", sourceKind: "external" });
    const local = makeSkill({ name: "docker-helper", sourceKind: "local" });

    registry.register(external);
    registry.register(local);

    const result = registry.get("docker-helper");
    expect(result).toBeDefined();
    expect((result as LoadedSkill).sourceKind).toBe("local");
    expect(registry.listConflicts()).toHaveLength(1);
    expect(registry.listConflicts()[0].reason).toBe("local-shadows-external");
  });

  it("bundled skill overrides external skill", () => {
    const registry = new SkillRegistry();
    const external = makeSkill({ name: "k8s-helper", sourceKind: "external" });
    const bundled = makeSkill({ name: "k8s-helper", sourceKind: "bundled" });

    registry.register(external);
    registry.register(bundled);

    const result = registry.get("k8s-helper");
    expect(result).toBeDefined();
    expect((result as LoadedSkill).sourceKind).toBe("bundled");
  });

  it("pack skill does not override bundled skill when loaded first", () => {
    const registry = new SkillRegistry();
    const bundled = makeSkill({ name: "aws-helper", sourceKind: "bundled" });
    const external = makeSkill({ name: "aws-helper", sourceKind: "external" });

    registry.register(bundled);
    registry.register(external);

    const result = registry.get("aws-helper");
    expect(result).toBeDefined();
    expect((result as LoadedSkill).sourceKind).toBe("bundled");
  });

  it("duplicate same-source skills keep the first registered", () => {
    const registry = new SkillRegistry();
    const first = makeSkill({ name: "same-source", sourceKind: "bundled", sourcePath: "/test/a/SKILL.md" });
    const second = makeSkill({ name: "same-source", sourceKind: "bundled", sourcePath: "/test/b/SKILL.md" });

    registry.register(first);
    registry.register(second);

    const result = registry.get("same-source");
    expect(result).toBeDefined();
    expect((result as LoadedSkill).sourcePath).toBe("/test/a/SKILL.md");
    expect(registry.listConflicts()[0].reason).toBe("duplicate-source");
  });

  it("three-source priority order is correct", () => {
    const registry = new SkillRegistry();
    const external = makeSkill({ name: "priority-test", sourceKind: "external" });
    const bundled = makeSkill({ name: "priority-test", sourceKind: "bundled" });
    const local = makeSkill({ name: "priority-test", sourceKind: "local" });

    // Load in reverse priority order
    registry.register(external);
    registry.register(bundled);
    registry.register(local);

    const result = registry.get("priority-test");
    expect(result).toBeDefined();
    expect((result as LoadedSkill).sourceKind).toBe("local");
    expect(registry.listConflicts()).toHaveLength(2);
  });
});
