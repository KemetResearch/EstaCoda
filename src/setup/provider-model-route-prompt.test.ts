import { describe, expect, it } from "vitest";
import type { SelectPromptInput } from "../cli/interactive-select.js";
import type { Prompt } from "../cli/readline-prompt.js";
import type { ProviderId, ProviderApiMode, ProviderAuthMethod } from "../contracts/provider.js";
import type {
  FlowEngine,
  ModelCandidate,
  ProviderCandidate,
  ProviderModelSelectionResult,
} from "../providers/provider-model-selection-flow.js";
import { selectProviderModelRoute } from "./provider-model-route-prompt.js";

describe("selectProviderModelRoute", () => {
  it("returns selected route for a normal provider and model selection", async () => {
    const flow = fakeFlow();
    const prompt = fakePrompt();

    const result = await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      allowCancel: true,
    });

    expect(result).toEqual({
      kind: "selected",
      selection: selectionResult("openai", "alpha-model"),
    });
    expect(flow.resolved).toEqual([{ providerId: "openai", modelId: "alpha-model" }]);
    expect(prompt.calls).toHaveLength(2);
  });

  it("returns diagnostic when no providers are available", async () => {
    const flow = fakeFlow({ providers: [] });
    const prompt = fakePrompt();

    const result = await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
    });

    expect(result).toEqual({
      kind: "diagnostic",
      output: "No setup-visible provider candidates are available.",
    });
    expect(prompt.calls).toHaveLength(0);
    expect(flow.resolved).toHaveLength(0);
  });

  it("returns diagnostic when selected provider has no models", async () => {
    const flow = fakeFlow({ models: { openai: [] } });
    const prompt = fakePrompt();

    const result = await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
    });

    expect(result).toEqual({
      kind: "diagnostic",
      output: "No setup-visible models are available for OpenAI.",
    });
    expect(prompt.calls).toHaveLength(1);
    expect(flow.resolved).toHaveLength(0);
  });

  it("returns diagnostic when final selection resolution fails", async () => {
    const flow = fakeFlow({ diagnostic: "Provider OpenAI is not runnable." });
    const prompt = fakePrompt();

    const result = await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
    });

    expect(result.kind).toBe("diagnostic");
    expect(result).toEqual({
      kind: "diagnostic",
      output: "Provider/model selection failed: Provider OpenAI is not runnable.",
    });
    expect(flow.resolved).toEqual([{ providerId: "openai", modelId: "alpha-model" }]);
  });

  it("returns cancel at the provider step when cancel is enabled", async () => {
    const flow = fakeFlow();
    const prompt = fakePrompt(["cancel"]);

    const result = await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      allowCancel: true,
    });

    expect(result).toEqual({ kind: "cancel" });
    expect(prompt.calls[0]?.options.map((option) => option.id)).toContain("cancel");
    expect(flow.resolved).toHaveLength(0);
  });

  it("returns cancel at the model step when cancel is enabled", async () => {
    const flow = fakeFlow();
    const prompt = fakePrompt(["openai", "cancel"]);

    const result = await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      allowCancel: true,
    });

    expect(result).toEqual({ kind: "cancel" });
    expect(prompt.calls[1]?.options.map((option) => option.id)).toContain("cancel");
    expect(flow.resolved).toHaveLength(0);
  });

  it("returns back at the provider step when back is enabled", async () => {
    const flow = fakeFlow();
    const prompt = fakePrompt(["back"]);

    const result = await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      allowBack: true,
    });

    expect(result).toEqual({ kind: "back" });
    expect(prompt.calls[0]?.options.map((option) => option.id)).toContain("back");
    expect(flow.resolved).toHaveLength(0);
  });

  it("uses structured prompt-card rows through the prompt contract", async () => {
    const flow = fakeFlow();
    const prompt = fakePrompt();

    await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      allowBack: true,
      allowCancel: true,
    });

    const providerPrompt = prompt.calls[0]!;
    const modelPrompt = prompt.calls[1]!;
    expect(providerPrompt.surface).toBe("promptCard");
    expect(providerPrompt.columns).toEqual([
      { key: "name", header: "Name" },
      { key: "details", header: "Details" },
    ]);
    expect(providerPrompt.options[0]).toMatchObject({
      id: "openai",
      label: "OpenAI",
      cells: {
        name: "OpenAI",
        details: "2 models",
      },
    });
    expect(modelPrompt.options[0]).toMatchObject({
      id: "alpha-model",
      label: "alpha-model",
      cells: {
        name: "alpha-model",
        details: "tools, vision",
      },
    });
    expect(providerPrompt.options.at(-2)?.id).toBe("back");
    expect(providerPrompt.options.at(-1)?.id).toBe("cancel");
  });

  it("does not use current provider as provider default selection yet", async () => {
    const flow = fakeFlow({
      providers: [
        providerCandidate("openai", "OpenAI", 1),
        providerCandidate("local", "Local", 1),
      ],
    });
    const prompt = fakePrompt();

    await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      currentProviderId: "local",
    });

    expect(prompt.calls[0]?.defaultIndex).toBe(0);
    expect(flow.resolved).toEqual([{ providerId: "openai", modelId: "alpha-model" }]);
  });

  it("does not use current model as model default selection yet", async () => {
    const flow = fakeFlow({
      models: {
        openai: [
          modelCandidate("openai", "alpha-model"),
          modelCandidate("openai", "beta-model"),
        ],
      },
    });
    const prompt = fakePrompt();

    await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      currentProviderId: "openai",
      currentModelId: "beta-model",
    });

    expect(prompt.calls[1]?.defaultIndex).toBe(0);
    expect(flow.resolved).toEqual([{ providerId: "openai", modelId: "alpha-model" }]);
  });

  it("does not invent provider or model descriptions in this foundation commit", async () => {
    const flow = fakeFlow();
    const prompt = fakePrompt();

    await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      allowCancel: true,
    });

    const descriptions = prompt.calls.flatMap((call) => call.options.map((option) => option.description));
    const serialized = JSON.stringify(prompt.calls);
    expect(descriptions.every((description) => description === undefined)).toBe(true);
    expect(serialized).not.toContain("Direct OpenAI");
    expect(serialized).not.toContain("Gemini models");
    expect(serialized).not.toContain("Multi-provider catalog");
  });

  it("does not resolve or persist anything when navigation exits early", async () => {
    const flow = fakeFlow();
    const prompt = fakePrompt(["back"]);

    const result = await selectProviderModelRoute({
      prompt,
      flowEngine: flow.engine,
      locale: "en",
      mode: "primary",
      allowBack: true,
      allowCancel: true,
    });

    expect(result).toEqual({ kind: "back" });
    expect(flow.providerListCount).toBe(1);
    expect(flow.modelListCount).toBe(0);
    expect(flow.resolved).toHaveLength(0);
  });
});

