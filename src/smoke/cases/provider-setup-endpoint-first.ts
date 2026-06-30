import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Prompt } from "../../cli/prompt-contract.js";
import type { ProviderApiMode, ProviderAuthMethod, ProviderId } from "../../contracts/provider.js";
import type {
  FlowEngine,
  ModelCandidate,
  ProviderCandidate,
  ProviderModelSelectionResult,
} from "../../providers/provider-model-selection-flow.js";
import { resolveProfileStateHome } from "../../config/profile-home.js";
import { WorkspaceTrustStore } from "../../security/workspace-trust-store.js";
import { createReviewedSetupApplyExecutor } from "../../setup/review/apply-executor.js";
import { runConfigEditor } from "../../setup/config-editor/runner.js";
import type { SmokeCase } from "../smoke-case.js";
import { makeTempDir } from "../fixtures/shared-setup.js";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_API_KEY_ENV = "OPENAI_COMPATIBLE_API_KEY";

export const provider_setup_endpoint_first_case: SmokeCase = {
  id: "provider-setup-endpoint-first",
  name: "Provider setup uses endpoint-first Local / Custom flow",
  tags: ["setup", "providers"],
  run: async () => {
    const homeDir = await makeTempDir("estacoda-provider-setup-smoke-");
    const workspaceRoot = join(homeDir, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    await writeUserConfig(homeDir, localReadyConfig());
    await trustWorkspace(homeDir, workspaceRoot);

    await runEndpointSetup({
      homeDir,
      workspaceRoot,
      actionId: "edit-primary-model-route",
      modelId: "primary-local-model",
      promptValues: endpointPromptValues("primary-local-model"),
    });
    await runEndpointSetup({
      homeDir,
      workspaceRoot,
      actionId: "edit-fallback-model-route",
      modelId: "fallback-local-model",
      promptValues: endpointPromptValues("fallback-local-model"),
    });
    await runEndpointSetup({
      homeDir,
      workspaceRoot,
      actionId: "edit-auxiliary-model-route",
      modelId: "aux-local-model",
      promptValues: ["compression", ...endpointPromptValues("aux-local-model")],
    });

    const config = JSON.parse(await readFile(profileConfigPath(homeDir), "utf8")) as {
      model?: {
        provider?: string;
        id?: string;
        fallbacks?: Array<{ provider?: string; id?: string; baseUrl?: string; apiKeyEnv?: string }>;
      };
      auxiliaryModels?: {
        compression?: { provider?: string; id?: string; baseUrl?: string; apiKeyEnv?: string; enabled?: boolean };
      };
    };

    if (config.model?.provider !== "local" || config.model.id !== "primary-local-model") {
      throw new Error("Primary Local / Custom endpoint setup did not update the primary route.");
    }
    const fallback = config.model.fallbacks?.[0];
    if (fallback?.provider !== "local" || fallback.id !== "fallback-local-model" || fallback.baseUrl !== DEFAULT_BASE_URL) {
      throw new Error("Fallback Local / Custom endpoint setup did not write the expected fallback route.");
    }
    const auxiliary = config.auxiliaryModels?.compression;
    if (auxiliary?.provider !== "local" || auxiliary.id !== "aux-local-model" || auxiliary.baseUrl !== DEFAULT_BASE_URL || auxiliary.enabled !== true) {
      throw new Error("Auxiliary Local / Custom endpoint setup did not write the expected auxiliary route.");
    }
  },
};

async function runEndpointSetup(input: {
  readonly homeDir: string;
  readonly workspaceRoot: string;
  readonly actionId: "edit-primary-model-route" | "edit-fallback-model-route" | "edit-auxiliary-model-route";
  readonly modelId: string;
  readonly promptValues: readonly unknown[];
}): Promise<void> {
  const result = await runConfigEditor({
    homeDir: input.homeDir,
    workspaceRoot: input.workspaceRoot,
    prompt: fakePrompt({ values: input.promptValues }),
    defaultActionId: input.actionId,
    flowEngine: localEndpointFlowEngine(input.modelId),
    providerFetch: async (url) => {
      if (String(url).endsWith("/models")) {
        return fetchResponse({ data: [{ id: input.modelId }] });
      }
      return fetchResponse({});
    },
    applyExecutor: createReviewedSetupApplyExecutor({
      homeDir: input.homeDir,
      workspaceRoot: input.workspaceRoot,
      collectVerification: () => readyVerification(profileConfigPath(input.homeDir)),
    }),
  });
  if (!result.completed || result.exitCode !== 0) {
    throw new Error(`Endpoint setup action ${input.actionId} failed: ${result.output}`);
  }
}

function endpointPromptValues(modelId: string): readonly unknown[] {
  return [
    "Local",
    "",
    "Check endpoint",
    modelId,
    "",
    "No API key",
    "Skip test",
    "Review changes",
    true,
  ];
}

function localEndpointFlowEngine(modelId: string): FlowEngine {
  return {
    listProviderCandidates: async () => [localProviderCandidate()],
    listModelCandidates: async () => [localModelCandidate(modelId)],
    resolveSelection: async (providerId, selectedModelId) => localSelectionResult(providerId, selectedModelId),
  };
}

function localProviderCandidate(): ProviderCandidate {
  return {
    id: "local",
    displayName: "Local",
    catalogOnly: false,
    configurable: true,
    runnable: true,
    modelsCount: 1,
    credentialReady: false,
    baseUrl: DEFAULT_BASE_URL,
  };
}

function localModelCandidate(modelId: string): ModelCandidate {
  return {
    id: modelId,
    provider: "local",
    profile: localModelProfile(modelId),
    configured: true,
    executable: true,
    catalogOnly: false,
    supportsVision: true,
    lifecycle: "available",
    usageClass: "primary-chat",
  };
}

function localSelectionResult(providerId: ProviderId, modelId: string): ProviderModelSelectionResult {
  return {
    kind: "selected",
    provider: providerId,
    model: modelId,
    baseUrl: DEFAULT_BASE_URL,
    apiMode: "custom_openai_compatible" as ProviderApiMode,
    authMethod: "api_key" as ProviderAuthMethod,
    credentialAction: {
      kind: "endpoint",
      baseUrl: DEFAULT_BASE_URL,
      apiKeyEnv: DEFAULT_API_KEY_ENV,
    },
    profile: localModelProfile(modelId),
  };
}

function localModelProfile(modelId: string) {
  return {
    id: modelId,
    provider: "local" as ProviderId,
    contextWindowTokens: 128000,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
    supportsStructuredOutput: true,
    status: "stable" as const,
  };
}

function fakePrompt(options: { readonly values?: readonly unknown[] } = {}): Prompt {
  const values = [...(options.values ?? [])];
  const prompt = (async () => {
    const next = values.shift();
    return next === undefined ? "" : String(next);
  }) as Prompt;
  prompt.select = async (input) => {
    const next = values.shift();
    if (next !== undefined) {
      const match = input.options.find((option) =>
        Object.is(option.value, next) ||
        option.label === next ||
        option.id === next ||
        (typeof option.value === "object" && option.value !== null && "id" in option.value && option.value.id === next)
      );
      if (match !== undefined) return match.value;
    }
    return input.options[input.defaultIndex ?? 0]?.value ?? input.options[0]!.value;
  };
  prompt.onboardingCard = () => undefined;
  prompt.close = () => undefined;
  return prompt;
}

async function writeUserConfig(homeDir: string, config: unknown): Promise<void> {
  const configPath = profileConfigPath(homeDir);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function profileConfigPath(homeDir: string): string {
  return resolveProfileStateHome({ homeDir, profileId: "default" }).configPath;
}

async function trustWorkspace(homeDir: string, workspaceRoot: string): Promise<void> {
  await new WorkspaceTrustStore({
    path: join(homeDir, ".estacoda", "trust.json"),
  }).grant(workspaceRoot, { label: "smoke" });
}

function localReadyConfig(): Record<string, unknown> {
  return {
    model: {
      provider: "local",
      id: "seed-local-model",
    },
    providers: {
      local: {
        kind: "openai-compatible",
        baseUrl: DEFAULT_BASE_URL,
        models: ["seed-local-model"],
        enableNetwork: true,
      },
    },
  };
}

function fetchResponse(json: unknown): {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly json: () => Promise<unknown>;
  readonly text: () => Promise<string>;
} {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function readyVerification(configPath: string) {
  return {
    stateWritable: true,
    envFilePresent: true,
    envFileSecure: true,
    workspaceTrusted: true,
    securityModeLabel: "Adaptive",
    securityModeValue: "adaptive",
    skillAutonomyLabel: "Suggest",
    skillAutonomyValue: "suggest",
    providerDiagnostic: {
      status: "ready" as const,
      lines: ["Provider status: ready"],
      warnings: [],
    },
    toolStatus: "skipped" as const,
    configSources: [configPath],
    warnings: [],
    issueCodes: [],
  };
}
