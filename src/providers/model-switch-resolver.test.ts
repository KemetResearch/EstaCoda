import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EstaCodaConfig } from "../config/runtime-config.js";
import type { ProviderAdapter, ProviderId } from "../contracts/provider.js";
import type { SessionModelOverride } from "../contracts/session.js";
import { ProviderRegistry } from "./provider-registry.js";
import {
  applyModelSwitchPrimaryRoute,
  resolveEffectiveSessionModelOverride,
  resolveModelSwitchRequest,
  sessionOverrideToResolvedRoute
} from "./model-switch-resolver.js";

function adapter(id: ProviderId, options: { readonly executable?: boolean } = {}): ProviderAdapter {
  return {
    id,
    name: id,
    executable: options.executable ?? true,
    health: () => ({ available: true }),
    listModels: async () => [],
    complete: async () => ({ ok: true, content: "", provider: id, model: "" })
  };
}

function override(provider: ProviderId, id: string, route?: Partial<SessionModelOverride["route"]>): SessionModelOverride {
  return {
    route: {
      provider,
      id,
      baseUrl: "https://custom.example/v1",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      apiMode: "custom_openai_compatible",
      authMethod: "api_key",
      contextWindowTokens: 32000,
      ...route
    },
    modelProfile: {
      id,
      provider,
      contextWindowTokens: 32000,
      supportsTools: true,
      supportsVision: false,
      supportsStructuredOutput: true
    },
    setAt: "2026-01-01T00:00:00.000Z",
    source: "gateway"
  };
}

