import {
  checkForUpdate,
  readCachedUpdateInfo,
  writeCachedUpdateStatus,
  type CachedUpdateInfo,
  type UpdateCheckResult
} from "./update-engine.js";
import {
  detectInstallMethod,
  type InstallMethodInfo
} from "./install-method.js";
import {
  resolveGitUpdateInfo,
  type GitUpdateResolverResult
} from "./version-resolver.js";

export type StartupUpdatePrefetchOptions = {
  homeDir: string;
  workspaceRoot?: string;
  detectInstallMethod?: () => Promise<InstallMethodInfo>;
  readCachedUpdateInfo?: (homeDir: string) => Promise<CachedUpdateInfo>;
  writeCachedUpdateStatus?: (homeDir: string, status: "up-to-date" | "update-available", hint?: string) => Promise<void>;
  checkForUpdate?: () => Promise<UpdateCheckResult>;
  checkGitUpdate?: (info: InstallMethodInfo, options: { mutateRemoteRefs: boolean }) => Promise<GitUpdateResolverResult>;
};

export type StartupUpdateScheduler = (task: () => void) => void;

export function shouldScheduleStartupUpdatePrefetch(
  argv: readonly string[],
  interactiveAvailable: boolean
): boolean {
  return argv.length === 0 && interactiveAvailable;
}

export function scheduleStartupUpdatePrefetch(
  options: StartupUpdatePrefetchOptions,
  scheduler: StartupUpdateScheduler = defaultScheduler
): void {
  scheduler(() => {
    void prefetchStartupUpdateStatus(options).catch(() => {});
  });
}

export async function prefetchStartupUpdateStatus(options: StartupUpdatePrefetchOptions): Promise<void> {
  if (options.homeDir.length === 0) {
    return;
  }

  const readCache = options.readCachedUpdateInfo ?? readCachedUpdateInfo;
  const cached = await readCache(options.homeDir).catch(() => ({ versionStatus: "unknown" as const }));
  if (cached.versionStatus !== "unknown") {
    return;
  }

  const installMethod = await (options.detectInstallMethod ?? (() => detectInstallMethod({
    cwd: options.workspaceRoot,
    includeCwd: true,
    entrypointPath: process.argv[1],
    moduleUrl: import.meta.url
  })))().catch(() => undefined);

  if (installMethod === undefined) {
    return;
  }

  if (installMethod.method === "managed-source" || installMethod.method === "manual-source") {
    await prefetchSourceUpdateStatus(options, installMethod);
    return;
  }

  await prefetchReleaseUpdateStatus(options, installMethod);
}

export function buildStartupUpdateHint(input: {
  installMethod: InstallMethodInfo;
  versionStatus: "up-to-date" | "update-available" | "unknown";
  commitsBehind?: number;
  remote?: string;
  branch?: string;
}): string | undefined {
  if (input.versionStatus !== "update-available") {
    return undefined;
  }

  const command = input.installMethod.recommendedUpdateCommand;

  switch (input.installMethod.method) {
    case "managed-source":
      return `${sourceAvailability(input)} Run: ${command}`;
    case "manual-source":
      return [
        `${sourceAvailability(input)} Run: ${command}`,
        "EstaCoda will not mutate this checkout automatically."
      ].join(" ");
    case "homebrew":
      return `Homebrew install detected. Update with: ${command}`;
    case "docker":
      return `Docker/container install detected. Update with: ${command}`;
    case "npm-global":
      return `npm global install detected. Update with: ${command}`;
    case "pnpm-global":
      return `pnpm global install detected. Update with: ${command}`;
    case "unknown":
      return `Update available. Update with: ${command}`;
  }
}

async function prefetchSourceUpdateStatus(
  options: StartupUpdatePrefetchOptions,
  installMethod: InstallMethodInfo
): Promise<void> {
  const installDir = installMethod.installDir;
  const branch = installMethod.expectedBranch ?? installMethod.branch ?? "main";
  if (installDir === undefined || installDir.length === 0 || branch.length === 0) {
    return;
  }

  const checker = options.checkGitUpdate ?? defaultGitUpdateCheck;
  const result = await checker(installMethod, {
    mutateRemoteRefs: false
  }).catch(() => undefined);

  if (result === undefined || !result.ok) {
    return;
  }

  const status = result.kind === "available" ? "update-available" : "up-to-date";
  const hint = buildStartupUpdateHint({
    installMethod,
    versionStatus: status,
    commitsBehind: result.info.commitsBehind,
    remote: result.info.remote,
    branch: result.info.branch
  });

  await (options.writeCachedUpdateStatus ?? writeCachedUpdateStatus)(options.homeDir, status, hint).catch(() => {});
}

async function prefetchReleaseUpdateStatus(
  options: StartupUpdatePrefetchOptions,
  installMethod: InstallMethodInfo
): Promise<void> {
  const result = await (options.checkForUpdate ?? (() => checkForUpdate({ homeDir: options.homeDir })))().catch(() => undefined);
  if (result === undefined || result.kind === "error") {
    return;
  }

  const status = result.kind === "available" ? "update-available" : "up-to-date";
  const hint = buildStartupUpdateHint({
    installMethod,
    versionStatus: status
  });
  await (options.writeCachedUpdateStatus ?? writeCachedUpdateStatus)(options.homeDir, status, hint).catch(() => {});
}

function sourceAvailability(input: {
  commitsBehind?: number;
  remote?: string;
  branch?: string;
}): string {
  const target = input.remote !== undefined && input.branch !== undefined
    ? renderGitTarget(input.remote, input.branch)
    : undefined;

  if (input.commitsBehind !== undefined && target !== undefined) {
    return `Update available: ${input.commitsBehind} commit${input.commitsBehind === 1 ? "" : "s"} behind ${target}.`;
  }

  if (target !== undefined) {
    return `Update available on ${target}.`;
  }

  return "Update available.";
}

function renderGitTarget(remote: string, branch: string): string {
  if (/^(https?:|git@|ssh:)/.test(remote)) {
    return `origin/${branch}`;
  }

  return `${remote}/${branch}`;
}

function defaultGitUpdateCheck(
  info: InstallMethodInfo,
  options: { mutateRemoteRefs: boolean }
): Promise<GitUpdateResolverResult> {
  return resolveGitUpdateInfo({
    repoDir: info.installDir ?? "",
    branch: info.expectedBranch ?? info.branch ?? "main",
    remote: info.sourceUrl ?? "origin",
    mutateRemoteRefs: options.mutateRemoteRefs
  });
}

function defaultScheduler(task: () => void): void {
  setTimeout(task, 0);
}
