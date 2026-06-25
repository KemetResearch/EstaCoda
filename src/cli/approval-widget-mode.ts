export const APPROVAL_WIDGET_MODE_ENV_VAR = "ESTACODA_APPROVAL_WIDGETS";

export const APPROVAL_WIDGET_MODES = ["legacy", "papyrus"] as const;

export type ApprovalWidgetMode = typeof APPROVAL_WIDGET_MODES[number];

export type ResolveApprovalWidgetModeOptions = {
  env?: Record<string, string | undefined>;
  defaultMode?: ApprovalWidgetMode;
};

export type ResolveCoreSessionApprovalWidgetModeOptions = Omit<ResolveApprovalWidgetModeOptions, "defaultMode"> & {
  inputMode: "readline" | "raw";
  rendererMode: "legacy" | "papyrus";
};

export function parseApprovalWidgetMode(
  value: string | undefined,
  defaultMode: ApprovalWidgetMode = "legacy"
): ApprovalWidgetMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "legacy") return "legacy";
  if (normalized === "papyrus") return "papyrus";
  return defaultMode;
}

export function resolveApprovalWidgetMode(options?: ResolveApprovalWidgetModeOptions): ApprovalWidgetMode {
  const env = options?.env ?? process.env;
  return parseApprovalWidgetMode(env[APPROVAL_WIDGET_MODE_ENV_VAR], options?.defaultMode);
}

export function resolveCoreSessionApprovalWidgetMode(
  options: ResolveCoreSessionApprovalWidgetModeOptions
): ApprovalWidgetMode {
  return resolveApprovalWidgetMode({
    env: options.env,
    defaultMode: options.inputMode === "raw" && options.rendererMode === "papyrus" ? "papyrus" : "legacy",
  });
}
