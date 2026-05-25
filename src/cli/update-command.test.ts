import { describe, expect, it } from "vitest";
import { runUpdateCommand } from "./update-command.js";
import type { InstallMethod, InstallMethodInfo } from "../lifecycle/install-method.js";

function installInfo(method: InstallMethod, overrides: Partial<InstallMethodInfo> = {}): InstallMethodInfo {
  const commandByMethod: Record<InstallMethod, string> = {
    "managed-source": "estacoda update",
    "manual-source": "git fetch origin && git status",
    homebrew: "brew upgrade kemetresearch/tap/estacoda",
    docker: "docker pull ghcr.io/kemetresearch/estacoda:latest",
    "npm-global": "npm install -g estacoda@latest",
    "pnpm-global": "pnpm add -g estacoda@latest",
    unknown: "reinstall using documented install path"
  };

  return {
    method,
    source: "path",
    recommendedUpdateCommand: commandByMethod[method],
    canSelfUpdate: method === "managed-source",
    reason: `${method} test install`,
    ...overrides
  };
}

describe("runUpdateCommand install-method routing", () => {
  it.each([
    ["manual-source", "git fetch origin && git status"],
    ["homebrew", "brew upgrade kemetresearch/tap/estacoda"],
    ["docker", "docker pull ghcr.io/kemetresearch/estacoda:latest"],
    ["npm-global", "npm install -g estacoda@latest"],
    ["pnpm-global", "pnpm add -g estacoda@latest"],
    ["unknown", "reinstall using documented install path"]
  ] as const)("prints safe dry-run guidance for %s installs", async (method, command) => {
    let checked = false;
    const result = await runUpdateCommand({
      dryRun: true,
      apply: false,
      homeDir: "/tmp/estacoda-home",
      installMethodInfo: installInfo(method),
      checkForUpdate: async () => {
        checked = true;
        return { kind: "error", message: "should not check" };
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Update routing (dry run)");
    expect(result.output).toContain(`Detected install method: ${method}`);
    expect(result.output).toContain(command);
    expect(result.output).toContain("This was a dry run. No files were modified.");
    expect(checked).toBe(false);
  });

  it("refuses to self-mutate manual-source installs on apply", async () => {
    const result = await runUpdateCommand({
      dryRun: false,
      apply: true,
      homeDir: "/tmp/estacoda-home",
      installMethodInfo: installInfo("manual-source")
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Detected install method: manual-source");
    expect(result.output).toContain("Manual source checkouts are not self-mutated");
    expect(result.output).toContain("No files were modified.");
  });

  it("reports that managed-source apply is reserved for PR-I5", async () => {
    let checkedArtifact = false;
    let appliedArtifact = false;
    const result = await runUpdateCommand({
      dryRun: false,
      apply: true,
      homeDir: "/tmp/estacoda-home",
      installMethodInfo: installInfo("managed-source"),
      canApplyUpdate: () => {
        checkedArtifact = true;
        return { testable: true, reason: "test artifact" };
      },
      applyUpdate: async () => {
        appliedArtifact = true;
        return { kind: "success", message: "should not apply" };
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Detected install method: managed-source");
    expect(result.output).toContain("PR-I5");
    expect(result.output).toContain("No files were modified.");
    expect(checkedArtifact).toBe(false);
    expect(appliedArtifact).toBe(false);
  });

  it("keeps managed-source dry-run on the existing update check path", async () => {
    const result = await runUpdateCommand({
      dryRun: true,
      apply: false,
      homeDir: "/tmp/estacoda-home",
      installMethodInfo: installInfo("managed-source"),
      checkForUpdate: async () => ({ kind: "up-to-date", current: "0.0.5" })
    });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("latest version");
  });
});
