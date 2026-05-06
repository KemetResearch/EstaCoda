import { readFile, mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { SkillsPackManifest, SkillsPackStatus } from "../contracts/skills-pack.js";
import { SkillsPackRegistry } from "./skills-pack-registry.js";
import { validateSkillsPackManifest } from "./skills-pack-validator.js";
import { classifySkillsPackRisk } from "./skills-pack-risk-classifier.js";
import { renderSkillsPackReview } from "./skills-pack-install-renderer.js";
import { writeSkillsPackForceAuditRecord } from "./skills-pack-force-audit-log.js";
import type { Prompt } from "../onboarding/interactive-onboarding.js";

export type InstallSkillsPackOptions = {
  homeDir: string;
  sourcePath: string;
  actor: string;
  force?: boolean;
  prompt?: Prompt;
};

export type EnableSkillsPackOptions = {
  homeDir: string;
  id: string;
  actor: string;
  force?: boolean;
  prompt?: Prompt;
};

export type DisableSkillsPackOptions = {
  homeDir: string;
  id: string;
};

export type UninstallSkillsPackOptions = {
  homeDir: string;
  id: string;
  actor: string;
  keepFiles?: boolean;
};

function hashManifest(manifest: SkillsPackManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 16);
}

async function loadManifestFromPath(
  sourcePath: string
): Promise<{ ok: true; manifest: SkillsPackManifest } | { ok: false; errors: string[] }> {
  const manifestPath = join(sourcePath, "skills-pack.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, errors: [`skills-pack.json not found in ${sourcePath}`] };
  }
  try {
    const text = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(text);
    return validateSkillsPackManifest(parsed);
  } catch (e) {
    return { ok: false, errors: [`Failed to read skills-pack.json: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

async function copyPack(sourcePath: string, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  await cp(sourcePath, destPath, { recursive: true, force: true });
}

async function createBackup(sourcePath: string, backupsDir: string, id: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `${id}-${timestamp}`;
  const backupPath = join(backupsDir, backupName);
  await mkdir(backupsDir, { recursive: true });
  await cp(sourcePath, backupPath, { recursive: true, force: true });
  return backupPath;
}

async function runForceOverrideFlow(
  manifest: SkillsPackManifest,
  risk: { level: string; reasons: string[] },
  actor: string,
  prompt: Prompt | undefined,
  homeDir: string
): Promise<{ ok: boolean; output: string }> {
  const lines: string[] = [];
  lines.push("DANGER: --force override. This skills pack is BLOCKED. Intended for expert/local development use only.");
  lines.push("");
  lines.push(renderSkillsPackReview(manifest, risk as { level: "low" | "medium" | "high" | "blocked"; reasons: string[] }));
  lines.push("");

  if (prompt === undefined) {
    return { ok: false, output: "Blocked skills pack requires interactive confirmation. Run without --force or provide an interactive terminal." };
  }

  const confirmation = await prompt(`Type the skills pack id to confirm override: ${manifest.id}`);
  if (confirmation.trim() !== manifest.id) {
    return { ok: false, output: "Override aborted: id mismatch." };
  }

  await writeSkillsPackForceAuditRecord(
    { homeDir },
    {
      timestamp: new Date().toISOString(),
      skillsPackId: manifest.id,
      version: manifest.version,
      manifestHash: hashManifest(manifest),
      riskReasons: risk.reasons,
      overrideActor: actor
    }
  );

  return { ok: true, output: lines.join("\n") };
}

export async function installSkillsPack(
  options: InstallSkillsPackOptions
): Promise<{ ok: boolean; exitCode: number; output: string }> {
  const { homeDir, sourcePath, actor, force, prompt } = options;

  if (!existsSync(sourcePath)) {
    return { ok: false, exitCode: 1, output: `Source path does not exist: ${sourcePath}` };
  }

  const manifestResult = await loadManifestFromPath(sourcePath);
  if (!manifestResult.ok) {
    return {
      ok: false,
      exitCode: 1,
      output: `Validation failed:\n${manifestResult.errors.map((e) => `  - ${e}`).join("\n")}`
    };
  }
  const manifest = manifestResult.manifest;

  const risk = classifySkillsPackRisk(manifest);

  if (risk.level === "blocked") {
    if (!force) {
      return {
        ok: false,
        exitCode: 3,
        output: `Blocked: ${risk.reasons.join("; ")}\n\n${renderSkillsPackReview(manifest, risk)}`
      };
    }
    const forceResult = await runForceOverrideFlow(manifest, risk, actor, prompt, homeDir);
    if (!forceResult.ok) {
      return { ok: false, exitCode: 2, output: forceResult.output };
    }
  }

  const isExternal = manifest.provenance.origin === "external";

  // Medium/high risk requires confirmation for ALL origins
  const needsConfirmation = risk.level === "medium" || risk.level === "high";
  if (needsConfirmation) {
    if (prompt === undefined) {
      return {
        ok: false,
        exitCode: 2,
        output: "This skills pack requires interactive confirmation. Run without --force or provide an interactive terminal."
      };
    }
    const review = renderSkillsPackReview(manifest, risk);
    const answer = await prompt(`${review}\n\nDo you want to install this skills pack? (yes/no)`);
    if (answer.trim().toLowerCase() !== "yes") {
      return { ok: false, exitCode: 2, output: "Installation aborted by user." };
    }
  }

  const packsDir = join(homeDir, ".estacoda", "skills-packs");
  const destPath = join(packsDir, manifest.id);

  if (existsSync(destPath)) {
    const backupsDir = join(packsDir, "backups");
    await createBackup(destPath, backupsDir, manifest.id);
    await rm(destPath, { recursive: true, force: true });
  }

  await copyPack(sourcePath, destPath);

  // Risk-aware status policy
  let computedStatus: SkillsPackStatus;
  if (isExternal) {
    computedStatus = "disabled";
  } else if (risk.level === "blocked" || risk.level === "medium" || risk.level === "high") {
    computedStatus = "disabled";
  } else {
    computedStatus = "enabled";
  }

  const registry = new SkillsPackRegistry({ homeDir });
  const installResult = await registry.install(manifest, actor, { status: computedStatus });
  if (!installResult.ok) {
    await rm(destPath, { recursive: true, force: true });
    return { ok: false, exitCode: 1, output: `Registry error: ${installResult.errors.join("; ")}` };
  }

  const status = installResult.entry.status;
  const skillsDest = join(homeDir, ".estacoda", "skills", manifest.id);
  if (status === "enabled" && !existsSync(skillsDest)) {
    await copyPack(destPath, skillsDest);
  }

  const lines: string[] = [];
  lines.push(`Installed skills pack: ${manifest.name} (${manifest.id})`);
  lines.push(`Status: ${status}`);
  lines.push(`Risk: ${risk.level}`);
  if (manifest.evals !== undefined && manifest.evals.length > 0) {
    lines.push("Eval hooks are not executed in EstaCoda v0.1.0");
  }
  if (status === "enabled") {
    lines.push(`Skills copied to: ${skillsDest}`);
    lines.push("Note: Start a new session for skills to be available.");
  } else {
    lines.push(`Enable with: estacoda skills enable ${manifest.id}`);
  }

  return { ok: true, exitCode: 0, output: lines.join("\n") };
}

export async function enableSkillsPack(
  options: EnableSkillsPackOptions
): Promise<{ ok: boolean; exitCode: number; output: string }> {
  const { homeDir, id, actor, force, prompt } = options;

  const registry = new SkillsPackRegistry({ homeDir });
  const entry = await registry.find(id);
  if (entry === undefined) {
    return { ok: false, exitCode: 1, output: `Skills pack not found: ${id}` };
  }

  const packPath = join(homeDir, ".estacoda", "skills-packs", id);
  if (!existsSync(packPath)) {
    return { ok: false, exitCode: 1, output: `Skills pack files missing: ${packPath}` };
  }

  const manifestResult = await loadManifestFromPath(packPath);
  if (!manifestResult.ok) {
    return {
      ok: false,
      exitCode: 1,
      output: `Manifest validation failed:\n${manifestResult.errors.map((e) => `  - ${e}`).join("\n")}`
    };
  }
  const manifest = manifestResult.manifest;

  const risk = classifySkillsPackRisk(manifest);
  if (risk.level === "blocked") {
    if (!force) {
      return {
        ok: false,
        exitCode: 3,
        output: `Blocked: ${risk.reasons.join("; ")}\n\n${renderSkillsPackReview(manifest, risk)}`
      };
    }
    const forceResult = await runForceOverrideFlow(manifest, risk, actor, prompt, homeDir);
    if (!forceResult.ok) {
      return { ok: false, exitCode: 2, output: forceResult.output };
    }
  }

  const skillsDest = join(homeDir, ".estacoda", "skills", id);
  if (existsSync(skillsDest)) {
    const backupsDir = join(homeDir, ".estacoda", "skills-packs", "backups");
    await createBackup(skillsDest, backupsDir, id);
    await rm(skillsDest, { recursive: true, force: true });
  }

  await copyPack(packPath, skillsDest);
  await registry.updateStatus(id, "enabled");

  const lines: string[] = [];
  lines.push(`Enabled skills pack: ${manifest.name} (${id})`);
  if (manifest.evals !== undefined && manifest.evals.length > 0) {
    lines.push("Eval hooks are not executed in EstaCoda v0.1.0");
  }
  lines.push("Note: Start a new session for skills to be available.");

  return { ok: true, exitCode: 0, output: lines.join("\n") };
}

export async function disableSkillsPack(
  options: DisableSkillsPackOptions
): Promise<{ ok: boolean; exitCode: number; output: string }> {
  const { homeDir, id } = options;

  const registry = new SkillsPackRegistry({ homeDir });
  const entry = await registry.find(id);
  if (entry === undefined) {
    return { ok: false, exitCode: 1, output: `Skills pack not found: ${id}` };
  }

  const skillsDest = join(homeDir, ".estacoda", "skills", id);
  if (existsSync(skillsDest)) {
    await rm(skillsDest, { recursive: true, force: true });
  }

  await registry.updateStatus(id, "disabled");

  return {
    ok: true,
    exitCode: 0,
    output: `Disabled skills pack: ${entry.manifest.name} (${id})\nNote: Start a new session for changes to take full effect.`
  };
}

export async function uninstallSkillsPack(
  options: UninstallSkillsPackOptions
): Promise<{ ok: boolean; exitCode: number; output: string }> {
  const { homeDir, id, actor, keepFiles } = options;

  const registry = new SkillsPackRegistry({ homeDir });
  const entry = await registry.find(id);
  if (entry === undefined) {
    return { ok: false, exitCode: 1, output: `Skills pack not found: ${id}` };
  }

  const packPath = join(homeDir, ".estacoda", "skills-packs", id);
  const skillsDest = join(homeDir, ".estacoda", "skills", id);

  if (existsSync(packPath)) {
    const backupsDir = join(homeDir, ".estacoda", "skills-packs", "backups");
    await createBackup(packPath, backupsDir, id);
  }

  if (existsSync(skillsDest)) {
    await rm(skillsDest, { recursive: true, force: true });
  }

  await registry.remove(id);

  if (!keepFiles && existsSync(packPath)) {
    await rm(packPath, { recursive: true, force: true });
  }

  const lines: string[] = [];
  lines.push(`Uninstalled skills pack: ${entry.manifest.name} (${id})`);
  if (keepFiles) {
    lines.push(`Pack files preserved at: ${packPath}`);
  }
  lines.push("Note: Start a new session for changes to take full effect.");

  return { ok: true, exitCode: 0, output: lines.join("\n") };
}
