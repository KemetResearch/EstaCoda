import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IntentRoute } from "../contracts/intent.js";
import type { LoadedSkill, SkillDefinition } from "../contracts/skill.js";
import type { ToolResult } from "../contracts/tool.js";
import { SKILL_READ_MAX_CHARS } from "../skills/skill-limits.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { RuntimeRouter } from "../runtime/runtime-router.js";
import type { IntentRouter } from "../runtime/intent-router.js";
import { createSkillTools } from "./skill-tools.js";

describe("skill.read", () => {
  it("returns full content for small loaded skills with rich metadata", async () => {
    const harness = await skillToolHarness([loadedSkill({
      name: "small-skill",
      instructions: "# Small\n\nUse the small skill.",
      resources: [
        { kind: "reference", path: "references/guide.md" },
        { kind: "script", path: "scripts/run.sh" }
      ],
      requiredEnvironmentVariables: ["SKILL_READ_TEST_MISSING_ENV"]
    })]);

    const result = await harness.run("skill.read", { name: "small-skill" });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("# small-skill\n\n# Small\n\nUse the small skill.");
    expect(result.metadata).toMatchObject({
      name: "small-skill",
      description: "Test skill small-skill.",
      version: "0.1.0",
      mode: "complete",
      originalChars: "# Small\n\nUse the small skill.".length,
      truncated: false,
      setup_needed: true,
      readiness_status: "missing-setup",
      missing_required_environment_variables: ["SKILL_READ_TEST_MISSING_ENV"],
      missing_required_credential_files: [],
      missing_config_fields: [],
      linked_files: {
        references: [{ kind: "reference", path: "references/guide.md" }],
        scripts: [{ kind: "script", path: "scripts/run.sh" }],
        templates: [],
        assets: []
      }
    });
  });

  it("returns contract content for large loaded skills by default and in contract mode", async () => {
    const large = loadedSkill({
      name: "large-skill",
      instructions: largeInstructions()
    });
    const harness = await skillToolHarness([large]);

    const defaultResult = await harness.run("skill.read", { name: "large-skill" });
    const contractResult = await harness.run("skill.read", { name: "large-skill", mode: "contract" });

    for (const result of [defaultResult, contractResult]) {
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Skill contract: large-skill");
      expect(result.content).toContain("Load full root instructions later with: skill.read");
      expect(result.content).not.toContain("LARGE_ROOT_TAIL_MARKER");
      expect(result.metadata).toMatchObject({
        mode: "contract",
        originalChars: large.instructions.length,
        truncated: true
      });
    }
  });

  it("returns mechanical metadata and resource index for small skills in contract mode", async () => {
    const harness = await skillToolHarness([loadedSkill({
      name: "small-contract",
      instructions: "# Small\n\nUse it.",
      resources: [{ kind: "template", path: "templates/base.md", bytes: 32 }]
    })]);

    const result = await harness.run("skill.read", { name: "small-contract", mode: "contract" });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("This is a mechanical metadata and resource index, not a semantic summary.");
    expect(result.content).toContain("templates/base.md · kind=template · bytes=32");
    expect(result.metadata).toMatchObject({
      mode: "contract",
      truncated: false,
      linked_files: {
        templates: [{ kind: "template", path: "templates/base.md", bytes: 32 }]
      }
    });
  });

  it("caps full mode by SKILL_READ_MAX_CHARS and reports originalChars/truncated", async () => {
    const instructions = `${"A".repeat(Math.floor(SKILL_READ_MAX_CHARS / 2))}FULL_MODE_MIDDLE_MARKER${"B".repeat(Math.floor(SKILL_READ_MAX_CHARS / 2) + 100)}`;
    const harness = await skillToolHarness([loadedSkill({
      name: "full-cap",
      instructions
    })]);

    const result = await harness.run("skill.read", { name: "full-cap", mode: "full" });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("[TRUNCATED:");
    expect(result.content.length).toBeLessThan(instructions.length + "# full-cap\n\n".length);
    expect(result.metadata).toMatchObject({
      mode: "full",
      originalChars: instructions.length,
      truncated: true
    });
  });

  it("reads skill-local resources through path-safe logic", async () => {
    const skill = loadedSkill({ name: "resource-skill" });
    const harness = await skillToolHarness([skill], {
      files: {
        "references/guide.md": "Reference body marker."
      }
    });

    const result = await harness.run("skill.read", {
      name: "resource-skill",
      path: "references/guide.md"
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("# resource-skill / references/guide.md");
    expect(result.content).toContain("Reference body marker.");
    expect(result.metadata).toMatchObject({
      mode: "reference",
      path: "references/guide.md",
      text: true,
      linked_files: {
        references: [{ kind: "reference", path: "references/guide.md" }]
      }
    });
  });

  it("rejects path reads combined with root-only modes using a structured error", async () => {
    const harness = await skillToolHarness([loadedSkill({ name: "bad-combo" })]);

    const result = await harness.run("skill.read", {
      name: "bad-combo",
      path: "references/guide.md",
      mode: "full"
    });

    expect(result.ok).toBe(false);
    expect(result.metadata).toMatchObject({
      code: "skill-read-incompatible-path-mode",
      name: "bad-combo",
      path: "references/guide.md",
      mode: "full"
    });
  });

  it("returns metadata-only mode for unloaded skills without fake loaded fields", async () => {
    const definition: SkillDefinition = {
      name: "definition-only",
      description: "Definition-only skill.",
      version: "0.1.0",
      category: "general",
      whenToUse: [],
      requiredToolsets: [],
      requiredCredentialFiles: ["/missing/credential.json"],
      configFields: [{ key: "apiMode", required: true }],
      playbook: [],
      permissionExpectations: [],
      examples: [],
      evaluations: []
    };
    const harness = await skillToolHarness([definition]);

    const result = await harness.run("skill.read", { name: "definition-only" });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Definition-only skill.");
    expect(result.metadata).toMatchObject({
      name: "definition-only",
      mode: "metadata-only",
      linked_files: {
        references: [],
        scripts: [],
        templates: [],
        assets: []
      },
      setup_needed: true,
      readiness_status: "missing-setup",
      missing_required_credential_files: ["/missing/credential.json"],
      missing_config_fields: ["apiMode"]
    });
    expect(result.metadata?.sourcePath).toBeUndefined();
    expect(result.metadata?.sourceRoot).toBeUndefined();
    expect(result.metadata?.resources).toBeUndefined();
  });

  it("keeps skill.view as a compatibility alias with the same rich metadata shape", async () => {
    const harness = await skillToolHarness([loadedSkill({ name: "alias-skill" })]);

    const read = await harness.run("skill.read", { name: "alias-skill" });
    const view = await harness.run("skill.view", { name: "alias-skill" });

    expect(view.ok).toBe(true);
    expect(view.content).toBe(read.content);
    expect(view.metadata).toEqual(read.metadata);
  });

  it("uses the same setup helper for runtime setup context and skill.read readiness metadata", async () => {
    const skill = loadedSkill({
      name: "setup-skill",
      configFields: [{ key: "apiMode", required: true }]
    });
    const harness = await skillToolHarness([skill], {
      skillConfig: {
        "setup-skill": { api_mode: "configured" }
      }
    });
    const router = routerForSkill(skill, {
      "setup-skill": { api_mode: "configured" }
    });

    const route = router.route({ text: "test", channel: "cli" });
    const result = await harness.run("skill.read", { name: "setup-skill" });

    expect(route.selectedSkillSetup?.configFields).toEqual([
      {
        key: "apiMode",
        description: undefined,
        required: true,
        value: "configured",
        source: "config"
      }
    ]);
    expect(result.metadata).toMatchObject({
      setup_needed: false,
      readiness_status: "available",
      missing_config_fields: []
    });
  });
});

async function skillToolHarness(
  skills: Array<LoadedSkill | SkillDefinition>,
  options: {
    files?: Record<string, string>;
    skillConfig?: Record<string, Record<string, unknown>>;
  } = {}
): Promise<{ run(toolName: "skill.read" | "skill.view", input: Record<string, unknown>): Promise<ToolResult> }> {
  const root = await mkdtemp(join(tmpdir(), "skill-tools-test-"));
  const registry = new SkillRegistry();
  for (const skill of skills) {
    if (isLoadedSkill(skill)) {
      const skillRoot = join(root, skill.name);
      await mkdir(skillRoot, { recursive: true });
      await writeFile(join(skillRoot, "SKILL.md"), "{}", "utf8");
      for (const [path, content] of Object.entries(options.files ?? {})) {
        const absolute = join(skillRoot, path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content, "utf8");
      }
      registry.register({
        ...skill,
        sourcePath: join(skillRoot, "SKILL.md"),
        sourceRoot: root,
        resources: skill.resources ?? Object.keys(options.files ?? {}).map((path) => ({
          kind: "reference" as const,
          path
        }))
      });
    } else {
      registry.register(skill);
    }
  }
  const tools = createSkillTools({
    registry,
    localSkillsRoot: root,
    skillConfig: options.skillConfig
  });
  return {
    async run(toolName, input) {
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (tool === undefined) {
        throw new Error(`${toolName} was not registered`);
      }
      return await tool.run(input);
    }
  };
}

function loadedSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  const name = overrides.name ?? "loaded-skill";
  return {
    name,
    description: `Test skill ${name}.`,
    version: "0.1.0",
    category: "general",
    whenToUse: [],
    requiredToolsets: [],
    playbook: [],
    permissionExpectations: [],
    examples: [],
    evaluations: [],
    sourcePath: join(tmpdir(), name, "SKILL.md"),
    sourceKind: "local",
    sourceRoot: tmpdir(),
    instructions: "# Instructions\n\nUse the skill.",
    ...overrides
  };
}

function largeInstructions(): string {
  return [
    "# Large",
    "Detailed instructions.\n".repeat(420),
    "LARGE_ROOT_TAIL_MARKER"
  ].join("\n");
}

function routerForSkill(
  skill: LoadedSkill | SkillDefinition,
  skillConfig: Record<string, Record<string, unknown>>
): RuntimeRouter {
  const route: IntentRoute = {
    nativeIntent: "general",
    labels: ["general"],
    confidence: 1,
    suggestedToolsets: [],
    suggestedSkills: [skill],
    confirmationRequired: false,
    evidence: [],
    rationale: "test"
  };
  const intentRouter = {
    route: () => route
  } as unknown as IntentRouter;
  return new RuntimeRouter({
    intentRouter,
    skillConfig
  });
}

function isLoadedSkill(skill: LoadedSkill | SkillDefinition): skill is LoadedSkill {
  return "instructions" in skill && "sourcePath" in skill;
}
