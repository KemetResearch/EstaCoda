import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export type CronWorkdirResolution = {
  ok: true;
  workdir: string;
  trustedWorkspace: boolean;
  reason?: string;
} | {
  ok: false;
  message: string;
};

export async function resolveCronWorkdir(input: {
  requestedWorkdir: string | undefined;
  defaultWorkspaceRoot: string;
  allowedRoots: string[];
  isWorkspaceTrusted: (path: string) => Promise<boolean>;
}): Promise<CronWorkdirResolution> {
  const defaultRoot = await canonicalize(input.defaultWorkspaceRoot, "default workspace root");
  if (!defaultRoot.ok) return defaultRoot;
  const allowedRoots = await Promise.all(
    [...new Set([input.defaultWorkspaceRoot, ...input.allowedRoots])].map((root) => canonicalize(root, "allowed workspace root"))
  );
  const failedRoot = allowedRoots.find((root) => !root.ok);
  if (failedRoot !== undefined) return failedRoot;
  const canonicalAllowedRoots = allowedRoots
    .filter((root): root is Extract<CronWorkdirResolution, { ok: true }> => root.ok)
    .map((root) => root.workdir);

  if (input.requestedWorkdir === undefined) {
    return {
      ok: true,
      workdir: defaultRoot.workdir,
      trustedWorkspace: await input.isWorkspaceTrusted(defaultRoot.workdir)
    };
  }

  const requested = input.requestedWorkdir.trim();
  if (requested.length === 0) {
    return { ok: false, message: "Cron workdir must be a non-empty absolute path." };
  }
  if (!isAbsolute(requested)) {
    return { ok: false, message: "Cron workdir must be an absolute path." };
  }

  const resolved = await canonicalize(requested, "cron workdir");
  if (!resolved.ok) return resolved;
  if (!canonicalAllowedRoots.some((root) => isSameOrChildPath(root, resolved.workdir))) {
    return { ok: false, message: "Cron workdir must stay inside an allowed workspace root." };
  }

  return {
    ok: true,
    workdir: resolved.workdir,
    trustedWorkspace: await input.isWorkspaceTrusted(resolved.workdir)
  };
}

async function canonicalize(path: string, label: string): Promise<CronWorkdirResolution> {
  try {
    return {
      ok: true,
      workdir: await realpath(resolve(path)),
      trustedWorkspace: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Cannot resolve ${label}: ${message}` };
  }
}

function isSameOrChildPath(root: string, target: string): boolean {
  const diff = relative(root, target);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}
