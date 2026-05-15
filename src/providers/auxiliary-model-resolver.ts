import type {
  AuxiliaryModelConfig,
  AuxiliaryModelSlotConfig,
  AuxiliaryModelTask,
  ModelProfile,
  ProviderId,
  ProviderRoutePreferences,
  ResolvedAuxiliaryRoute,
  ResolvedModelRoute
} from "../contracts/provider.js";
import { ProviderRegistry } from "./provider-registry.js";
import { routeProvider } from "./provider-router.js";
import { inferModelProfile, resolveModelProfileFromCatalog } from "./model-catalog.js";

const taskCapabilityRequirements: Record<AuxiliaryModelTask, ProviderRoutePreferences> = {
  vision: { requireVision: true },
  compression: { requireStructuredOutput: true },
  approval: { requireStructuredOutput: true },
  web_extract: { requireStructuredOutput: true },
  session_search: { requireStructuredOutput: true },
  mcp: { requireTools: true, requireStructuredOutput: true },
  memory_flush: { requireStructuredOutput: true },
  delegation: { requireTools: true },
  skills_library: { requireTools: true, requireStructuredOutput: true },
  title_generation: { requireStructuredOutput: true },
  curator: { requireStructuredOutput: true },
  memory_compaction: { requireStructuredOutput: true }
};

const textOnlyStructuredTasks: ReadonlySet<AuxiliaryModelTask> = new Set([
  "compression",
  "approval",
  "title_generation",
  "curator",
  "memory_flush",
  "memory_compaction"
]);

const toolReasoningTasks: ReadonlySet<AuxiliaryModelTask> = new Set([
  "mcp",
  "skills_library",
  "delegation"
]);

export function resolveAuxiliaryModelRoute(
  task: AuxiliaryModelTask,
  slot: AuxiliaryModelSlotConfig,
  context: {
    mainRoute: ResolvedModelRoute;
    providerRegistry: ProviderRegistry;
    providerModels?: ModelProfile[];
  }
): ResolvedAuxiliaryRoute {
  const diagnostics: string[] = [];
  const requirements = taskCapabilityRequirements[task];

  // 1. Disabled
  if (slot.enabled === false) {
    return {
      task,
      route: undefined,
      source: "disabled",
      fallbackToMain: false,
      diagnostics: ["Slot is explicitly disabled"]
    };
  }

  // 2. Custom baseUrl
  if (slot.baseUrl !== undefined) {
    if (slot.id === undefined || slot.id.length === 0) {
      diagnostics.push("slot.baseUrl is set but slot.id is missing; custom routes require both baseUrl and id");
      return {
        task,
        route: undefined,
        source: "custom",
        fallbackToMain: false,
        diagnostics
      };
    }

    const profile = inferModelProfile({ provider: "openai-compatible", model: slot.id });
    const route: ResolvedModelRoute = {
      provider: "openai-compatible",
      id: slot.id,
      profile,
      baseUrl: slot.baseUrl,
      apiKeyEnv: slot.apiKeyEnv,
      contextWindowTokens: slot.contextWindowTokens
    };

    return {
      task,
      route,
      source: "custom",
      fallbackToMain: slot.fallbackToMain ?? false,
      diagnostics: [`Custom OpenAI-compatible route at ${slot.baseUrl}`]
    };
  }

  // 3. Main provider
  if (slot.provider === "main") {
    return {
      task,
      route: context.mainRoute,
      source: "main",
      fallbackToMain: false,
      diagnostics: ["Using main model route"]
    };
  }

  // 4-5. Explicit provider
  if (slot.provider !== undefined && slot.provider !== "auto") {
    const explicitProvider = slot.provider as ProviderId;
    const models = context.providerModels ?? [];

    if (slot.id !== undefined && slot.id.length > 0) {
      // Exact provider+id
      const profile = models.find((m) => m.provider === explicitProvider && m.id === slot.id)
        ?? inferModelProfile({ provider: explicitProvider, model: slot.id });

      const route: ResolvedModelRoute = {
        provider: explicitProvider,
        id: slot.id,
        profile,
        apiKeyEnv: slot.apiKeyEnv,
        contextWindowTokens: slot.contextWindowTokens
      };

      return {
        task,
        route,
        source: "explicit",
        fallbackToMain: slot.fallbackToMain ?? false,
        diagnostics: [`Explicit route ${explicitProvider}/${slot.id}`]
      };
    }

    // Best model on explicit provider
    const providerModels = models.filter((m) => m.provider === explicitProvider);
    const chosen = routeProvider(providerModels, requirements);

    if (chosen === undefined) {
      diagnostics.push(`No model on provider ${explicitProvider} matches task requirements`);
      return {
        task,
        route: undefined,
        source: "explicit",
        fallbackToMain: computeFallbackToMain({ task, slot, mainRoute: context.mainRoute, source: "explicit" }),
        diagnostics
      };
    }

    const route: ResolvedModelRoute = {
      provider: explicitProvider,
      id: chosen.primary.id,
      profile: chosen.primary,
      apiKeyEnv: slot.apiKeyEnv,
      contextWindowTokens: slot.contextWindowTokens
    };

    return {
      task,
      route,
      source: "explicit",
      fallbackToMain: slot.fallbackToMain ?? false,
      diagnostics: [`Best model on ${explicitProvider}: ${chosen.primary.id}`]
    };
  }

  // 6. Auto (slot.provider is "auto" or undefined)
  const mainSatisfies = matchesPreferences(context.mainRoute.profile, requirements);
  if (mainSatisfies) {
    return {
      task,
      route: context.mainRoute,
      source: "auto-main",
      fallbackToMain: computeFallbackToMain({ task, slot, mainRoute: context.mainRoute, source: "auto-main" }),
      diagnostics: ["Main model satisfies task requirements"]
    };
  }

  const models = context.providerModels ?? [];
  const chosen = routeProvider(models, requirements);

  if (chosen === undefined) {
    diagnostics.push("No configured model matches task requirements; main model also unsuitable");
    return {
      task,
      route: undefined,
      source: "auto-configured",
      fallbackToMain: computeFallbackToMain({ task, slot, mainRoute: context.mainRoute, source: "auto-configured" }),
      diagnostics
    };
  }

  const route: ResolvedModelRoute = {
    provider: chosen.primary.provider,
    id: chosen.primary.id,
    profile: chosen.primary,
    apiKeyEnv: slot.apiKeyEnv,
    contextWindowTokens: slot.contextWindowTokens
  };

  return {
    task,
    route,
    source: "auto-configured",
    fallbackToMain: computeFallbackToMain({ task, slot, mainRoute: context.mainRoute, source: "auto-configured" }),
    diagnostics: [`Auto-selected ${chosen.primary.provider}/${chosen.primary.id}`]
  };
}

