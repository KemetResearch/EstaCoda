export const APPROVAL_WIDGET_MODE_ENV_VAR = "ESTACODA_APPROVAL_WIDGETS";

export const APPROVAL_WIDGET_MODES = ["legacy", "papyrus"] as const;

export type ApprovalWidgetMode = typeof APPROVAL_WIDGET_MODES[number];

export type ResolveApprovalWidgetModeOptions = {
  env?: Record<string, string | undefined>;
};

export function parseApprovalWidgetMode(value: string | undefined): ApprovalWidgetMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "papyrus") return "papyrus";
  return "legacy";
}

export function resolveApprovalWidgetMode(options?: ResolveApprovalWidgetModeOptions): ApprovalWidgetMode {
  const env = options?.env ?? process.env;
  return parseApprovalWidgetMode(env[APPROVAL_WIDGET_MODE_ENV_VAR]);
}
