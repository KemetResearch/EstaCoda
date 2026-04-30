import { createInterface as createPromptInterface } from "node:readline/promises";
import { createInterface as createCallbackInterface } from "node:readline";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import type { Writable, Readable } from "node:stream";
import { parseChoiceIndex, selectOption, type SelectPromptInput } from "../cli/interactive-select.js";
import { defaultEnvKey, loadRuntimeConfig, setupSecurityConfig, setupSkillConfig } from "../config/runtime-config.js";
import { diagnoseProviderConfig, renderProviderDiagnostic } from "../config/provider-diagnostics.js";
import type { ProviderId } from "../contracts/provider.js";
import type { ThemeDefinition } from "../contracts/theme.js";
import type { SecurityApprovalMode } from "../contracts/security.js";
import { WorkspaceTrustStore } from "../security/workspace-trust-store.js";
import type { SkillAutonomy } from "../skills/skill-learning.js";
import { kemetBlueTheme } from "../theme/kemet-blue.js";
import {
  formatSecurityMode,
  formatSkillAutonomy,
  renderSecurityModeOption,
  renderSkillAutonomyOption,
  type Locale
} from "../ui/settings-labels.js";
import { completeOnboarding, defaultOnboardingSteps, getOnboardingStatus, type OnboardingOptions } from "./onboarding-flow.js";
import { runSetupVerification } from "./verification.js";

export type Prompt = ((question: string, options?: { secret?: boolean }) => Promise<string>) & {
  select?: <T>(input: SelectPromptInput<T>) => Promise<T>;
  close?: () => void;
};

type ModelChoice = {
  provider: ProviderId;
  model: string;
  label: string;
  description?: string;
};

type ProviderChoice = {
  provider: ProviderId;
  label: string;
  description: string;
  models: ModelChoice[];
};

export type InteractiveOnboardingResult = {
  completed: boolean;
  output: string;
  exitCode: number;
};

export async function runInteractiveOnboarding(options: OnboardingOptions & {
  prompt?: Prompt;
  theme?: ThemeDefinition;
  continueToSession?: boolean;
}): Promise<InteractiveOnboardingResult> {
  const status = await getOnboardingStatus(options);
  const loadedConfig = await loadRuntimeConfig(options);
  const locale: Locale = loadedConfig.ui.language === "ar" ? "ar" : "en";
  const theme = options.theme ?? kemetBlueTheme;

  if (!status.needed) {
    return {
      completed: true,
      exitCode: 0,
      output: `EstaCoda is already configured for ${status.configuredModel}.`
    };
  }

  const prompt = options.prompt ?? createReadlinePrompt();
  const providerStep = defaultOnboardingSteps().find((step) => step.id === "provider");
  const welcomeStep = defaultOnboardingSteps().find((step) => step.id === "welcome");

  if (providerStep === undefined) {
    return {
      completed: false,
      exitCode: 1,
      output: "Onboarding provider step is unavailable."
    };
  }

  try {
    await prompt(`${renderWelcome({ theme, body: welcomeStep?.body ?? providerStep.body })}\nPress Enter to begin... `);

    const workspaceRaw = await prompt(`Workspace root [${options.workspaceRoot}]: `);
    const workspaceRoot = workspaceRaw.trim().length === 0 ? options.workspaceRoot : workspaceRaw.trim();
    const trustRaw = await prompt("Trust this workspace for normal local file and terminal work? [Y/n]: ");
    const trustWorkspace = parseYesNo(trustRaw, true);
    const provider = await selectProvider(prompt);
    const selected = await selectModel(prompt, provider);
    const defaultApiKeyEnv = selected.provider === "local" ? undefined : defaultEnvKey(selected.provider);
    const normalizedEnvName = defaultApiKeyEnv;
    const apiKey = selected.provider === "local"
      ? undefined
      : await prompt(`Paste ${selected.label} API key to store as ${normalizedEnvName}: `, { secret: true });
    const securityMode = await selectSecurityMode(prompt, locale);
    const skillAutonomy = await selectSkillAutonomy(prompt, locale);
    const reviewLines = renderReview({
      provider: selected.provider,
      model: selected.model,
      credential: normalizedEnvName === undefined
        ? "local provider, no hosted API key"
        : `save to ~/.estacoda/.env as ${normalizedEnvName}`,
      trust: trustWorkspace ? workspaceRoot : "not trusted",
      securityMode,
      skillAutonomy
    });
    await prompt(`${reviewLines}\nPress Enter to save this setup... `);
    const result = await completeOnboarding({
      ...options,
      workspaceRoot,
      input: {
        scope: "user",
        provider: selected.provider,
        model: selected.model,
        apiKeyEnv: normalizedEnvName,
        apiKey,
        enableNetwork: selected.provider !== "local"
      }
    });
    await setupSecurityConfig({
      ...options,
      workspaceRoot,
      input: {
        scope: "user",
        mode: securityMode
      }
    });
    await setupSkillConfig({
      ...options,
      workspaceRoot,
      input: {
        scope: "user",
        autonomy: skillAutonomy
      }
    });
    if (trustWorkspace) {
      await new WorkspaceTrustStore({
        path: `${options.homeDir ?? process.env.HOME ?? ""}/.estacoda/trust.json`
      }).grant(workspaceRoot, { label: "setup wizard" });
    }
    const loaded = await loadRuntimeConfig({ ...options, workspaceRoot });
    const diagnostic = await diagnoseProviderConfig(loaded);
    const verification = await runSetupVerification({ ...options, workspaceRoot });
    const security = formatSecurityMode(securityMode, locale);
    const autonomy = formatSkillAutonomy(skillAutonomy, locale);
    const setupCheck = diagnostic.status === "ready" && verification.ok
      ? [
          "Setup check: ready",
          `Provider: ${formatProviderModel(loaded.model.provider, loaded.model.id)}`,
          `Workspace: ${trustWorkspace ? "trusted" : "not trusted"}`,
          `Security: ${security.label}`,
          `Skills: ${autonomy.label}`
        ].join("\n")
      : [
          "Setup check",
          renderProviderDiagnostic(diagnostic),
          "",
          verification.output
        ].join("\n");
    const sessionLine = options.continueToSession === true
      ? "Starting your first EstaCoda agent session now."
      : "Next: run estacoda, or run estacoda verify any time to re-check setup.";

    return {
      completed: !result.needed,
      exitCode: result.needed ? 1 : 0,
      output: [
        "Setup complete.",
        "EstaCoda is ready to use this workspace configuration.",
        `Configured: ${formatProviderModel(selected.provider, selected.model)}`,
        `Config: ${result.configPath}`,
        result.secretPath === undefined ? undefined : `Secret store: ${result.secretPath}`,
        normalizedEnvName === undefined ? undefined : `Using credential from ${normalizedEnvName}.`,
        `Workspace trust: ${trustWorkspace ? "trusted" : "not trusted"}`,
        `Security mode: ${security.label} (${security.value})`,
        `Skill autonomy: ${autonomy.label} (${autonomy.value})`,
        "",
        setupCheck,
        sessionLine
      ].filter((line) => line !== undefined).join("\n")
    };
  } finally {
    prompt.close?.();
  }
}

