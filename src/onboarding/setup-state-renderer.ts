import type { SetupRouteDecision } from "./setup-router.js";
import { setupCopyText } from "./setup-prompts.js";

export function renderSetupRouteSummary(input: {
  readonly decision: SetupRouteDecision;
  readonly advanced?: boolean;
}): string {
  const { decision } = input;
  const lines = [
    input.advanced === true
      ? setupCopyText("en", "setupStateSummary.advancedTitle")
      : setupCopyText("en", "setupStateSummary.title"),
    decision.title,
    decision.summary,
    "",
    "State:",
    `  kind: ${decision.state.kind}`,
    `  recommended: ${decision.state.recommendedAction}`,
  ];

  if (decision.state.model !== undefined) {
    lines.push(`  model: ${decision.state.model.provider}/${decision.state.model.id}`);
  }

  if (decision.blockers.length > 0) {
    lines.push("", "Blockers:", ...decision.blockers.map((blocker) => `  - ${blocker}`));
  }

  if (decision.warnings.length > 0) {
    lines.push("", "Warnings:", ...decision.warnings.map((warning) => `  - ${warning}`));
  }

  lines.push(
    "",
    "Recommended path:",
    `  ${recommendedCommand(decision)}`,
    "",
    "Available actions:",
    ...decision.actions.map((action) => `  ${action.id} - ${action.label}`),
    "",
    "Advanced path:",
    "  estacoda setup --advanced --provider deepseek --model deepseek-chat --api-key-env DEEPSEEK_API_KEY",
    "",
    setupCopyText("en", "setupStateSummary.directProviderExample"),
    "",
    "After setup:",
    "  estacoda verify",
    "  estacoda"
  );

  return lines.join("\n");
}

function recommendedCommand(decision: SetupRouteDecision): string {
  switch (decision.state.kind) {
    case "configured-ready":
      return "estacoda";
    case "configured-degraded":
    case "untrusted-workspace":
    case "new-user":
    case "partial-provider":
    case "missing-secret":
    case "broken-config":
    case "state-not-writable":
      return "estacoda setup --interactive";
  }

  switch (decision.kind) {
    case "configured-degraded-menu":
    case "first-run-onboarding":
    case "repair-first-menu":
    case "configured-menu":
      return "estacoda setup --interactive";
    case "verify-readonly":
      return "estacoda verify";
  }
}
