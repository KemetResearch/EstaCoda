import type { SetupEditorPlanSession, SetupRouteAction, SetupRouteActionId, SetupRouteDecision } from "../setup-router.js";
import { setupCopyText } from "../setup-prompts.js";

export type ConfigEditorRenderedAction = {
  readonly id: SetupRouteActionId;
  readonly label: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly source: "route" | "synthetic";
};

const PR4_ACTION_ORDER: readonly SetupRouteActionId[] = ["verify-setup", "show-diagnostics", "exit"];

export function renderConfigEditor(input: {
  readonly decision: SetupRouteDecision;
  readonly session: SetupEditorPlanSession;
  readonly actions: readonly ConfigEditorRenderedAction[];
}): string {
  const { decision, session } = input;
  const lines = [
    "EstaCoda guided setup editor",
    decision.title,
    decision.summary,
    "",
    "State:",
    `  kind: ${decision.state.kind}`,
    `  route: ${decision.kind}`,
    `  editor mode: ${session.plan.mode}`,
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

  lines.push("", "Sections:");
  for (const section of session.activeSections) {
    lines.push(`  ${section.id} - ${setupCopyText("en", section.copyKey)}`);
    lines.push(`    status: ${section.status}`);
    if (section.blockers.length > 0) {
      lines.push(...section.blockers.map((blocker) => `    blocker: ${blocker}`));
    }
    if (section.warnings.length > 0) {
      lines.push(...section.warnings.map((warning) => `    warning: ${warning}`));
    }
  }

  lines.push("", "Available non-mutating actions:");
  if (input.actions.length === 0) {
    lines.push("  none");
  } else {
    for (const action of input.actions) {
      lines.push(`  ${action.id} - ${action.label}`);
      lines.push(`    ${action.description}`);
    }
  }

  return lines.join("\n");
}

export function renderConfigEditorDiagnostics(decision: SetupRouteDecision): string {
  const lines = [
    "Setup diagnostics",
    `State: ${decision.state.kind}`,
    `Route: ${decision.kind}`,
    `Recommended: ${decision.state.recommendedAction}`,
  ];

  if (decision.blockers.length > 0) {
    lines.push("", "Blockers:", ...decision.blockers.map((blocker) => `- ${blocker}`));
  }

  if (decision.warnings.length > 0) {
    lines.push("", "Warnings:", ...decision.warnings.map((warning) => `- ${warning}`));
  }

  if (decision.state.error !== undefined) {
    lines.push("", `Error: ${decision.state.error}`);
  }

  return lines.join("\n");
}

export function nonMutatingConfigEditorActions(
  decision: SetupRouteDecision,
  _session: SetupEditorPlanSession
): readonly ConfigEditorRenderedAction[] {
  const routeActions = new Map(
    decision.actions
      .filter((action) => !action.mutatesConfig)
      .map((action) => [action.id, action])
  );

  return PR4_ACTION_ORDER.map((id) => {
    const routeAction = routeActions.get(id);
    return routeAction === undefined
      ? syntheticAction(id)
      : renderRouteAction(routeAction);
  });
}

export function isNonMutatingConfigEditorActionId(
  id: string,
  actions: readonly ConfigEditorRenderedAction[]
): id is ConfigEditorRenderedAction["id"] {
  return actions.some((action) => action.id === id);
}

function renderRouteAction(action: SetupRouteAction): ConfigEditorRenderedAction {
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    readOnly: !action.mutatesConfig,
    source: "route",
  };
}

function syntheticAction(id: SetupRouteActionId): ConfigEditorRenderedAction {
  switch (id) {
    case "verify-setup":
      return {
        id,
        label: "Verify setup",
        description: "Run read-only setup verification.",
        readOnly: true,
        source: "synthetic",
      };
    case "show-diagnostics":
      return {
        id,
        label: "Show diagnostics",
        description: "Show structured blockers and warnings without changing config.",
        readOnly: true,
        source: "synthetic",
      };
    case "exit":
      return {
        id,
        label: setupCopyText("en", "setupEditor.actions.cancelSetupEditor"),
        description: "Leave setup without changing config.",
        readOnly: true,
        source: "synthetic",
      };
    default:
      throw new Error(`Cannot synthesize unsupported PR4 setup editor action ${id}.`);
  }
}