export function createReadlinePrompt(input: Readable = defaultInput, output: Writable = defaultOutput): Prompt {
  return Object.assign(
    async (question: string, options?: { secret?: boolean }) => {
      if (options?.secret === true) {
        return hiddenQuestion(input, output, question);
      }
      return plainQuestion(input, output, question);
    },
    {
      select: async <T>(selection: SelectPromptInput<T>) => selectOption(input, output, selection),
      close: () => undefined
    }
  );
}

export function canRunInteractive(input: NodeJS.ReadStream = defaultInput): boolean {
  return input.isTTY === true;
}

function formatProviderModel(provider: string, model: string): string {
  return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
}

function providerChoices(): ProviderChoice[] {
  return [
    {
      provider: "openai",
      label: "OpenAI",
      description: "Broad tool-use and multimodal support.",
      models: [
        { provider: "openai", model: "gpt-4.1-mini", label: "GPT-4.1 Mini", description: "Fast, capable default route." }
      ]
    },
    {
      provider: "kimi",
      label: "Kimi",
      description: "Strong general and coding route.",
      models: [
        { provider: "kimi", model: "kimi-k2.5", label: "Kimi K2.5", description: "Recommended balanced model." },
        { provider: "kimi", model: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo Preview", description: "Faster preview route." }
      ]
    },
    {
      provider: "deepseek",
      label: "DeepSeek",
      description: "Hosted coding-capable route.",
      models: [
        { provider: "deepseek", model: "deepseek-chat", label: "DeepSeek Chat", description: "General chat and coding route." }
      ]
    },
    {
      provider: "openrouter",
      label: "OpenRouter",
      description: "Use models through an OpenRouter account.",
      models: [
        { provider: "openrouter", model: "qwen/qwen3.6-plus", label: "Qwen 3.6 Plus", description: "General high-context route via OpenRouter." }
      ]
    },
    {
      provider: "local",
      label: "Local",
      description: "Use an OpenAI-compatible local runtime.",
      models: [
        { provider: "local", model: "ollama/auto", label: "Ollama-compatible auto", description: "No hosted API key required." }
      ]
    }
  ];
}

async function selectProvider(
  prompt: Prompt
): Promise<ProviderChoice> {
  const defaultIndex = 0;
  if (prompt.select !== undefined) {
    return await prompt.select({
      title: "Choose a provider",
      body: "Pick the account you want EstaCoda to use first.",
      defaultIndex,
      options: providerChoices().map((option) => ({
        value: option,
        label: option.label,
        description: option.description
      })),
      fallbackPrompt: `${renderProviderPicker()}\nEnter choice number [default: 1 ${providerChoices()[0]?.label ?? "first option"}]: `
    });
  }

  const selectedRaw = await prompt(`${renderProviderPicker()}\nEnter choice number [default: 1 ${providerChoices()[0]?.label ?? "first option"}]: `);
  const parsedIndex = Number.parseInt(selectedRaw, 10) - 1;
  const selectedIndex = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : defaultIndex;
  return providerChoices()[selectedIndex] ?? providerChoices()[defaultIndex] ?? providerChoices()[0]!;
}

async function selectModel(prompt: Prompt, provider: ProviderChoice): Promise<ModelChoice> {
  const defaultIndex = 0;
  if (provider.models.length === 1) {
    return provider.models[0]!;
  }
  if (prompt.select !== undefined) {
    return await prompt.select({
      title: `Choose ${provider.label} model`,
      body: "Pick the model EstaCoda should use for this workspace.",
      defaultIndex,
      options: provider.models.map((model) => ({
        value: model,
        label: model.label,
        description: model.description
      })),
      fallbackPrompt: `${renderModelPicker(provider)}\nEnter choice number [default: 1 ${provider.models[0]?.label ?? "first option"}]: `
    });
  }

  const selectedRaw = await prompt(`${renderModelPicker(provider)}\nEnter choice number [default: 1 ${provider.models[0]?.label ?? "first option"}]: `);
  const selectedIndex = parseChoiceIndex(selectedRaw, provider.models.length, defaultIndex);
  return provider.models[selectedIndex] ?? provider.models[defaultIndex] ?? provider.models[0]!;
}

async function selectSecurityMode(prompt: Prompt, locale: Locale): Promise<SecurityApprovalMode> {
  const options: SecurityApprovalMode[] = ["strict", "adaptive", "open"];
  const defaultIndex = 1;
  if (prompt.select !== undefined) {
    return await prompt.select({
      title: locale === "ar" ? "اختر وضع الأمان" : "Choose security mode",
      body: locale === "ar" ? "يمكنك تغييره لاحقاً من الإعدادات." : "You can change this later from settings.",
      defaultIndex,
      options: options.map((mode) => {
        const formatted = formatSecurityMode(mode, locale);
        return {
          value: mode,
          label: formatted.label,
          description: formatted.description
        };
      }),
      fallbackPrompt: renderSecurityModePrompt(locale)
    });
  }

  return parseSecurityMode(await prompt(renderSecurityModePrompt(locale)));
}

async function selectSkillAutonomy(prompt: Prompt, locale: Locale): Promise<SkillAutonomy> {
  const options: SkillAutonomy[] = ["none", "suggest", "proactive", "autonomous"];
  const defaultIndex = 1;
  if (prompt.select !== undefined) {
    return await prompt.select({
      title: locale === "ar" ? "اختر مستوى تعلّم المهارات" : "Choose skill autonomy",
      body: locale === "ar" ? "هذا يحدد مدى استباقية EstaCoda في إنشاء المهارات." : "This controls how proactive EstaCoda is about reusable workflows.",
      defaultIndex,
      options: options.map((mode) => {
        const formatted = formatSkillAutonomy(mode, locale);
        return {
          value: mode,
          label: formatted.label,
          description: formatted.description
        };
      }),
      fallbackPrompt: renderSkillAutonomyPrompt(locale)
    });
  }

  return parseSkillAutonomy(await prompt(renderSkillAutonomyPrompt(locale)));
}

function renderWelcome(input: {
  theme: ThemeDefinition;
  body: string;
}): string {
  const brand = input.theme.branding;
  const rule = "─".repeat(64);

  return [
    `${brand.responseLabel} first-run setup`,
    brand.taglinePrimary,
    brand.taglineSecondary,
    rule,
    "",
    "Welcome. We’ll get three things in place:",
    "1. Trust the active workspace, if you want normal local work here.",
    "2. Pick the first model route and save its API key locally.",
    "3. Choose security and skill-learning defaults.",
    "4. Verify the setup before entering the agent session.",
    "",
    input.body
  ].join("\n");
}

function renderProviderPicker(): string {
  return [
    "Choose a provider",
    "Pick the account you want EstaCoda to use first.",
    "",
    ...providerChoices().map((option, index) => {
      const credential = option.provider === "local" ? "no API key" : `${defaultEnvKey(option.provider)}`;
      return `${index + 1}. ${option.label.padEnd(14)} ${option.description} (${credential})`;
    })
  ].join("\n");
}

function renderModelPicker(provider: ProviderChoice): string {
  return [
    `Choose ${provider.label} model`,
    "Pick the model EstaCoda should use for this workspace.",
    "",
    ...provider.models.map((option, index) => `${index + 1}. ${option.label.padEnd(24)} ${option.description ?? formatProviderModel(option.provider, option.model)}`)
  ].join("\n");
}

function renderReview(input: {
  provider: string;
  model: string;
  credential: string;
  trust: string;
  securityMode: SecurityApprovalMode;
  skillAutonomy: SkillAutonomy;
}): string {
  return [
    "Review setup",
    `Provider:   ${input.provider}`,
    `Model:      ${input.model}`,
    `Credential: ${input.credential}`,
    `Workspace:  ${input.trust}`,
    `Security:   ${input.securityMode}`,
    `Skills:     ${input.skillAutonomy}`,
    "",
    "EstaCoda stores configuration and credential references. Raw hosted keys go only into ~/.estacoda/.env."
  ].join("\n");
}

function renderSecurityModePrompt(locale: Locale): string {
  if (locale === "ar") {
    return [
      "اختر وضع الأمان:",
      renderSecurityModeOption(1, "strict", locale),
      renderSecurityModeOption(2, "adaptive", locale),
      renderSecurityModeOption(3, "open", locale),
      "اختر وضع الأمان [الافتراضي: 2 متوازن]: "
    ].join("\n");
  }

  return [
    "Choose security mode:",
    renderSecurityModeOption(1, "strict", locale),
    renderSecurityModeOption(2, "adaptive", locale),
    renderSecurityModeOption(3, "open", locale),
    "Choose security mode [default: 2 Adaptive]: "
  ].join("\n");
}

function renderSkillAutonomyPrompt(locale: Locale): string {
  if (locale === "ar") {
    return [
      "اختر مستوى تعلّم المهارات:",
      renderSkillAutonomyOption(1, "none", locale),
      renderSkillAutonomyOption(2, "suggest", locale),
      renderSkillAutonomyOption(3, "proactive", locale),
      renderSkillAutonomyOption(4, "autonomous", locale),
      "اختر مستوى تعلّم المهارات [الافتراضي: 2 اقتراح]: "
    ].join("\n");
  }

  return [
    "Choose skill autonomy:",
    renderSkillAutonomyOption(1, "none", locale),
    renderSkillAutonomyOption(2, "suggest", locale),
    renderSkillAutonomyOption(3, "proactive", locale),
    renderSkillAutonomyOption(4, "autonomous", locale),
    "Choose skill autonomy [default: 2 Suggest]: "
  ].join("\n");
}

function parseSecurityMode(value: string): SecurityApprovalMode {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "strict":
      return "strict";
    case "3":
    case "open":
      return "open";
    case "2":
    case "adaptive":
    default:
      return "adaptive";
  }
}

