export const GHOST_TEXT_ENV_VAR = "ESTACODA_GHOST_TEXT";

export type GhostTextMode = "off" | "on";

export type ResolveGhostTextModeOptions = {
  readonly env?: Record<string, string | undefined>;
};

export function parseGhostTextMode(value: string | undefined): GhostTextMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "on") return "on";
  return "off";
}

export function resolveGhostTextMode(options?: ResolveGhostTextModeOptions): GhostTextMode {
  const env = options?.env ?? process.env;
  return parseGhostTextMode(env[GHOST_TEXT_ENV_VAR]);
}
