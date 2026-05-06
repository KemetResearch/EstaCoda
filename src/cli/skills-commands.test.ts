import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { skillsCommand } from "./skills-commands.js";
import { installSkillsPack } from "../skills-packs/skills-pack-installer.js";
import type { SkillsPackManifest } from "../contracts/skills-pack.js";

function makeManifest(overrides?: Partial<SkillsPackManifest>): SkillsPackManifest {
  return {
    id: "cli-sp",
    name: "CLI Test Pack",
    version: "1.0.0",
    description: "A test pack",
    skillsPackType: "skill_pack",
    entrypoints: { skills: ["SKILL.md"] },
    permissions: {
      filesystem: { read: ["."] },
      shell: { allowedCommands: [], requiresApproval: true },
      network: { allowedHosts: [], requiresApproval: true },
      secrets: { requiredEnvironmentVariables: [], requiredCredentialFiles: [] },
      memory: { canRead: false, canWrite: false, requiresPromotionApproval: true },
      channels: { canSendMessages: false, canReceiveMessages: false, requiresApproval: true }
    },
    provenance: { origin: "local", trustLevel: "local_user" },
    sandbox: {
      defaultMode: "deny",
      filesystemMode: "read_only",
      shellMode: "deny",
      networkMode: "deny",
      secretsMode: "deny"
    },
    ...overrides
  };
}

function writePack(dir: string, manifest: SkillsPackManifest): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "skills-pack.json"), JSON.stringify(manifest, null, 2), "utf8");
}

describe("skillsCommand", () => {
  let tmpDir: string;
  let sourceDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-skills-cmd-test-"));
    sourceDir = join(tmpDir, "source-pack");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists installed skills packs", async () => {
    const manifest = makeManifest();
    writePack(sourceDir, manifest);
    await installSkillsPack({ homeDir: tmpDir, sourcePath: sourceDir, actor: "test" });

    const result = await skillsCommand(
      { argv: ["skills", "list"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["list"]
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("cli-sp");
    expect(result.output).toContain("CLI Test Pack");
  });

  it("inspects a skills pack", async () => {
    const manifest = makeManifest({
      evals: [{ name: "test-eval", command: "echo test" }]
    });
    writePack(sourceDir, manifest);
    await installSkillsPack({ homeDir: tmpDir, sourcePath: sourceDir, actor: "test" });

    const result = await skillsCommand(
      { argv: ["skills", "inspect"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["inspect", "cli-sp"]
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("\"id\": \"cli-sp\"");
    expect(result.output).toContain("\"status\": \"enabled\"");
    expect(result.output).toContain("Eval hooks are not executed in EstaCoda v0.1.0");
  });

  it("returns error for missing inspect id", async () => {
    const result = await skillsCommand(
      { argv: ["skills", "inspect"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["inspect"]
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Usage: estacoda skills inspect <id>");
  });

  it("returns error for missing skills pack on inspect", async () => {
    const result = await skillsCommand(
      { argv: ["skills", "inspect"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["inspect", "missing"]
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Skills pack not found: missing");
  });

  it("installs from path", async () => {
    const manifest = makeManifest();
    writePack(sourceDir, manifest);

    const result = await skillsCommand(
      { argv: ["skills", "install"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["install", sourceDir]
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Installed skills pack");
  });

  it("returns error for missing install path", async () => {
    const result = await skillsCommand(
      { argv: ["skills", "install"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["install"]
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Usage: estacoda skills install <path>");
  });

  it("enables a disabled skills pack", async () => {
    const manifest = makeManifest();
    writePack(sourceDir, manifest);
    await installSkillsPack({ homeDir: tmpDir, sourcePath: sourceDir, actor: "test" });

    // Disable first so we can test enable
    await skillsCommand(
      { argv: ["skills", "disable"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["disable", "cli-sp"]
    );

    const result = await skillsCommand(
      { argv: ["skills", "enable"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["enable", "cli-sp"]
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Enabled skills pack");
    expect(existsSync(join(tmpDir, ".estacoda", "skills", "cli-sp"))).toBe(true);
  });

  it("disables an enabled skills pack", async () => {
    const manifest = makeManifest();
    writePack(sourceDir, manifest);
    await installSkillsPack({ homeDir: tmpDir, sourcePath: sourceDir, actor: "test" });

    const result = await skillsCommand(
      { argv: ["skills", "disable"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["disable", "cli-sp"]
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Disabled skills pack");
    expect(existsSync(join(tmpDir, ".estacoda", "skills", "cli-sp"))).toBe(false);
  });

  it("uninstalls a skills pack", async () => {
    const manifest = makeManifest();
    writePack(sourceDir, manifest);
    await installSkillsPack({ homeDir: tmpDir, sourcePath: sourceDir, actor: "test" });

    const result = await skillsCommand(
      { argv: ["skills", "uninstall"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["uninstall", "cli-sp"]
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Uninstalled skills pack");
    expect(existsSync(join(tmpDir, ".estacoda", "skills-packs", "cli-sp"))).toBe(false);
  });

  it("uninstall with --keep-files preserves files", async () => {
    const manifest = makeManifest();
    writePack(sourceDir, manifest);
    await installSkillsPack({ homeDir: tmpDir, sourcePath: sourceDir, actor: "test" });

    const result = await skillsCommand(
      { argv: ["skills", "uninstall"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      ["uninstall", "cli-sp", "--keep-files"]
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Pack files preserved");
    expect(existsSync(join(tmpDir, ".estacoda", "skills-packs", "cli-sp"))).toBe(true);
  });

  it("shows usage for unknown subcommand", async () => {
    const result = await skillsCommand(
      { argv: ["skills"], workspaceRoot: process.cwd(), homeDir: tmpDir },
      []
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Usage: estacoda skills <subcommand>");
  });
});
