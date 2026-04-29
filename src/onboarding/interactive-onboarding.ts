import { createInterface as createPromptInterface } from "node:readline/promises";
import { createInterface as createCallbackInterface } from "node:readline";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import type { Writable, Readable } from "node:stream";
import { defaultEnvKey, loadRuntimeConfig, setupSecurityConfig, setupSkillConfig } from "../config/runtime-config.js";
import { writeEnvSecret } from "../config/env-secret-store.js";
import { diagnoseProviderConfig, renderProviderDiagnostic } from "../config/provider-diagnostics.js";
import type { ThemeDefinition } from "../contracts/theme.js";
import type { SecurityApprovalMode } from "../contracts/security.js";
import { WorkspaceTrustStore } from "../security/workspace-trust-store.js";
import type { SkillAutonomy } from "../skills/skill-learning.js";
import { kemetBlueTheme } from "../theme/kemet-blue.js";
import { completeOnboarding, defaultOnboardingSteps, getOnboardingStatus, type OnboardingOptions } from "./onboarding-flow.js";
import { runSetupVerification } from "./verification.js";

export type Prompt = ((question: string, options?: { secret?: boolean }) => Promise<string>) & {
  close?: () => void;
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
    const selectedRaw = await prompt(`${renderProviderPicker({ providerStep })}\nChoose provider [1-${providerStep.options.length}, default 1]: `);
    const parsedIndex = Number.parseInt(selectedRaw, 10) - 1;
    const selectedIndex = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0;
    const selected = providerStep.options[selectedIndex] ?? providerStep.options[0];
    const secretMode = selected.provider === "local"
      ? "none"
      : parseSecretMode(await prompt(renderSecretModePrompt()));
    const envName = selected.provider === "local" || secretMode === "skip"
      ? undefined
      : await prompt(`Environment variable for ${selected.label} API key [${defaultEnvKey(selected.provider)}]: `);
    const normalizedEnvName = envName?.trim() === "" || envName === undefined
      ? selected.provider === "local" ? undefined : defaultEnvKey(selected.provider)
      : envName.trim();
    const apiKey = selected.provider === "local" || secretMode !== "local-env"
      ? undefined
      : await prompt("Paste API key to store in ~/.estacoda/.env: ", { secret: true });
    const securityMode = parseSecurityMode(await prompt(renderSecurityModePrompt()));
    const skillAutonomy = parseSkillAutonomy(await prompt(renderSkillAutonomyPrompt()));
    const reviewLines = renderReview({
      provider: selected.provider,
      model: selected.model,
      credential: normalizedEnvName === undefined
        ? "local provider, no hosted API key"
        : secretMode === "existing-env"
          ? `from ${normalizedEnvName}`
          : secretMode === "skip"
            ? `reference ${normalizedEnvName}; key skipped`
            : `save to ~/.estacoda/.env as ${normalizedEnvName}`,
      trust: trustWorkspace ? workspaceRoot : "not trusted",
      securityMode,
      skillAutonomy
    });
    await prompt(`${reviewLines}\nPress Enter to save this setup... `);
    let secretPath: string | undefined;
    if (apiKey !== undefined && apiKey.trim().length > 0 && normalizedEnvName !== undefined) {
      secretPath = (await writeEnvSecret({
        homeDir: options.homeDir,
        key: normalizedEnvName,
        value: apiKey
      })).path;
    }
    const result = await completeOnboarding({
      ...options,
      workspaceRoot,
      input: {
        provider: selected.provider,
        model: selected.model,
        apiKeyEnv: normalizedEnvName,
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
    const sessionLine = options.continueToSession === true
      ? "Starting your first EstaCoda agent session now."
      : "Next: run estacoda";

    return {
      completed: !result.needed,
      exitCode: result.needed ? 1 : 0,
      output: [
        "Setup complete.",
        `Configured: ${formatProviderModel(selected.provider, selected.model)}`,
        `Config: ${result.configPath}`,
        secretPath === undefined ? undefined : `Secret store: ${secretPath}`,
        normalizedEnvName === undefined ? undefined : `Using credential from ${normalizedEnvName}.`,
        `Workspace trust: ${trustWorkspace ? "trusted" : "not trusted"}`,
        `Security mode: ${securityMode}`,
        `Skill autonomy: ${skillAutonomy}`,
        "",
        "Setup check",
        renderProviderDiagnostic(diagnostic),
        "",
        verification.output,
        sessionLine
      ].filter((line) => line !== undefined).join("\n")
    };
  } finally {
    prompt.close?.();
  }
}

export function createReadlinePrompt(input: Readable = defaultInput, output: Writable = defaultOutput): Prompt {
  const readline = createPromptInterface({
    input,
    output
  });

  return Object.assign(
    async (question: string, options?: { secret?: boolean }) => {
      if (options?.secret === true) {
        return hiddenQuestion(input, output, question);
      }
      return readline.question(question);
    },
    {
      close: () => readline.close()
    }
  );
}

export function canRunInteractive(input: NodeJS.ReadStream = defaultInput): boolean {
  return input.isTTY === true;
}

function formatProviderModel(provider: string, model: string): string {
  return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
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
    "2. Pick the first model route and credential storage.",
    "3. Choose security and skill-learning defaults.",
    "4. Verify the setup before entering the agent session.",
    "",
    input.body
  ].join("\n");
}

function renderProviderPicker(input: {
  providerStep: Extract<ReturnType<typeof defaultOnboardingSteps>[number], { id: "provider" }>;
}): string {
  return [
    input.providerStep.title,
    input.providerStep.body,
    "",
    ...input.providerStep.options.map((option, index) => {
      const credential = option.provider === "local" ? "no API key" : `${defaultEnvKey(option.provider)}`;
      return `${index + 1}. ${option.label.padEnd(26)} ${formatProviderModel(option.provider, option.model)} (${credential})`;
    })
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

function renderSecretModePrompt(): string {
  return [
    "Credential storage",
    "1. Save key locally in ~/.estacoda/.env (recommended)",
    "2. Use an existing environment variable",
    "3. Skip for now",
    "Choose credential storage [1]: "
  ].join("\n");
}

function renderSecurityModePrompt(): string {
  return [
    "Security mode",
    "1. Adaptive - allow clear safe actions, ask on ambiguity (recommended)",
    "2. Strict - ask before risky actions",
    "3. Open - minimize prompts; hard safety floor remains",
    "Choose security mode [1]: "
  ].join("\n");
}

function renderSkillAutonomyPrompt(): string {
  return [
    "Skill learning",
    "1. Suggest only (recommended)",
    "2. Off",
    "3. Auto-create after repeated safe success",
    "4. Auto-create after first safe success",
    "Choose skill autonomy [1]: "
  ].join("\n");
}

function parseSecretMode(value: string): "local-env" | "existing-env" | "skip" {
  switch (value.trim()) {
    case "2":
      return "existing-env";
    case "3":
      return "skip";
    default:
      return "local-env";
  }
}

function parseSecurityMode(value: string): SecurityApprovalMode {
  switch (value.trim().toLowerCase()) {
    case "2":
    case "strict":
      return "strict";
    case "3":
    case "open":
      return "open";
    default:
      return "adaptive";
  }
}

function parseSkillAutonomy(value: string): SkillAutonomy {
  switch (value.trim().toLowerCase()) {
    case "2":
    case "none":
      return "none";
    case "3":
    case "proactive":
      return "proactive";
    case "4":
    case "autonomous":
      return "autonomous";
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
    mutable.stdoutMuted = true;
    mutable._writeToOutput = (value: string) => {
      if (mutable.stdoutMuted === true) {
        output.write(value.replace(/[^\r\n]/gu, "*"));
      } else {
        originalWrite?.(value);
      }
    };
    readline.question(question, (answer) => {
      mutable.stdoutMuted = false;
      output.write("\n");
      readline.close();
      resolve(answer);
    });
  });
}
