import type { ProviderDiagnostic } from "../config/provider-diagnostics.js";
import type { WarningErrorViewModel } from "../contracts/view-model.js";
import type { SetupVerificationReport } from "../onboarding/verification.js";

export type StartupReadinessSnapshot = {
  readonly workspaceTrust: "trusted" | "untrusted" | "unknown";
  readonly workspaceVerification: "verified" | "unverified" | "unknown";
  readonly providerReadiness: "ready" | "degraded" | "missing-config" | "unknown";
  readonly versionStatus: "up-to-date" | "update-available" | "unknown";
  readonly updateHint?: string;
  readonly workspaceDirectory?: string;
  readonly securityMode?: string;
  readonly skillAutonomy?: string;
  readonly model: { readonly provider: string; readonly id: string };
  readonly warnings: readonly WarningErrorViewModel[];
};

export type StartupReadinessInput = {
  readonly workspaceRoot: string;
  readonly workspaceTrusted: boolean;
  readonly verificationReport: SetupVerificationReport;
  readonly model: { readonly provider: string; readonly id: string };
  readonly versionStatus?: "up-to-date" | "update-available" | "unknown";
  readonly updateHint?: string;
  readonly securityMode?: string;
  readonly skillAutonomy?: string;
};

export function collectStartupReadinessSnapshot(
  input: StartupReadinessInput
): StartupReadinessSnapshot {
  const workspaceTrust = input.workspaceTrusted ? "trusted" : "untrusted";
  const workspaceVerification = deriveWorkspaceVerification(input.verificationReport);
  const providerReadiness = mapProviderDiagnosticToReadiness(input.verificationReport.providerDiagnostic.status);

  const warnings: WarningErrorViewModel[] = [];
  for (const warning of input.verificationReport.warnings) {
    warnings.push({ kind: "warning", severity: "warn", title: "Setup", message: warning });
  }
  for (const warning of input.verificationReport.providerDiagnostic.warnings) {
    warnings.push({ kind: "warning", severity: "warn", title: "Provider", message: warning });
  }
  if (input.versionStatus === "update-available" && input.updateHint !== undefined && input.updateHint.length > 0) {
    warnings.push({ kind: "warning", severity: "info", title: "Update", message: input.updateHint });
  }

  return {
    workspaceTrust,
    workspaceVerification,
    providerReadiness,
    versionStatus: input.versionStatus ?? "unknown",
    updateHint: input.updateHint,
    workspaceDirectory: input.workspaceRoot,
    securityMode: input.securityMode,
    skillAutonomy: input.skillAutonomy,
    model: input.model,
    warnings,
  };
}

function deriveWorkspaceVerification(
  report: SetupVerificationReport
): "verified" | "unverified" | "unknown" {
  if (!report.stateWritable) return "unverified";
  if (report.envFilePresent && !report.envFileSecure) return "unverified";
  if (!report.workspaceTrusted) return "unverified";
  if (report.providerDiagnostic.status === "blocked") return "unverified";
  if (report.toolStatus === "blocked") return "unverified";
  return "verified";
}

function mapProviderDiagnosticToReadiness(
  status: ProviderDiagnostic["status"]
): StartupReadinessSnapshot["providerReadiness"] {
  switch (status) {
    case "ready":
      return "ready";
    case "warning":
      return "degraded";
    case "blocked":
      return "missing-config";
    default:
      return "unknown";
  }
}
