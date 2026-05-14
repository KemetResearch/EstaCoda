import { dirname, join } from "node:path";
import type {
  ProviderId,
  ProviderApiMode,
  CredentialRotationStrategy
} from "../contracts/provider.js";
import {
  mergeConfig,
  normalizeModelFallbacks,
  readConfig,
  saveRuntimeConfig,
  type EstaCodaConfig,
  type ModelFallbackConfig
} from "./runtime-config.js";
import { getDefaultBaseUrl, getDefaultApiKeyEnv } from "../providers/provider-metadata.js";
import { writeEnvSecret } from "./env-secret-store.js";

// ── Input types ──────────────────────────────────────────────────────────────

export type RegisterProviderConfigInput = {
  provider: ProviderId;
  kind?: "openai-compatible" | "catalog";
  baseUrl?: string;
  apiKeyEnv?: string;
  enableNetwork?: boolean;
  headers?: Record<string, string>;
};

export type StoreProviderCredentialInput = {
  provider: ProviderId;
  apiKeyEnv: string;
  apiKey?: string;
  writeCredentialPool?: boolean;
  credentialPoolStrategy?: CredentialRotationStrategy;
};

export type RegisterProviderModelInput = {
  provider: ProviderId;
  models: string[];
};

export type SetPreferredModelRouteInput = {
  provider: ProviderId;
  model: string;
  contextWindowTokens?: number;
};

export type AddFallbackRouteInput = {
  provider: ProviderId;
  id: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  contextWindowTokens?: number;
};

/**
 * Session model overrides are not persistent config writes in PR6.
 * This is a type-only placeholder for future session-scoped route overrides.
 * The apply function is intentionally a no-op for persistent config.
 */
export type SessionModelOverride = {
  provider: ProviderId;
  model: string;
  contextWindowTokens?: number;
  baseUrl?: string;
  apiKeyEnv?: string;
};

// ── Pure config mutators (no I/O) ────────────────────────────────────────────

/**
 * Register or update provider base config without touching model lists,
 * preferred model, or credential pools.
 * Preserves unrelated provider fields unless explicitly changed.
 */
export function applyRegisterProviderConfig(
  existing: EstaCodaConfig,
  input: RegisterProviderConfigInput
): EstaCodaConfig {
  const existingProvider = existing.providers?.[input.provider] ?? {};
  const providerConfig: Record<string, unknown> = { ...existingProvider };

  if (input.kind !== undefined) providerConfig.kind = input.kind;
  if (input.baseUrl !== undefined) {
    providerConfig.baseUrl = input.baseUrl;
  } else if (existingProvider.baseUrl === undefined) {
    providerConfig.baseUrl = getDefaultBaseUrl(input.provider);
  }
  if (input.apiKeyEnv !== undefined) providerConfig.apiKeyEnv = input.apiKeyEnv;
  if (input.enableNetwork !== undefined) providerConfig.enableNetwork = input.enableNetwork;
  if (input.headers !== undefined) providerConfig.headers = input.headers;

  const patch: EstaCodaConfig = {
    providers: {
      [input.provider]: providerConfig as NonNullable<EstaCodaConfig["providers"]>[string]
    }
  };
  return mergeConfig(existing, patch);
}

/**
 * Store a credential reference on the provider block.
 * Optionally writes a credential pool entry if writeCredentialPool is true.
 * Never stores the raw apiKey value in config.
 */
export function applyStoreProviderCredential(
  existing: EstaCodaConfig,
  input: StoreProviderCredentialInput
): { config: EstaCodaConfig; wroteCredentialPool: boolean } {
  const existingProvider = existing.providers?.[input.provider] ?? {};
  const providerConfig = {
    ...existingProvider,
    apiKeyEnv: input.apiKeyEnv
  };

  let wroteCredentialPool = false;
  let credentialPoolsPatch: Record<string, unknown> | undefined;

  if (input.writeCredentialPool) {
    wroteCredentialPool = true;
    credentialPoolsPatch = {
      [input.provider]: {
        strategy: input.credentialPoolStrategy ?? "fill_first",
        entries: [
          {
            id: `${input.provider}-${input.apiKeyEnv}`,
            source: { kind: "env", name: input.apiKeyEnv },
            priority: 1
          }
        ]
      }
    };
  }

  const config = mergeConfig(existing, {
    providers: {
      [input.provider]: providerConfig
    },
    ...(credentialPoolsPatch !== undefined
      ? { credentialPools: credentialPoolsPatch as EstaCodaConfig["credentialPools"] }
      : {})
  } as EstaCodaConfig);

  return { config, wroteCredentialPool };
}

/**
 * Append model(s) to a provider's models array.
 * Does not switch the preferred model.
 * Dedupes model IDs.
 */
export function applyRegisterProviderModel(
  existing: EstaCodaConfig,
  input: RegisterProviderModelInput
): EstaCodaConfig {
  const previousModels = existing.providers?.[input.provider]?.models ?? [];
  const nextModels = uniqueStrings([...previousModels, ...input.models]);
  const existingProvider = existing.providers?.[input.provider] ?? {};

  return mergeConfig(existing, {
    providers: {
      [input.provider]: {
        ...existingProvider,
        models: nextModels
      }
    }
  });
}

