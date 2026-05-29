import { describe, it, expect } from "vitest";
import { collectStartupReadinessSnapshot } from "./startup-readiness.js";
import type { SetupVerificationReport } from "../setup/verification.js";
import type { ProviderDiagnostic } from "../config/provider-diagnostics.js";

function makeProviderDiagnostic(status: ProviderDiagnostic["status"], warnings: string[] = []): ProviderDiagnostic {
  return {
    status,
    lines: [],
    warnings,
  };
}

function makeVerificationReport(overrides: Partial<SetupVerificationReport> = {}): SetupVerificationReport {
  return {
    stateWritable: true,
    envFilePresent: false,
    envFileSecure: true,
    workspaceTrusted: true,
    securityModeLabel: "Adaptive",
    securityModeValue: "adaptive",
    skillAutonomyLabel: "Suggest",
    skillAutonomyValue: "suggest",
    providerDiagnostic: makeProviderDiagnostic("ready"),
    toolStatus: "skipped",
    configSources: [],
    warnings: [],
    issueCodes: [],
    ...overrides,
  };
}

describe("collectStartupReadinessSnapshot", () => {
  it("returns trusted when workspaceTrusted is true", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceTrust).toBe("trusted");
  });

  it("returns untrusted when workspaceTrusted is false", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: false,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceTrust).toBe("untrusted");
  });

  it("maps provider ready to ready", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.providerReadiness).toBe("ready");
  });

  it("maps provider warning to degraded", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport({ providerDiagnostic: makeProviderDiagnostic("warning", ["Low context window"]) }),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.providerReadiness).toBe("degraded");
  });

  it("maps provider blocked to missing-config", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport({ providerDiagnostic: makeProviderDiagnostic("blocked", ["Provider setup is incomplete."]) }),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.providerReadiness).toBe("missing-config");
  });

  it("defaults versionStatus to unknown when not provided", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.versionStatus).toBe("unknown");
  });

  it("uses explicit versionStatus when provided", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
      versionStatus: "update-available",
    });
    expect(snapshot.versionStatus).toBe("update-available");
  });

  it("adds an update hint warning only when an update is available", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
      versionStatus: "update-available",
      updateHint: "Update available. Run: estacoda update",
    });

    expect(snapshot.updateHint).toBe("Update available. Run: estacoda update");
    expect(snapshot.warnings).toContainEqual({
      kind: "warning",
      severity: "info",
      title: "Update",
      message: "Update available. Run: estacoda update",
    });
  });

  it("does not add an update hint warning when up to date", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
      versionStatus: "up-to-date",
      updateHint: "Update available. Run: estacoda update",
    });

    expect(snapshot.warnings.some((warning) => warning.title === "Update")).toBe(false);
  });

  it("returns verified when all checks pass", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceVerification).toBe("verified");
  });

  it("returns unverified when state is not writable", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport({ stateWritable: false }),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceVerification).toBe("unverified");
  });

  it("returns unverified when env file is insecure", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport({ envFilePresent: true, envFileSecure: false }),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceVerification).toBe("unverified");
  });

  it("returns unverified when workspace is not trusted", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: false,
      verificationReport: makeVerificationReport({ workspaceTrusted: false }),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceVerification).toBe("unverified");
  });

  it("returns unverified when provider is blocked", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport({ providerDiagnostic: makeProviderDiagnostic("blocked") }),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceVerification).toBe("unverified");
  });

  it("returns unverified when tool check is blocked", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport({ toolStatus: "blocked" }),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceVerification).toBe("unverified");
  });

  it("includes workspaceDirectory from workspaceRoot", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.workspaceDirectory).toBe("/workspace");
  });

  it("includes securityMode and skillAutonomy when provided", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
      securityMode: "open",
      skillAutonomy: "autonomous",
    });
    expect(snapshot.securityMode).toBe("open");
    expect(snapshot.skillAutonomy).toBe("autonomous");
  });

  it("collects warnings from verification report and provider diagnostic", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport({ warnings: ["State not writable"], providerDiagnostic: makeProviderDiagnostic("warning", ["Low context window"]) }),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(snapshot.warnings).toHaveLength(2);
    expect(snapshot.warnings[0]).toMatchObject({ kind: "warning", severity: "warn", title: "Setup", message: "State not writable" });
    expect(snapshot.warnings[1]).toMatchObject({ kind: "warning", severity: "warn", title: "Provider", message: "Low context window" });
  });

  it("produces a plain object with no methods", () => {
    const snapshot = collectStartupReadinessSnapshot({
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      verificationReport: makeVerificationReport(),
      model: { provider: "openrouter", id: "claude-sonnet" },
    });
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
  });
});
