import { runUninstall, type UninstallOptions, type UninstallResult } from "../lifecycle/uninstall.js";

export type UninstallCommandOptions = Omit<UninstallOptions, "mode" | "yes"> & {
  args?: readonly string[];
};

export async function runUninstallCommand(options: UninstallCommandOptions = {}): Promise<UninstallResult> {
  const parsed = parseUninstallArgs(options.args ?? []);
  if (!parsed.ok) {
    return { exitCode: 1, output: parsed.error };
  }

  if (parsed.help) {
    return { exitCode: 0, output: renderUninstallHelp() };
  }

  return runUninstall({
    ...options,
    mode: parsed.purge ? "purge" : "keep-data",
    yes: parsed.yes
  });
}

function parseUninstallArgs(args: readonly string[]):
  | { ok: true; purge: boolean; yes: boolean; help: boolean }
  | { ok: false; error: string } {
  let purge = false;
  let yes = false;
  let help = false;

  for (const arg of args) {
    switch (arg) {
      case "--purge":
        purge = true;
        break;
      case "--yes":
      case "-y":
        yes = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        return { ok: false, error: `Unknown uninstall option: ${arg}` };
    }
  }

  return { ok: true, purge, yes, help };
}

function renderUninstallHelp(): string {
  return [
    "Usage: estacoda uninstall [--purge] [--yes]",
    "",
    "Default mode removes managed-source code, known wrappers, installer-owned PATH entries, and gateway services while preserving ~/.estacoda.",
    "--purge removes user data too and requires --yes in non-interactive CLI usage.",
    "--yes without --purge keeps user data."
  ].join("\n");
}
