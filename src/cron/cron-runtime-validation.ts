import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import type { ResolvedModelRoute } from "../contracts/provider.js";
import type { SessionModelOverride } from "../contracts/session.js";
import type { ToolDefinition, ToolsetName } from "../contracts/tool.js";
import { resolveModelSwitchRequest } from "../providers/model-switch-resolver.js";
import type { CronJob } from "./cron-store.js";

export const CRON_FORCED_DISABLED_TOOLSETS = ["cron", "messaging", "clarify"] as const;

export type CronRuntimeControls = {
  modelOverride?: {
    provider?: string;
    model: string;
  };
  enabledToolsets?: string[];
};

export async function validateCronRuntimeControls(input: {
  modelOverride?: CronRuntimeControls["modelOverride"];
  enabledToolsets?: string[];
  config: LoadedRuntimeConfig;
  availableToolsets: readonly string[] | (() => readonly string[]);
}): Promise<{
  ok: true;
  normalized: CronRuntimeControls;
} | {
  ok: false;
  message: string;
}> {
  const normalized: CronRuntimeControls = {};

  if (input.modelOverride !== undefined) {
    const model = input.modelOverride.model.trim();
    const provider = input.modelOverride.provider?.trim() || input.config.primaryModelRoute.provider;
    if (model.length === 0) {
      return { ok: false, message: "Cron model override requires a model." };
    }
    const resolved = await resolveModelSwitchRequest({
      modelInput: `${provider}/${model}`,
      source: "cli"
    }, {
      config: input.config.config,
      providerRegistry: input.config.providerRegistry
    });
    if (!resolved.ok) {
      return { ok: false, message: `Invalid cron model override: ${resolved.message}` };
    }
    normalized.modelOverride = {
      provider: resolved.route.provider,
      model: resolved.route.id
    };
  }

  if (input.enabledToolsets !== undefined) {
    const toolsets = normalizeToolsets(input.enabledToolsets);
    const availableToolsets = typeof input.availableToolsets === "function"
      ? input.availableToolsets()
      : input.availableToolsets;
    const available = new Set(availableToolsets);
    for (const toolset of toolsets) {
      if ((CRON_FORCED_DISABLED_TOOLSETS as readonly string[]).includes(toolset)) {
        return { ok: false, message: `Cron jobs cannot enable the ${toolset} toolset.` };
      }
      if (!available.has(toolset)) {
        return { ok: false, message: `Unknown cron toolset: ${toolset}. Available toolsets: ${[...available].sort().join(", ")}` };
      }
    }
    normalized.enabledToolsets = toolsets;
  }

  return { ok: true, normalized };
}

export async function resolveCronModelRoute(input: {
  job: CronJob;
  latestConfig: LoadedRuntimeConfig;
}): Promise<ResolvedModelRoute | undefined> {
  if (input.job.modelOverride === undefined) {
    return input.latestConfig.primaryModelRoute;
  }
  const sessionOverride = await cronModelOverrideToSessionOverride(input.job.modelOverride, input.latestConfig);
  const resolved = await resolveModelSwitchRequest({
    modelInput: `${sessionOverride.route.provider}/${sessionOverride.route.id}`,
    source: "cli"
  }, {
    config: input.latestConfig.config,
    providerRegistry: input.latestConfig.providerRegistry
  });
  if (!resolved.ok) {
    throw new Error(`Invalid cron model override: ${resolved.message}`);
  }
  return resolved.route;
}

export function cronEnabledToolsetsToDisabled(input: {
  enabledToolsets?: string[];
  availableToolsets: readonly string[];
}): ToolsetName[] {
  const disabled = new Set<string>(CRON_FORCED_DISABLED_TOOLSETS);
  if (input.enabledToolsets === undefined) {
    return [...disabled] as ToolsetName[];
  }
  const allowed = new Set(normalizeToolsets(input.enabledToolsets));
  for (const toolset of input.availableToolsets) {
    if (!allowed.has(toolset)) {
      disabled.add(toolset);
    }
  }
  return [...disabled] as ToolsetName[];
}

export function availableToolsetsFromTools(tools: readonly ToolDefinition[]): string[] {
  return [...new Set(tools.flatMap((tool) => tool.toolsets))].sort();
}

function normalizeToolsets(toolsets: string[]): string[] {
  return [...new Set(toolsets.map((toolset) => toolset.trim()).filter((toolset) => toolset.length > 0))];
}

async function cronModelOverrideToSessionOverride(
  override: NonNullable<CronJob["modelOverride"]>,
  config: LoadedRuntimeConfig
): Promise<SessionModelOverride> {
  const provider = override.provider ?? config.primaryModelRoute.provider;
  return {
    route: {
      provider,
      id: override.model
    },
    modelProfile: config.primaryModelRoute.profile,
    setAt: new Date(0).toISOString(),
    source: "cli"
  };
}
