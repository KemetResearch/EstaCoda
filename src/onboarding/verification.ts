import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultEnvPath } from "../config/env-secret-store.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { diagnoseProviderConfig, renderProviderDiagnostic } from "../config/provider-diagnostics.js";
import { WorkspaceTrustStore } from "../security/workspace-trust-store.js";
import type { Runtime } from "../runtime/create-runtime.js";
import type { OnboardingOptions } from "./onboarding-flow.js";

export type SetupVerificationResult = {
  ok: boolean;
  output: string;
};

export async function runSetupVerification(options: OnboardingOptions & {
  runtime?: Runtime;
  trustStorePath?: string;
}): Promise<SetupVerificationResult> {
  const config = await loadRuntimeConfig(options);
  const provider = await diagnoseProviderConfig(config);
  const trustStore = new WorkspaceTrustStore({
    path: options.trustStorePath ?? join(options.homeDir ?? process.env.HOME ?? "", ".estacoda", "trust.json")
  });
  const workspaceTrusted = await trustStore.isTrusted(options.workspaceRoot);
  const stateRoot = join(options.homeDir ?? process.env.HOME ?? "", ".estacoda");
  const verifyFile = join(stateRoot, ".verify");
  const envPath = defaultEnvPath(options.homeDir);
  let stateWritable = false;
  let envMode = "not present";
  let toolStatus = "skipped";
  const warnings: string[] = [];

  try {
    await mkdir(stateRoot, { recursive: true });
    await writeFile(verifyFile, "ok\n", "utf8");
    stateWritable = true;
  } catch {
    warnings.push("State directory is not writable.");
  }

  try {
    const envStat = await stat(envPath);
    envMode = `present (${(envStat.mode & 0o777).toString(8).padStart(3, "0")})`;
    if ((envStat.mode & 0o777) !== 0o600) {
      warnings.push("Secret store permissions should be 0600.");
    }
  } catch {
    envMode = "not present";
  }

  if (provider.status !== "ready") {
    warnings.push(...provider.warnings);
  }

  if (!workspaceTrusted) {
    warnings.push("Workspace is not trusted yet; local write/terminal actions will ask first.");
  }

  if (options.runtime?.executeTool !== undefined) {
    const packageJson = join(options.workspaceRoot, "package.json");
    try {
      await stat(packageJson);
      const response = await options.runtime.executeTool({
        tool: "file.read",
        toolInput: { path: "package.json" }
      });
      toolStatus = response?.result?.ok === true ? "ready" : "blocked";
      if (response?.result?.ok !== true) {
        warnings.push("Read-only file tool check did not complete.");
      }
    } catch {
      toolStatus = "skipped (no package.json)";
    }
  }

  return {
    ok: warnings.length === 0,
    output: [
      "EstaCoda verify",
      `State directory: ${stateWritable ? "writable" : "blocked"}`,
      `Secret store: ${envMode}`,
      `Workspace trust: ${workspaceTrusted ? "trusted" : "not trusted"}`,
      `Security mode: ${config.security.approvalMode}`,
      `Skill autonomy: ${config.skills.autonomy}`,
      `Read-only tool check: ${toolStatus}`,
      `Config sources: ${config.sources.join(", ") || "none"}`,
      "",
      renderProviderDiagnostic(provider),
      "",
      warnings.length === 0 ? "Status: ready" : `Warnings:\n${[...new Set(warnings)].map((warning) => `- ${warning}`).join("\n")}`
    ].join("\n")
  };
}
