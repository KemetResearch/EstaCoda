import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename } from "node:path";
import { resolveProfileStateHome } from "../../config/profile-home.js";

export type MemoryHealthStatus = "ready" | "warning" | "blocked";
export type MemoryHealthProvider = "file";

export type MemoryFileStatus = {
  readonly path: string;
  readonly label: string;
  readonly status: "ready" | "missing" | "invalid" | "not-readable" | "not-writable";
};

export type MemoryHealthDiagnostic = {
  readonly status: MemoryHealthStatus;
  readonly provider: MemoryHealthProvider;
  readonly readyFiles: readonly string[];
  readonly missingFiles: readonly string[];
  readonly problemFiles: readonly MemoryFileStatus[];
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
};

const MEMORY_FILE_KEYS = ["userMdPath", "soulMdPath", "memoryMdPath"] as const;

export async function diagnoseMemoryHealth(options: {
  readonly homeDir?: string;
  readonly profileId: string;
}): Promise<MemoryHealthDiagnostic> {
  const paths = resolveProfileStateHome({ homeDir: options.homeDir, profileId: options.profileId });
  const warnings: string[] = [];
  const notes: string[] = [];
  const readyFiles: string[] = [];
  const missingFiles: string[] = [];
  const problemFiles: MemoryFileStatus[] = [];
  const profileRootStatus = await pathStatus(paths.profileRoot, "directory");

  if (profileRootStatus !== "ready") {
    const status = fileStatus(paths.profileRoot, "profile root", profileRootStatus);
    problemFiles.push(status);
    warnings.push(`Memory profile root is missing or invalid: ${paths.profileRoot}`);
    return {
      status: "warning",
      provider: "file",
      readyFiles,
      missingFiles,
      problemFiles,
      warnings,
      notes
    };
  }

  for (const key of MEMORY_FILE_KEYS) {
    const path = paths[key];
    const label = basename(path);
    const status = await pathStatus(path, "file");
    if (status === "ready") {
      readyFiles.push(path);
      continue;
    }
    if (status === "missing") {
      missingFiles.push(path);
      notes.push(`Memory file will be created on first write: ${path}`);
      continue;
    }
    const problem = fileStatus(path, label, status);
    problemFiles.push(problem);
    warnings.push(`Memory file ${label} is not usable: ${path}`);
  }

  return {
    status: warnings.length > 0 ? "warning" : "ready",
    provider: "file",
    readyFiles,
    missingFiles,
    problemFiles,
    warnings,
    notes
  };
}

async function pathStatus(
  path: string,
  expected: "file" | "directory"
): Promise<MemoryFileStatus["status"]> {
  try {
    const pathStat = await stat(path);
    if (expected === "directory") {
      return pathStat.isDirectory() ? "ready" : "invalid";
    }
    if (!pathStat.isFile()) {
      return "invalid";
    }
    try {
      await access(path, constants.R_OK);
    } catch {
      return "not-readable";
    }
    try {
      await access(path, constants.W_OK);
    } catch {
      return "not-writable";
    }
    return "ready";
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT") || isNodeErrorCode(error, "ENOTDIR")) {
      return "missing";
    }
    throw error;
  }
}

function fileStatus(
  path: string,
  label: string,
  status: MemoryFileStatus["status"]
): MemoryFileStatus {
  return { path, label, status };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