function parseSkillAutonomy(value: string): SkillAutonomy {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "none":
      return "none";
    case "3":
    case "proactive":
      return "proactive";
    case "4":
    case "autonomous":
      return "autonomous";
    case "2":
    case "suggest":
    default:
      return "suggest";
  }
}

function parseYesNo(value: string, defaultValue: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return defaultValue;
  }
  return normalized === "y" || normalized === "yes";
}

async function plainQuestion(input: Readable, output: Writable, question: string): Promise<string> {
  const readline = createPromptInterface({ input, output });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

async function hiddenQuestion(input: Readable, output: Writable, question: string): Promise<string> {
  const isTty = Boolean((input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY);
  if (!isTty) {
    const readline = createPromptInterface({ input, output });
    try {
      return await readline.question(question);
    } finally {
      readline.close();
    }
  }

  return await new Promise<string>((resolve) => {
    const readline = createCallbackInterface({ input, output, terminal: true });
    const mutable = readline as unknown as { _writeToOutput?: (value: string) => void; stdoutMuted?: boolean };
    const originalWrite = mutable._writeToOutput?.bind(readline);
    output.write(`${question}\n`);
    mutable.stdoutMuted = true;
    mutable._writeToOutput = (value: string) => {
      if (mutable.stdoutMuted === true) {
        output.write(value.replace(/[^\r\n]/gu, "*"));
      } else {
        originalWrite?.(value);
      }
    };
    readline.question("", (answer) => {
      mutable.stdoutMuted = false;
      output.write("\n");
      readline.close();
      resolve(answer);
    });
  });
}
