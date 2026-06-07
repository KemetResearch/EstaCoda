import { access } from "node:fs/promises";
import { isAbsolute, posix, resolve, win32 } from "node:path";

export type ChromiumFinderSource =
  | "launchExecutable"
  | "launchCommand"
  | "env"
  | "nodeModules"
  | "platformDefault"
  | "homebrew"
  | "docker";

export interface ChromiumFinderOptions {
  launchExecutable?: string;
  launchCommand?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  cwd?: string;
  homeDir?: string;
  pathExists?: (path: string) => boolean | Promise<boolean>;
}

export interface ChromiumFinderResult {
  executablePath?: string;
  source?: ChromiumFinderSource;
  deprecatedLaunchCommand?: boolean;
  warnings?: string[];
}

type Candidate = {
  path: string;
  source: ChromiumFinderSource;
  deprecatedLaunchCommand?: boolean;
};

const LAUNCH_COMMAND_MIGRATION_WARNING =
  "browser.launchCommand is deprecated and was not used because it contains whitespace or shell syntax; use browser.launchExecutable plus browser.launchArgs instead.";

export async function findChromiumExecutable(options: ChromiumFinderOptions = {}): Promise<ChromiumFinderResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const pathExists = options.pathExists ?? defaultPathExists;
  const warnings: string[] = [];

  const launchExecutable = normalizeOptionalPathValue(options.launchExecutable);
  if (launchExecutable !== undefined) {
    const found = await findFirstExistingCandidate([{
      path: absolutePath(launchExecutable, platform, cwd),
      source: "launchExecutable"
    }], pathExists);
    if (found !== undefined) {
      return result(found, warnings);
    }
  }

  const launchCommand = normalizeOptionalPathValue(options.launchCommand);
  if (launchCommand !== undefined) {
    if (hasShellLikeLaunchCommandSyntax(launchCommand)) {
      warnings.push(LAUNCH_COMMAND_MIGRATION_WARNING);
    } else {
      const found = await findFirstExistingCandidate([{
        path: absolutePath(launchCommand, platform, cwd),
        source: "launchCommand",
        deprecatedLaunchCommand: true
      }], pathExists);
      if (found !== undefined) {
        return result(found, warnings);
      }
    }
  }

  const found = await findFirstExistingCandidate([
    ...envCandidates(env, platform, cwd),
    ...nodeModulesCandidates(platform, cwd),
    ...platformDefaultCandidates(platform, env, options.homeDir),
    ...homebrewCandidates(),
    ...dockerCandidates()
  ], pathExists);

  if (found !== undefined) {
    return result(found, warnings);
  }

  return warnings.length > 0
    ? { executablePath: undefined, warnings }
    : { executablePath: undefined };
}

function result(candidate: Candidate, warnings: string[]): ChromiumFinderResult {
  return {
    executablePath: candidate.path,
    source: candidate.source,
    deprecatedLaunchCommand: candidate.deprecatedLaunchCommand,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

async function findFirstExistingCandidate(
  candidates: Candidate[],
  pathExists: (path: string) => boolean | Promise<boolean>
): Promise<Candidate | undefined> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) {
      continue;
    }
    seen.add(candidate.path);
    if (await pathExists(candidate.path)) {
      return candidate;
    }
  }
  return undefined;
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function envCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, cwd: string): Candidate[] {
  return [
    env.CHROME_PATH,
    env.CHROMIUM_PATH
  ].flatMap((path) => candidateFromOptionalValue(path, "env", platform, cwd));
}

function nodeModulesCandidates(platform: NodeJS.Platform, cwd: string): Candidate[] {
  return [{
    path: platformPath(platform).join(cwd, "node_modules", ".bin", "chromium"),
    source: "nodeModules"
  }];
}

function platformDefaultCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string | undefined
): Candidate[] {
  if (platform === "linux") {
    return [
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    ].map((path) => ({ path, source: "platformDefault" }));
  }

  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      homeDir === undefined ? undefined : posix.join(homeDir, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      homeDir === undefined ? undefined : posix.join(homeDir, "Applications", "Chromium.app", "Contents", "MacOS", "Chromium")
    ].flatMap((path) => candidateFromAbsolute(path, "platformDefault"));
  }

  if (platform === "win32") {
    const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] ?? env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA ?? (homeDir === undefined ? undefined : win32.join(homeDir, "AppData", "Local"));
    return [
      localAppData === undefined ? undefined : win32.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      win32.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      win32.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      win32.join(programFiles, "Chromium", "Application", "chrome.exe"),
      win32.join(programFilesX86, "Chromium", "Application", "chrome.exe")
    ].flatMap((path) => candidateFromAbsolute(path, "platformDefault"));
  }

  return [];
}

function homebrewCandidates(): Candidate[] {
  return [
    "/opt/homebrew/bin/chromium",
    "/usr/local/bin/chromium",
    "/opt/homebrew/bin/google-chrome",
    "/usr/local/bin/google-chrome"
  ].map((path) => ({ path, source: "homebrew" }));
}

function dockerCandidates(): Candidate[] {
  return [
    "/opt/google/chrome/chrome",
    "/opt/chrome/chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chrome"
  ].map((path) => ({ path, source: "docker" }));
}

function candidateFromOptionalValue(
  value: string | undefined,
  source: ChromiumFinderSource,
  platform: NodeJS.Platform,
  cwd: string
): Candidate[] {
  const normalized = normalizeOptionalPathValue(value);
  return normalized === undefined
    ? []
    : [{ path: absolutePath(normalized, platform, cwd), source }];
}

function candidateFromAbsolute(value: string | undefined, source: ChromiumFinderSource): Candidate[] {
  return value === undefined ? [] : [{ path: value, source }];
}

function normalizeOptionalPathValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function absolutePath(value: string, platform: NodeJS.Platform, cwd: string): string {
  if (platform === "win32") {
    return win32.isAbsolute(value) ? value : win32.resolve(cwd, value);
  }
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function platformPath(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === "win32" ? win32 : posix;
}

function hasShellLikeLaunchCommandSyntax(value: string): boolean {
  return /\s/.test(value) || /[;&|<>`$\\\r\n"'()]/.test(value);
}
