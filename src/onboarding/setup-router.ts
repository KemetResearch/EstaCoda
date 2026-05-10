import { collectSetupEntryState, type CollectSetupEntryStateOptions, type SetupEntryState } from "./setup-entry-state.js";

export type SetupRouterSelection =
  | "entry"
  | "verify"
  | "launch-agent"
  | "repair-setup"
  | "edit-config"
  | "run-first-run"
  | "exit";

export type SetupRouteKind =
  | "first-run-onboarding"
  | "configured-menu"
  | "configured-degraded-menu"
  | "repair-first-menu"
  | "verify-readonly";

export type SetupRouteActionId =
  | "launch-agent"
  | "review-edit-config"
  | "run-guided-onboarding"
  | "verify-setup"
  | "repair-setup"
  | "show-diagnostics"
  | "trust-workspace"
  | "exit";

export type SetupRouteAction = {
  readonly id: SetupRouteActionId;
  readonly label: string;
  readonly description: string;
  readonly mutatesConfig: boolean;
};

export type SetupRouteDecision = {
  readonly kind: SetupRouteKind;
  readonly title: string;
  readonly summary: string;
  readonly state: SetupEntryState;
  readonly actions: readonly SetupRouteAction[];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly readOnly: boolean;
};

export type CollectSetupRouteOptions = CollectSetupEntryStateOptions & {
  readonly selection?: SetupRouterSelection;
};

export async function collectSetupRoute(options: CollectSetupRouteOptions): Promise<SetupRouteDecision> {
  const state = await collectSetupEntryState(options);
  return routeSetupEntryState(state, { selection: options.selection });
}

export function routeSetupEntryState(
  state: SetupEntryState,
  options: { readonly selection?: SetupRouterSelection } = {}
): SetupRouteDecision {
  if (options.selection === "verify") {
    return verifyDecision(state);
  }

  switch (state.kind) {
    case "new-user":
      return firstRunDecision(state);
    case "configured-ready":
      return configuredDecision(state);
    case "configured-degraded":
      return configuredDegradedDecision(state);
    case "untrusted-workspace":
      return untrustedConfiguredDecision(state);
    case "partial-provider":
    case "missing-secret":
    case "broken-config":
    case "state-not-writable":
      return repairFirstDecision(state);
  }
}

export function renderSetupRouteDecision(decision: SetupRouteDecision): string {
  const lines = [
    decision.title,
    decision.summary,
    "",
    `State: ${decision.state.kind}`,
    `Recommended: ${decision.state.recommendedAction}`,
  ];

  if (decision.warnings.length > 0) {
    lines.push("", "Warnings:", ...decision.warnings.map((warning) => `- ${warning}`));
  }

  if (decision.blockers.length > 0) {
    lines.push("", "Blockers:", ...decision.blockers.map((blocker) => `- ${blocker}`));
  }

  if (decision.actions.length > 0) {
    lines.push("", "Actions:");
    for (const action of decision.actions) {
      lines.push(`- ${action.id}: ${action.label}`);
      lines.push(`  ${action.description}`);
    }
  }

  return lines.join("\n");
}

function firstRunDecision(state: SetupEntryState): SetupRouteDecision {
  return {
    kind: "first-run-onboarding",
    title: "First-run setup",
    summary: "No usable setup config was found. Start first-run onboarding.",
    state,
    actions: [
      action("run-guided-onboarding", "Start first-run setup", "Choose language, trust, provider, security, optional capabilities, review, verify, and launch.", true),
      action("verify-setup", "Verify setup", "Run read-only setup verification before changing anything.", false),
      action("exit", "Exit", "Leave setup without changing config.", false),
    ],
    warnings: state.warnings,
    blockers: state.blockers,
    readOnly: true,
  };
}

function configuredDecision(state: SetupEntryState): SetupRouteDecision {
  return {
    kind: "configured-menu",
    title: "EstaCoda is already configured",
    summary: "Setup looks ready. Choose whether to launch, review config, verify, or exit.",
    state,
    actions: configuredActions(),
    warnings: state.warnings,
    blockers: [],
    readOnly: true,
  };
}