function matchesPreferences(model: ModelProfile, preferences: ProviderRoutePreferences): boolean {
  if (preferences.requireTools === true && !model.supportsTools) return false;
  if (preferences.requireVision === true && !model.supportsVision) return false;
  if (preferences.requireStructuredOutput === true && !model.supportsStructuredOutput) return false;
  if (preferences.requireReasoning === true && model.supportsReasoning !== true) return false;
  return true;
}

function computeFallbackToMain(options: {
  task: AuxiliaryModelTask;
  slot: AuxiliaryModelSlotConfig;
  mainRoute: ResolvedModelRoute;
  source: ResolvedAuxiliaryRoute["source"];
}): boolean {
  if (options.slot.fallbackToMain !== undefined) {
    return options.slot.fallbackToMain;
  }

  if (options.source === "explicit" || options.source === "custom") {
    return false;
  }

  if (options.task === "vision") {
    return options.mainRoute.profile.supportsVision;
  }

  if (toolReasoningTasks.has(options.task)) {
    return options.mainRoute.profile.supportsTools;
  }

  if (textOnlyStructuredTasks.has(options.task)) {
    return true;
  }

  // Default: web_extract, session_search, memory_flush, title_generation, curator, memory_compaction, compression, approval
  return true;
}

export async function resolveAllAuxiliaryRoutes(
  config: AuxiliaryModelConfig,
  context: {
    mainRoute: ResolvedModelRoute;
    providerRegistry: ProviderRegistry;
  }
): Promise<ResolvedAuxiliaryRoute[]> {
  const providerModels = await context.providerRegistry.listModels();
  const tasks = Object.keys(config) as AuxiliaryModelTask[];
  return tasks.map((task) =>
    resolveAuxiliaryModelRoute(task, config[task] ?? { provider: "auto", enabled: true }, {
      mainRoute: context.mainRoute,
      providerRegistry: context.providerRegistry,
      providerModels
    })
  );
}
