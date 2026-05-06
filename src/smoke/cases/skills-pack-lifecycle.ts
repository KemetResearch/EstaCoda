import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SmokeCase } from "../smoke-case.js";
import { skillsCommand } from "../../cli/skills-commands.js";
import type { SkillsPackManifest } from "../../contracts/skills-pack.js";

function makeManifest(overrides?: Partial<SkillsPackManifest>): SkillsPackManifest {
  return {
    id: "smoke-sp",
    name: "Smoke Test Pack",
    version: "1.0.0",
    description: "A smoke test skills pack",
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

export const skills_pack_lifecycle_case: SmokeCase = {
  id: "skills-pack-lifecycle",
  name: "Skills pack install/enable/disable/uninstall lifecycle",
  tags: ["skills", "lifecycle"],
  run: async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "estacoda-smoke-sp-"));
    const sourceDir = join(tempHome, "source-pack");

    try {
      const manifest = makeManifest();
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, "skills-pack.json"), JSON.stringify(manifest, null, 2), "utf8");
      writeFileSync(join(sourceDir, "SKILL.md"), "# Smoke Skill\n", "utf8");

      // Install
      const installResult = await skillsCommand(
        { argv: ["skills", "install"], workspaceRoot: process.cwd(), homeDir: tempHome },
        ["install", sourceDir]
      );
      if (installResult.exitCode !== 0) {
        throw new Error(`install failed: ${installResult.output}`);
      }

      const packPath = join(tempHome, ".estacoda", "skills-packs", "smoke-sp");
      if (!existsSync(packPath)) {
        throw new Error("Pack was not copied to skills-packs/");
      }

      const skillsDest = join(tempHome, ".estacoda", "skills", "smoke-sp");
      if (!existsSync(skillsDest)) {
        throw new Error("Skills were not copied to skills/ on install for local origin");
      }

      // List
      const listResult = await skillsCommand(
        { argv: ["skills", "list"], workspaceRoot: process.cwd(), homeDir: tempHome },
        ["list"]
      );
      if (listResult.exitCode !== 0 || !listResult.output.includes("smoke-sp")) {
        throw new Error(`list failed or missing entry: ${listResult.output}`);
      }

      // Inspect
      const inspectResult = await skillsCommand(
        { argv: ["skills", "inspect"], workspaceRoot: process.cwd(), homeDir: tempHome },
        ["inspect", "smoke-sp"]
      );
      if (inspectResult.exitCode !== 0 || !inspectResult.output.includes("\"id\": \"smoke-sp\"")) {
        throw new Error(`inspect failed: ${inspectResult.output}`);
      }

      // Disable
      const disableResult = await skillsCommand(
        { argv: ["skills", "disable"], workspaceRoot: process.cwd(), homeDir: tempHome },
        ["disable", "smoke-sp"]
      );
      if (disableResult.exitCode !== 0) {
        throw new Error(`disable failed: ${disableResult.output}`);
      }
      if (existsSync(skillsDest)) {
        throw new Error("Skills directory was not removed on disable");
      }

      // Enable
      const enableResult = await skillsCommand(
        { argv: ["skills", "enable"], workspaceRoot: process.cwd(), homeDir: tempHome },
        ["enable", "smoke-sp"]
      );
      if (enableResult.exitCode !== 0) {
        throw new Error(`enable failed: ${enableResult.output}`);
      }
      if (!existsSync(skillsDest)) {
        throw new Error("Skills directory was not restored on enable");
      }

      // Uninstall
      const uninstallResult = await skillsCommand(
        { argv: ["skills", "uninstall"], workspaceRoot: process.cwd(), homeDir: tempHome },
        ["uninstall", "smoke-sp"]
      );
      if (uninstallResult.exitCode !== 0) {
        throw new Error(`uninstall failed: ${uninstallResult.output}`);
      }
      if (existsSync(packPath)) {
        throw new Error("Pack directory was not removed on uninstall");
      }

      // Verify backup was created
      const backupsDir = join(tempHome, ".estacoda", "skills-packs", "backups");
      if (!existsSync(backupsDir)) {
        throw new Error("Backups directory was not created");
      }
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }
};