describe("model-switch-resolver stored override revalidation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DEEPSEEK_API_KEY: "secret-deepseek-value",
      OPENAI_API_KEY: "secret-openai-value",
      OPENAI_COMPATIBLE_API_KEY: "secret-test-value"
    };
    delete process.env.DEEPSEEK_MISSING_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("treats a removed custom provider as stale instead of resurrecting stored route metadata", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("custom-ai"));

    const result = await resolveEffectiveSessionModelOverride(
      override("custom-ai", "super-model"),
      {
        config: { providers: {}, model: { provider: "local", id: "qwen2.5:3b" } },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      message: "Stored model override is no longer present in the active provider config."
    });
  });

  it("treats a removed provider as stale even when the referenced env var is still present", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("openai"));

    const result = await resolveEffectiveSessionModelOverride(
      override("openai", "gpt-4o", {
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        apiMode: "openai_chat_completions"
      }),
      {
        config: { providers: {}, model: { provider: "local", id: "qwen2.5:3b" } },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(false);
  });

  it("keeps a catalog-known DeepSeek chat override when provider config exists without static models", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek"));
    const config: EstaCodaConfig = {
      model: { provider: "kimi", id: "kimi-k2.6" },
      providers: {
        deepseek: {
          kind: "openai-compatible",
          enableNetwork: true,
          apiKeyEnv: "DEEPSEEK_API_KEY",
          models: []
        },
        kimi: {
          kind: "openai-compatible",
          apiKeyEnv: "KIMI_API_KEY",
          models: ["kimi-k2.6"]
        }
      }
    };

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "deepseek-chat", {
        baseUrl: undefined,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key",
        contextWindowTokens: 64000
      }),
      { config, providerRegistry: registry }
    );

    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    expect(result.route.provider).toBe("deepseek");
    expect(result.route.id).toBe("deepseek-chat");
    expect(result.route.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(result.route.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
  });

  it("keeps a catalog-known DeepSeek reasoner override when provider config exists without static models", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek"));
    const config: EstaCodaConfig = {
      providers: {
        deepseek: {
          kind: "openai-compatible",
          enableNetwork: true,
          apiKeyEnv: "DEEPSEEK_API_KEY",
          models: []
        }
      }
    };

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "deepseek-reasoner", {
        baseUrl: undefined,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key",
        contextWindowTokens: 64000
      }),
      { config, providerRegistry: registry }
    );

    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    expect(result.route.provider).toBe("deepseek");
    expect(result.route.id).toBe("deepseek-reasoner");
    expect(result.route.baseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("rejects a catalog-known override when the provider adapter is not executable", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek", { executable: false }));

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "deepseek-chat", {
        baseUrl: undefined,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key"
      }),
      {
        config: {
          providers: {
            deepseek: {
              kind: "openai-compatible",
              enableNetwork: true,
              apiKeyEnv: "DEEPSEEK_API_KEY",
              models: []
            }
          }
        },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      message: "Provider deepseek is not executable."
    });
  });

  it("rejects a catalog-known override when hosted provider network execution is disabled", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek"));

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "deepseek-chat", {
        baseUrl: undefined,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key"
      }),
      {
        config: {
          providers: {
            deepseek: {
              kind: "openai-compatible",
              enableNetwork: false,
              apiKeyEnv: "DEEPSEEK_API_KEY",
              models: []
            }
          }
        },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      message: "Provider deepseek network inference is not enabled."
    });
  });

  it("rejects a catalog-known override when credentials are missing", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek"));

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "deepseek-chat", {
        baseUrl: undefined,
        apiKeyEnv: "DEEPSEEK_MISSING_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key"
      }),
      {
        config: {
          providers: {
            deepseek: {
              kind: "openai-compatible",
              enableNetwork: true,
              apiKeyEnv: "DEEPSEEK_MISSING_API_KEY",
              models: []
            }
          }
        },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      message: "Credentials are not configured for deepseek/deepseek-chat."
    });
  });

  it("rejects unknown non-catalog overrides when the model is not listed in provider config", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek"));

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "not-a-catalog-model", {
        baseUrl: undefined,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key"
      }),
      {
        config: {
          providers: {
            deepseek: {
              kind: "openai-compatible",
              enableNetwork: true,
              apiKeyEnv: "DEEPSEEK_API_KEY",
              models: []
            }
          }
        },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      message: "Stored model override is no longer present in the active provider config."
    });
  });

  it("keeps a stored override when the model is explicitly listed in provider config", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek"));

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "manual-deepseek-model", {
        baseUrl: undefined,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key"
      }),
      {
        config: {
          providers: {
            deepseek: {
              kind: "openai-compatible",
              enableNetwork: true,
              apiKeyEnv: "DEEPSEEK_API_KEY",
              models: ["manual-deepseek-model"]
            }
          }
        },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    expect(result.route.provider).toBe("deepseek");
    expect(result.route.id).toBe("manual-deepseek-model");
  });

  it("keeps a stored override when it matches the primary model", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek"));

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "primary-deepseek-model", {
        baseUrl: undefined,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key"
      }),
      {
        config: {
          model: { provider: "deepseek", id: "primary-deepseek-model" },
          providers: {
            deepseek: {
              kind: "openai-compatible",
              enableNetwork: true,
              apiKeyEnv: "DEEPSEEK_API_KEY",
              models: []
            }
          }
        },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    expect(result.route.id).toBe("primary-deepseek-model");
  });

  it("keeps a stored override when it matches a fallback model", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("deepseek"));

    const result = await resolveEffectiveSessionModelOverride(
      override("deepseek", "fallback-deepseek-model", {
        baseUrl: "https://fallback.deepseek.example/v1",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiMode: "openai_chat_completions",
        authMethod: "api_key"
      }),
      {
        config: {
          model: {
            provider: "kimi",
            id: "kimi-k2.6",
            fallbacks: [{
              provider: "deepseek",
              id: "fallback-deepseek-model",
              baseUrl: "https://fallback.deepseek.example/v1",
              apiKeyEnv: "DEEPSEEK_API_KEY"
            }]
          },
          providers: {
            deepseek: {
              kind: "openai-compatible",
              enableNetwork: true,
              apiKeyEnv: "DEEPSEEK_API_KEY",
              models: []
            }
          }
        },
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    expect(result.route.id).toBe("fallback-deepseek-model");
    expect(result.route.baseUrl).toBe("https://fallback.deepseek.example/v1");
  });

  it("preserves valid alias metadata without resurrecting removed config-only routes", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("custom-ai"));
    const config: EstaCodaConfig = {
      modelAliases: {
        fast: {
          provider: "custom-ai",
          model: "super-model",
          baseUrl: "https://custom.example/v1",
          apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
          apiMode: "custom_openai_compatible",
          maxTokens: 4096
        }
      }
    };

    const result = await resolveEffectiveSessionModelOverride(
      override("custom-ai", "super-model"),
      {
        config,
        providerRegistry: registry
      }
    );

    expect(result?.ok).toBe(true);
    if (result?.ok === true) {
      expect(result.route.baseUrl).toBe("https://custom.example/v1");
      expect(result.route.apiKeyEnv).toBe("OPENAI_COMPATIBLE_API_KEY");
      expect(result.route.apiMode).toBe("custom_openai_compatible");
      expect(result.route.authMethod).toBe("api_key");
      expect(result.route.maxTokens).toBe(4096);
    }
  });

  it("preserves maxTokens when reconstructing a stored override route", () => {
    const route = sessionOverrideToResolvedRoute(
      override("custom-ai", "super-model", { maxTokens: 8192 })
    );

    expect(route.maxTokens).toBe(8192);
  });

  it("stores alias maxTokens in /model switch overrides", async () => {
    const registry = new ProviderRegistry();
    registry.register(adapter("local"));
    const config: EstaCodaConfig = {
      providers: {
        local: {
          baseUrl: "http://localhost:11434/v1",
          apiMode: "custom_openai_compatible",
          authMethod: "none",
          models: ["phi4:latest"]
        }
      },
      modelAliases: {
        fast: {
          provider: "local",
          model: "phi4:latest",
          baseUrl: "http://localhost:11434/v1",
          apiMode: "custom_openai_compatible",
          maxTokens: 8192
        }
      }
    };

    const result = await resolveModelSwitchRequest(
      { modelInput: "fast", source: "cli", now: () => new Date("2026-01-02T00:00:00.000Z") },
      { config, providerRegistry: registry }
    );

    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.route.maxTokens).toBe(8192);
    expect(result.override.route.maxTokens).toBe(8192);
  });

  it("preserves maxTokens when applying a switched route to primary config", () => {
    const mutated = applyModelSwitchPrimaryRoute(
      {},
      sessionOverrideToResolvedRoute(override("local", "phi4:latest", { maxTokens: 4096 }))
    );

    expect(mutated.model?.maxTokens).toBe(4096);
  });
});
