import { spawnSync } from "node:child_process";
import { accessSync, readFileSync } from "node:fs";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type ExecMode = "source" | "package-bin" | "compiled";

export type ResolvedExec = {
  mode: ExecMode;
  command: string;
  args: string[];
  cwd: string;
};

export type ResolveGatewayExecOptions = {
  workspaceRoot: string;
  commandLookup?: (command: string) => string | undefined;
  execPath?: string;
};

export type ResolveGatewayExecResult =
  | { ok: true; resolved: ResolvedExec }
  | { ok: false; error: string };

export function resolveGatewayExec(options: ResolveGatewayExecOptions): ResolveGatewayExecResult {
  const workspaceRoot = resolve(options.workspaceRoot);
  const execPath = options.execPath ?? process.execPath;
  const commandLookup = options.commandLookup ?? lookupCommand;

  const packageBin = resolvePackageBin(workspaceRoot);
  if (packageBin !== undefined) {
    return {
      ok: true,
      resolved: {
        mode: "package-bin",
        command: resolve(execPath),
        args: [packageBin],
        cwd: workspaceRoot,
      },
    };
  }

  const distIndex = join(workspaceRoot, "dist", "index.js");
  if (isReadableFile(distIndex)) {
    return {
      ok: true,
      resolved: {
        mode: "compiled",
        command: resolve(execPath),
        args: [distIndex],
        cwd: workspaceRoot,
      },
    };
  }

  const bunPath = commandLookup("bun") ?? bunExecPathFallback(execPath);
  if (bunPath === undefined) {
    return { ok: false, error: "bun not found in PATH. Install bun or use compiled/package mode." };
  }

  return {
    ok: true,
    resolved: {
      mode: "source",
      command: resolve(bunPath),
      args: ["run", join(workspaceRoot, "src", "index.ts")],
      cwd: workspaceRoot,
    },
  };
}

function resolvePackageBin(workspaceRoot: string): string | undefined {
  const packageJsonPath = join(workspaceRoot, "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return undefined;
  }

  if (parsed === null || typeof parsed !== "object" || !("bin" in parsed)) {
    return undefined;
  }

  const bin = (parsed as { bin?: unknown }).bin;
  const relativeBin = typeof bin === "string"
    ? bin
    : bin !== null && typeof bin === "object"
      ? selectBinEntry(bin as Record<string, unknown>)
      : undefined;

  if (typeof relativeBin !== "string" || relativeBin.trim().length === 0) {
    return undefined;
  }

  const absoluteBin = isAbsolute(relativeBin) ? relativeBin : join(workspaceRoot, relativeBin);
  return isReadableFile(absoluteBin) ? absoluteBin : undefined;
}

function selectBinEntry(bin: Record<string, unknown>): string | undefined {
  if (typeof bin.estacoda === "string") return bin.estacoda;
  for (const value of Object.values(bin)) {
    if (typeof value === "string") return value;
  }
  return undefined;
}

function lookupCommand(command: string): string | undefined {
  const result = spawnSync("which", [command], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return undefined;
  }
  const firstLine = result.stdout.split(/\r?\n/u).find((line) => line.trim().length > 0);
  return firstLine === undefined ? undefined : firstLine.trim();
}

function bunExecPathFallback(execPath: string): string | undefined {
  return dirname(execPath).endsWith("bun") || execPath.endsWith("/bun") || execPath.endsWith("\\bun.exe")
    ? execPath
    : undefined;
}

function isReadableFile(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
