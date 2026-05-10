import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderDiagnostic } from "../config/provider-diagnostics.js";
import type { SetupVerificationReport } from "./verification.js";
import type { SetupEntryRecommendedAction, SetupEntryState, SetupEntryStateKind } from "./setup-entry-state.js";
import { collectSetupRoute, renderSetupRouteDecision, routeSetupEntryState, type SetupRouteKind } from "./setup-router.js";

function providerDiagnostic(status: ProviderDiagnostic["status"] = "ready"): ProviderDiagnostic {
  return {
    status,
    lines: ["Selected route: local/hermes-local"],
    warnings: status === "ready" ? [] : ["Configured model context window is below 64K tokens."],
  };
}

function verificationReport(overrides: Partial<SetupVerificationReport> = {}): SetupVerificationReport {
  return {
    stateWritable: true,
    envFilePresent: false,
    envFileSecure: true,
    workspaceTrusted: true,
    securityModeLabel: "Adaptive",
    securityModeValue: "adaptive",
    skillAutonomyLabel: "Suggest",
    skillAutonomyValue: "suggest",
    providerDiagnostic: providerDiagnostic(),
    toolStatus: "skipped",
    configSources: ["/tmp/home/.estacoda/config.json"],
    warnings: [],
    issueCodes: [],
    ...overrides,
  };
}

function state(kind: SetupEntryStateKind, overrides: Partial<SetupEntryState> = {}): SetupEntryState {
  const report = verificationReport({
    workspaceTrusted: kind !== "untrusted-workspace",
    stateWritable: kind !== "state-not-writable",
    providerDiagnostic: providerDiagnostic(kind === "configured-degraded" ? "warning" : kind === "configured-ready" || kind === "untrusted-workspace" ? "ready" : "blocked"),
    warnings: kind === "configured-degraded" ? ["Configured model context window is below 64K tokens."] : [],
  });

  return {
    kind,
    recommendedAction: recommendedAction(kind),
    configSources: kind === "new-user" ? [] : ["/tmp/home/.estacoda/config.json"],
    configPaths: {
      user: "/tmp/home/.estacoda/config.json",
      project: "/tmp/workspace/.estacoda/config.json",
    },
    providerReadiness: kind === "configured-ready" || kind === "untrusted-workspace" ? "ready" : kind === "configured-degraded" ? "degraded" : "missing-config",
    workspaceTrust: kind === "untrusted-workspace" ? "untrusted" : "trusted",
    workspaceVerification: kind === "configured-ready" ? "verified" : "unverified",
    stateDirectoryWritable: kind !== "state-not-writable",
    missingCredentials: kind === "missing-secret" ? { envVars: ["OPENAI_API_KEY"], providers: [] } : { envVars: [], providers: [] },
    setupVerification: report,
    warnings: report.warnings,
    blockers: kind === "configured-ready" ? [] : [`${kind} blocker`],
    model: {
      provider: kind === "new-user" ? "unconfigured" : "local",
      id: kind === "new-user" ? "unconfigured" : "hermes-local",
    },
    ...overrides,
  };
}

function recommendedAction(kind: SetupEntryStateKind): SetupEntryRecommendedAction {
  switch (kind) {
    case "new-user":
      return "start-first-run";
    case "configured-ready":
      return "launch-agent";
    case "configured-degraded":
      return "review-warnings";
    case "partial-provider":
      return "repair-provider";
    case "missing-secret":
      return "add-missing-secret";
    case "broken-config":
      return "repair-config";
    case "untrusted-workspace":
      return "trust-workspace";
    case "state-not-writable":
      return "fix-state-directory";
  }
}

describe("routeSetupEntryState", () => {
  const cases: Array<{
    kind: SetupEntryStateKind;
    route: SetupRouteKind;
    firstAction: string;
  }> = [
    { kind: "new-user", route: "first-run-onboarding", firstAction: "run-guided-onboarding" },
    { kind: "configured-ready", route: "configured-menu", firstAction: "launch-agent" },
    { kind: "configured-degraded", route: "configured-degraded-menu", firstAction: "repair-setup" },
    { kind: "partial-provider", route: "repair-first-menu", firstAction: "repair-setup" },
    { kind: "missing-secret", route: "repair-first-menu", firstAction: "repair-setup" },
    { kind: "broken-config", route: "repair-first-menu", firstAction: "repair-setup" },
    { kind: "state-not-writable", route: "repair-first-menu", firstAction: "repair-setup" },
    { kind: "untrusted-workspace", route: "configured-menu", firstAction: "trust-workspace" },
  ];

  it.each(cases)("routes $kind to $route", ({ kind, route, firstAction }) => {
    const decision = routeSetupEntryState(state(kind));

    expect(decision.kind).toBe(route);
    expect(decision.state.kind).toBe(kind);
    expect(decision.actions[0]?.id).toBe(firstAction);
    expect(decision.readOnly).toBe(true);
  });

  it("adds an explicit trust warning for untrusted workspaces", () => {
    const decision = routeSetupEntryState(state("untrusted-workspace"));

    expect(decision.summary).toContain("not trusted");
    expect(decision.warnings).toContain("Workspace is not trusted.");
    expect(decision.actions.some((action) => action.id === "trust-workspace")).toBe(true);
  });

  it("routes any state to read-only verification when verify is selected", () => {
    for (const kind of cases.map((entry) => entry.kind)) {
      const decision = routeSetupEntryState(state(kind), { selection: "verify" });
      expect(decision.kind).toBe("verify-readonly");
      expect(decision.actions.every((action) => action.mutatesConfig === false)).toBe(true);
      expect(decision.summary).toContain("without changing config");
    }
  });

  it("renders deterministic noninteractive route output", () => {
    const decision = routeSetupEntryState(state("configured-degraded"));
    const first = renderSetupRouteDecision(decision);
    const second = renderSetupRouteDecision(decision);

    expect(first).toBe(second);
    expect(first).toContain("EstaCoda is configured with warnings");
    expect(first).toContain("State: configured-degraded");
    expect(first).toContain("- verify-setup: Verify setup");
  });
});

describe("collectSetupRoute", () => {
  it("collects setup state and routes beside the POC without mutating config", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "estacoda-setup-router-"));
    const workspaceRoot = join(homeDir, "workspace");
    await mkdir(workspaceRoot, { recursive: true });

    const decision = await collectSetupRoute({ homeDir, workspaceRoot });

    expect(decision.kind).toBe("first-run-onboarding");
    expect(decision.state.kind).toBe("new-user");
    expect(decision.actions[0]?.id).toBe("run-guided-onboarding");
    expect(existsSync(join(homeDir, ".estacoda", "config.json"))).toBe(false);
  });
});