/**
 * Set the preferred model route.
 * This switches the primary model.
 */
export function applySetPreferredModelRoute(
  existing: EstaCodaConfig,
  input: SetPreferredModelRouteInput
): EstaCodaConfig {
  const contextWindowPatch =
    input.contextWindowTokens !== undefined
      ? { contextWindowTokens: input.contextWindowTokens }
      : {};

  return mergeConfig(existing, {
    model: {
      provider: input.provider,
      id: input.model,
      ...contextWindowPatch
    }
  });
}

/**
 * Append one fallback route and normalize.
 * Preserves fallback order and dedupes against primary / duplicates.
 */
export function applyAddFallbackRoute(
  existing: EstaCodaConfig,
  input: AddFallbackRouteInput
): EstaCodaConfig {
  const existingFallbacks = existing.model?.fallbacks ?? [];
  const newFallback: ModelFallbackConfig = {
    provider: input.provider,
    id: input.id,
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.apiKeyEnv !== undefined ? { apiKeyEnv: input.apiKeyEnv } : {}),
    ...(input.contextWindowTokens !== undefined
      ? { contextWindowTokens: input.contextWindowTokens }
      : {})
  };

  const merged = mergeConfig(existing, {
    model: {
      fallbacks: [...existingFallbacks, newFallback]
    }
  });

  const normalized = normalizeModelFallbacks(merged);
  return {
    ...merged,
    model: {
      ...merged.model,
      fallbacks: normalized.fallbacks
    }
  };
}

/**
 * Intentionally a no-op for persistent config.
 * Session overrides will be stored in session metadata, not config JSON.
 */
export function applySessionModelOverride(
  existing: EstaCodaConfig,
  _input: SessionModelOverride
): EstaCodaConfig {
  return existing;
}

// ── Load/save wrappers ───────────────────────────────────────────────────────

export type MutationOptions = {
  workspaceRoot: string;
  homeDir?: string;
  userConfigPath?: string;
  projectConfigPath?: string;
  scope?: "user" | "project";
};

async function resolveTargetPath(options: MutationOptions): Promise<string> {
  return options.scope === "project"
    ? options.projectConfigPath ?? join(options.workspaceRoot, ".estacoda", "config.json")
    : options.userConfigPath ?? join(options.homeDir ?? process.env.HOME ?? "", ".estacoda", "config.json");
}

export async function registerProviderConfig(
  options: MutationOptions & { input: RegisterProviderConfigInput }
): Promise<{ path: string; config: EstaCodaConfig }> {
  const targetPath = await resolveTargetPath(options);
  const existing = await readConfig(targetPath);
  const config = applyRegisterProviderConfig(existing.config, options.input);
  await saveRuntimeConfig(targetPath, config);
  return { path: targetPath, config };
}

export async function storeProviderCredential(
  options: MutationOptions & { input: StoreProviderCredentialInput }
): Promise<{ path: string; config: EstaCodaConfig; wroteCredentialPool: boolean }> {
  const targetPath = await resolveTargetPath(options);
  const existing = await readConfig(targetPath);
  const { config, wroteCredentialPool } = applyStoreProviderCredential(existing.config, options.input);
  await saveRuntimeConfig(targetPath, config);
  return { path: targetPath, config, wroteCredentialPool };
}

export async function registerProviderModel(
  options: MutationOptions & { input: RegisterProviderModelInput }
): Promise<{ path: string; config: EstaCodaConfig }> {
  const targetPath = await resolveTargetPath(options);
  const existing = await readConfig(targetPath);
  const config = applyRegisterProviderModel(existing.config, options.input);
  await saveRuntimeConfig(targetPath, config);
  return { path: targetPath, config };
}

export async function setPreferredModelRoute(
  options: MutationOptions & { input: SetPreferredModelRouteInput }
): Promise<{ path: string; config: EstaCodaConfig }> {
  const targetPath = await resolveTargetPath(options);
  const existing = await readConfig(targetPath);
  const config = applySetPreferredModelRoute(existing.config, options.input);
  await saveRuntimeConfig(targetPath, config);
  return { path: targetPath, config };
}

export async function addFallbackRoute(
  options: MutationOptions & { input: AddFallbackRouteInput }
): Promise<{ path: string; config: EstaCodaConfig }> {
  const targetPath = await resolveTargetPath(options);
  const existing = await readConfig(targetPath);
  const config = applyAddFallbackRoute(existing.config, options.input);
  await saveRuntimeConfig(targetPath, config);
  return { path: targetPath, config };
}

export async function setSessionModelOverride(
  options: MutationOptions & { input: SessionModelOverride }
): Promise<{ path: string; config: EstaCodaConfig }> {
  const targetPath = await resolveTargetPath(options);
  const existing = await readConfig(targetPath);
  const config = applySessionModelOverride(existing.config, options.input);
  await saveRuntimeConfig(targetPath, config);
  return { path: targetPath, config };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}
