import type {
  AuxiliaryProviderConfig,
  AuxiliaryProviderRoute,
  AuxiliaryProviderTask,
  ModelProfile,
  ProviderId,
  ProviderRoutePreferences
} from "../contracts/provider.js";
import { routeProvider } from "./provider-router.js";

export const auxiliaryProviderTasks: readonly AuxiliaryProviderTask[] = [
  "main",
  "vision",
  "compression",
  "approval",
  "web_extract",
  "session_search",
  "skills_hub",
  "mcp",
  "memory_flush",
  "delegation"
];

export const defaultAuxiliaryProviderPreferences: Record<AuxiliaryProviderTask, ProviderRoutePreferences> = {
  main: {
    requireTools: true
  },
  vision: {
    requireVision: true
  },
  compression: {
    requireStructuredOutput: true
  },
  approval: {
    requireStructuredOutput: true
  },
  web_extract: {
    requireStructuredOutput: true
  },
  session_search: {
    requireStructuredOutput: true
  },
  skills_hub: {
    requireTools: true,
    requireStructuredOutput: true
  },
  mcp: {
    requireTools: true,
    requireStructuredOutput: true
  },
  memory_flush: {
    requireStructuredOutput: true
  },
  delegation: {
    requireTools: true
  }
};

const defaultTextProviderOrder: ProviderId[] = [
  "openrouter",
  "nous",
  "anthropic",
  "kimi",
  "deepseek",
  "google",
  "openai",
  "local"
];

const defaultVisionProviderOrder: ProviderId[] = [
  "openrouter",
  "anthropic",
  "google",
  "openai",
  "kimi",
  "local"
];

const defaultStructuredProviderOrder: ProviderId[] = [
  "openrouter",
  "google",
  "openai",
  "anthropic",
  "kimi",
  "deepseek",
  "local"
];

export class AuxiliaryProviderRouter {
  readonly #models: ModelProfile[];
  readonly #config: AuxiliaryProviderConfig;
  readonly #primaryProvider: ProviderId | undefined;

  constructor(options: {
    models: ModelProfile[];
    config?: AuxiliaryProviderConfig;
    primaryProvider?: ProviderId;
  }) {
    this.#models = options.models;
    this.#config = options.config ?? {};
    this.#primaryProvider = options.primaryProvider;
  }

  resolve(task: AuxiliaryProviderTask): AuxiliaryProviderRoute {
    const preferences = resolveAuxiliaryPreferences({
      task,
      override: this.#config[task],
      primaryProvider: this.#primaryProvider
    });

    return {
      task,
      preferences,
      route: routeProvider(this.#models, preferences)
    };
  }

  resolveAll(): AuxiliaryProviderRoute[] {
    return auxiliaryProviderTasks.map((task) => this.resolve(task));
  }
}

export function summarizeAuxiliaryRoutes(routes: AuxiliaryProviderRoute[]): string {
  return routes
    .map((route) =>
      `${route.task}:${route.route === undefined ? "unavailable" : `${route.route.primary.provider}/${route.route.primary.id}`}`
    )
    .join(", ");
}

function resolveAuxiliaryPreferences(options: {
  task: AuxiliaryProviderTask;
  override: ProviderRoutePreferences | undefined;
  primaryProvider?: ProviderId;
}): ProviderRoutePreferences {
  const defaults = defaultAuxiliaryProviderPreferences[options.task];

  return {
    ...defaults,
    ...(options.override ?? {}),
    providerOrder: buildProviderOrder({
      primaryProvider: options.primaryProvider,
      configuredOrder: options.override?.providerOrder ?? defaults.providerOrder,
      defaultOrder: defaultProviderOrderForTask(options.task)
    }),
    providerAllowlist: options.override?.providerAllowlist ?? defaults.providerAllowlist,
    providerBlocklist: options.override?.providerBlocklist ?? defaults.providerBlocklist
  };
}

function defaultProviderOrderForTask(task: AuxiliaryProviderTask): ProviderId[] {
  switch (task) {
    case "vision":
      return defaultVisionProviderOrder;
    case "compression":
    case "approval":
    case "web_extract":
    case "session_search":
    case "skills_hub":
    case "mcp":
    case "memory_flush":
      return defaultStructuredProviderOrder;
    case "main":
    case "delegation":
    default:
      return defaultTextProviderOrder;
  }
}

function buildProviderOrder(options: {
  primaryProvider?: ProviderId;
  configuredOrder?: ProviderId[];
  defaultOrder: ProviderId[];
}): ProviderId[] {
  return uniqueProviders([
    ...(options.primaryProvider === undefined ? [] : [options.primaryProvider]),
    ...(options.configuredOrder ?? []),
    ...options.defaultOrder
  ]);
}

function uniqueProviders(providers: ProviderId[]): ProviderId[] {
  return providers.filter((provider, index) => providers.indexOf(provider) === index);
}