function fakePrompt(selectionIds: readonly string[] = []): Prompt & {
  readonly calls: SelectPromptInput<unknown>[];
} {
  const selections = [...selectionIds];
  const calls: SelectPromptInput<unknown>[] = [];
  const prompt = (async () => {
    throw new Error("Plain prompt fallback was not expected in provider-model route prompt tests.");
  }) as unknown as Prompt & { readonly calls: SelectPromptInput<unknown>[] };
  prompt.select = async <T>(input: SelectPromptInput<T>): Promise<T> => {
    calls.push(input as SelectPromptInput<unknown>);
    const requested = selections.shift();
    const selected = requested === undefined
      ? input.options[input.defaultIndex ?? 0]
      : input.options.find((option) => option.id === requested || option.label === requested);
    return (selected ?? input.options[input.defaultIndex ?? 0] ?? input.options[0])!.value;
  };
  prompt.onboardingCard = () => undefined;
  prompt.close = () => undefined;
  Object.defineProperty(prompt, "calls", { value: calls });
  return prompt;
}

function fakeFlow(options: {
  readonly providers?: readonly ProviderCandidate[];
  readonly models?: Readonly<Record<string, readonly ModelCandidate[]>>;
  readonly diagnostic?: string;
} = {}): {
  readonly engine: FlowEngine;
  readonly resolved: Array<{ readonly providerId: ProviderId; readonly modelId: string }>;
  providerListCount: number;
  modelListCount: number;
} {
  const resolved: Array<{ readonly providerId: ProviderId; readonly modelId: string }> = [];
  const state = {
    providerListCount: 0,
    modelListCount: 0,
    resolved,
    engine: {
      listProviderCandidates: async () => {
        state.providerListCount += 1;
        return [...(options.providers ?? [providerCandidate("openai", "OpenAI", 2)])];
      },
      listModelCandidates: async (providerId: ProviderId) => {
        state.modelListCount += 1;
        const models = options.models?.[providerId] ?? [modelCandidate(providerId, "alpha-model")];
        return [...models];
      },
      resolveSelection: async (providerId: ProviderId, modelId: string) => {
        resolved.push({ providerId, modelId });
        if (options.diagnostic !== undefined) {
          return {
            kind: "diagnostic" as const,
            provider: providerId,
            model: modelId,
            reason: options.diagnostic,
          };
        }
        return selectionResult(providerId, modelId);
      },
    },
  };
  return state;
}

function providerCandidate(id: ProviderId, displayName: string, modelsCount: number): ProviderCandidate {
  return {
    id,
    displayName,
    catalogOnly: false,
    configurable: true,
    runnable: true,
    modelsCount,
    credentialReady: true,
  };
}

function modelCandidate(provider: ProviderId, id: string): ModelCandidate {
  return {
    id,
    provider,
    profile: {
      id,
      provider,
      contextWindowTokens: 128000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: false,
      supportsStructuredOutput: true,
      status: "stable",
    },
    configured: true,
    executable: true,
    catalogOnly: false,
    supportsVision: true,
    lifecycle: "available",
    usageClass: "primary-chat",
  };
}

function selectionResult(provider: ProviderId, model: string): ProviderModelSelectionResult {
  return {
    kind: "selected",
    provider,
    model,
    apiMode: "custom_openai_compatible" as ProviderApiMode,
    authMethod: "api_key" as ProviderAuthMethod,
    credentialAction: { kind: "reuse", reference: "env:OPENAI_API_KEY" },
    profile: {
      id: model,
      provider,
      contextWindowTokens: 128000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: false,
      supportsStructuredOutput: true,
      status: "stable",
    },
  };
}
