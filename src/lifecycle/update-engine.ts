import { mkdir, writeFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  resolveLatestVersion,
  compareVersions,
  type VersionInfo
} from "./version-resolver.js";
import { backupState, getProtectedPaths } from "./state-preservation.js";

export type UpdateCheckResult =
  | { kind: "up-to-date"; current: string }
  | { kind: "available"; info: VersionInfo }
  | { kind: "error"; message: string };

export type ArtifactTestResult = {
  testable: boolean;
  reason: string;
};

export type UpdateApplyResult =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export async function checkForUpdate(fetchFn?: typeof fetch): Promise<UpdateCheckResult> {
  const resolved = await resolveLatestVersion(fetchFn);

  if (!resolved.ok) {
    return { kind: "error", message: resolved.error };
  }

  const { info } = resolved;

  if (compareVersions(info.current, info.latest) >= 0) {
    return { kind: "up-to-date", current: info.current };
  }

  return { kind: "available", info };
}

export function prepareUpdateInfo(info: VersionInfo): string {
  const lines = [
    "Update check",
    `Current: ${info.current}`,
    `Latest:  ${info.latest}`,
    info.breakingChanges ? "Warning: this release includes breaking changes." : undefined,
    `Release notes: ${info.releaseNotesUrl}`,
    "",
    "Protected state paths:",
    ...getProtectedPaths(process.env.HOME ?? "").map((p) => `  ${p.label}`),
    "",
    "Run with --apply to attempt installation."
  ].filter((line): line is string => line !== undefined);

  return lines.join("\n");
}

export function canApplyUpdate(): ArtifactTestResult {
  const artifactPath = process.env.ESTACODA_UPDATE_ARTIFACT;

  if (artifactPath === undefined || artifactPath.length === 0) {
    return {
      testable: false,
      reason: "ESTACODA_UPDATE_ARTIFACT is not set. Define it to enable --apply."
    };
  }

  if (!existsSync(artifactPath)) {
    return {
      testable: false,
      reason: `Artifact path does not exist: ${artifactPath}`
    };
  }

  return {
    testable: true,
    reason: `Artifact path is valid: ${artifactPath}`
  };
}

export async function applyUpdate(options: {
  artifactPath: string;
  homeDir: string;
  workspaceRoot?: string;
}): Promise<UpdateApplyResult> {
  const tempDir = join(options.homeDir, ".estacoda", ".backups", `update-temp-${Date.now()}`);

  try {
    const backup = await backupState({
      homeDir: options.homeDir,
      workspaceRoot: options.workspaceRoot,
      label: `pre-update-${Date.now()}`
    });

    if (backup.backedUp.length === 0) {
      return {
        kind: "error",
        message: "Update aborted: state backup failed (no paths were backed up)."
      };
    }

    await mkdir(tempDir, { recursive: true });

    const destPath = join(options.homeDir, ".estacoda", "bin", "estacoda-new");
    await mkdir(join(options.homeDir, ".estacoda", "bin"), { recursive: true });

    const { copyFile } = await import("node:fs/promises");
    await copyFile(options.artifactPath, destPath);

    const finalPath = join(options.homeDir, ".estacoda", "bin", "estacoda");
    await rename(destPath, finalPath);

    return {
      kind: "success",
      message: [
        "Update applied.",
        `Backup: ${backup.backupPath}`,
        `Binary: ${finalPath}`,
        "Run `estacoda verify` to confirm the update."
      ].join("\n")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message: `Update failed: ${message}` };
  } finally {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