function configuredDegradedDecision(state: SetupEntryState): SetupRouteDecision {
  return {
    kind: "configured-degraded-menu",
    title: "EstaCoda is configured with warnings",
    summary: "Setup is usable, but verification found warnings. Review or repair before launch if needed.",
    state,
    actions: [
      action("repair-setup", "Fix now", "Open the guided repair path for the reported warnings.", true),
      action("verify-setup", "Verify setup", "Run read-only setup verification again.", false),
      action("launch-agent", "Continue in limited mode", "Launch the agent while accepting the current degraded state.", false),
      action("review-edit-config", "Review/edit config", "Inspect guided configuration sections.", true),
      action("exit", "Exit", "Leave setup without changing config.", false),
    ],
    warnings: state.warnings,
    blockers: state.blockers,
    readOnly: true,
  };
}

function repairFirstDecision(state: SetupEntryState): SetupRouteDecision {
  return {
    kind: "repair-first-menu",
    title: "Setup needs repair",
    summary: repairSummary(state),
    state,
    actions: [
      action("repair-setup", "Repair setup", "Start the guided repair path for the current blockers.", true),
      action("review-edit-config", "Open config editor", "Inspect or edit guided configuration sections.", true),
      action("run-guided-onboarding", "Run full onboarding", "Restart the guided setup flow from the beginning.", true),
      action("show-diagnostics", "Show diagnostics", "Show structured blockers and warnings without changing config.", false),
      action("verify-setup", "Verify setup", "Run read-only setup verification again.", false),
      action("exit", "Exit", "Leave setup without changing config.", false),
    ],
    warnings: state.warnings,
    blockers: state.blockers,
    readOnly: true,
  };
}

function untrustedConfiguredDecision(state: SetupEntryState): SetupRouteDecision {
  return {
    kind: "configured-menu",
    title: "Workspace trust required",
    summary: "Provider setup is usable, but this workspace is not trusted yet. Trust repair is available before launch.",
    state,
    actions: [
      action("trust-workspace", "Trust workspace", "Grant explicit trust for this workspace before local file or terminal work.", true),
      ...configuredActions(),
    ],
    warnings: [...new Set(["Workspace is not trusted.", ...state.warnings])],
    blockers: state.blockers,
    readOnly: true,
  };
}

function verifyDecision(state: SetupEntryState): SetupRouteDecision {
  return {
    kind: "verify-readonly",
    title: "Verify setup",
    summary: "Run setup verification without changing config.",
    state,
    actions: [
      action("verify-setup", "Verify setup", "Collect structured setup, provider, trust, state, and tool readiness diagnostics.", false),
      action("exit", "Exit", "Leave setup without changing config.", false),
    ],
    warnings: state.warnings,
    blockers: state.blockers,
    readOnly: true,
  };
}

function configuredActions(): SetupRouteAction[] {
  return [
    action("launch-agent", "Launch agent", "Start the interactive EstaCoda agent session.", false),
    action("review-edit-config", "Review/edit config", "Inspect guided configuration sections.", true),
    action("run-guided-onboarding", "Run guided onboarding again", "Run guided setup again intentionally.", true),
    action("verify-setup", "Verify setup", "Run read-only setup verification.", false),
    action("exit", "Exit", "Leave setup without changing config.", false),
  ];
}

function action(
  id: SetupRouteActionId,
  label: string,
  description: string,
  mutatesConfig: boolean
): SetupRouteAction {
  return { id, label, description, mutatesConfig };
}

function repairSummary(state: SetupEntryState): string {
  switch (state.kind) {
    case "partial-provider":
      return "Provider configuration is incomplete. Repair provider setup before launch.";
    case "missing-secret":
      return "A configured provider is missing required credentials. Repair secrets before launch.";
    case "broken-config":
      return "Config could not be loaded. Repair config syntax or replace the broken file before launch.";
    case "state-not-writable":
      return "EstaCoda state is not writable. Fix state directory permissions before setup can continue.";
    default:
      return "Setup is incomplete. Repair before launch.";
  }
}
