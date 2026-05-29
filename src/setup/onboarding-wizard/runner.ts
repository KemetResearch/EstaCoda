import { resolveStateHome } from "../../config/state-home.js";
import {
  loadRuntimeConfig,
} from "../../config/runtime-config.js";
import { defaultProfileId, readActiveProfile, resolveProfileStateHome } from "../../config/profile-home.js";
import { ensureDefaultProfileState } from "../../cli/profile-state.js";
import type { Prompt } from "../../cli/readline-prompt.js";
import { promptForApiKeyInput } from "../../cli/secret-prompt.js";
import {
  createProviderModelSelectionFlow,
  type FlowEngine,
} from "../../providers/provider-model-selection-flow.js";
import {
  type FirstRunOnboardingSelections,
  type OptionalCapabilityId,
} from "./plan.js";
import type { OnboardingCredentialSummaryStatus, OnboardingWizardState } from "./state.js";
import { renderOnboardingWizardSummary } from "./summary.js";
import {
  validateOnboardingWorkspacePath,
  type OnboardingInvalidWorkspaceAction,
} from "./workspace.js";
import { promptInterfaceLanguageAndStyle } from "../interface-preferences.js";
import { buildOnboardingWizardDraftBundle, type SetupDraftBundle } from "../setup-drafts.js";
import {
  buildSetupReviewManifest,
  type SetupReviewManifest,
} from "../setup-review-manifest.js";
import {
  executeSetupApplyPlan,
  planSetupApply,
  type SetupApplyEndState,
  type SetupDeferredSecretWrite,
  type SetupApplyExecutor,
  type SetupApplyFlowOptions,
  type SetupApplyPlanningResult,
} from "../setup-apply-plan.js";
import {
  collectSetupEntryState,
  type CollectSetupEntryStateOptions,
  type SetupEntryState,
} from "../setup-entry-state.js";
import type { SetupCopyKey, SetupCopyLocale } from "../setup-copy.js";
import {
  formatSetupCopy,
  promptSetupChoice,
  promptSetupStringWithDefault,
  renderSetupApplyEndState,
  renderSetupApplyPlanningResult,
  setupCopyText,
  showSetupCard,
} from "../setup-prompts.js";
import {
  promptModelCandidate,
  promptProviderCandidate,
} from "../config-editor/prompts.js";

export type FirstRunSetupRunnerOptions = CollectSetupEntryStateOptions & {
  readonly prompt: Prompt;
  readonly flowEngine?: FlowEngine;
  readonly defaultSelections?: FirstRunOnboardingSelections;
  readonly applyExecutor?: SetupApplyExecutor;
  readonly applyFlowOptions?: SetupApplyFlowOptions;
  readonly output?: {
    readonly write: (value: string) => void;
  };
};

export type FirstRunSetupRunnerResult = {
  readonly completed: boolean;
  readonly exitCode: number;
  readonly output: string;
  readonly state: SetupEntryState;
  readonly selections: FirstRunOnboardingSelections;
  readonly wizardState: OnboardingWizardState;
  readonly draftBundle: SetupDraftBundle;
  readonly reviewManifest: SetupReviewManifest;
  readonly applyPlanningResult: SetupApplyPlanningResult;
  readonly applyEndState?: SetupApplyEndState;
};

type PendingCredentialWrite = SetupDeferredSecretWrite;

type WorkspaceTrustAction = "trust" | "change-workspace" | "decide-later";

const OPTIONAL_CAPABILITY_COPY_KEYS: Record<OptionalCapabilityId, {
  readonly title: SetupCopyKey;
}> = {
  channels: {
    title: "setupModules.telegram.title",
  },
  voice: {
    title: "setupModules.voice.title",
  },
  vision: {
    title: "setupModules.vision.title",
  },
  browser: {
    title: "setupModules.browser.title",
  },
};

const OPTIONAL_CAPABILITY_IDS: readonly OptionalCapabilityId[] = ["channels", "voice", "vision", "browser"];

export async function runFirstRunSetup(
  options: FirstRunSetupRunnerOptions
): Promise<FirstRunSetupRunnerResult> {
  const prompt = options.prompt;
  const state = await collectSetupEntryState(options);
  await ensureDefaultProfileState({ homeDir: options.homeDir, profileId: options.profileId ?? defaultProfileId() });
  const stateHome = resolveStateHome({ homeDir: options.homeDir });
  const flowEngine = options.flowEngine ?? await createDefaultFlowEngine(options);
  const initialLocale = options.defaultSelections?.language ?? "en";

  await showSetupCard(prompt, initialLocale, {
    title: setupCopyText(initialLocale, "onboarding.welcome.title"),
    bodyLines: [setupCopyText(initialLocale, "onboarding.welcome")],
    options: [{ id: "begin", label: setupCopyText(initialLocale, "onboarding.common.begin") }],
  });

  const interfaceChoice = await promptInterfaceLanguageAndStyle(prompt, {
    initialLocale,
    currentLanguage: options.defaultSelections?.language ?? "en",
    currentFlavor: options.defaultSelections?.interfaceFlavor,
  });
  const language = interfaceChoice.language;

  const workspaceSelection = await promptForWorkspaceAndTrust(options, language);
  const workspaceRoot = workspaceSelection.workspaceRoot;
  const workspaceTrusted = workspaceSelection.workspaceTrusted;


  const providerCandidates = await flowEngine.listProviderCandidates();
  if (providerCandidates.length === 0) {
    throw new Error("No setup-visible provider candidates are available.");
  }
  const primaryProviderCandidate = await promptProviderCandidate(prompt, {
    candidates: providerCandidates,
    currentProviderId: options.defaultSelections?.primaryProvider,
  }, language);
  const primaryProvider = primaryProviderCandidate.id;


  const modelCandidates = await flowEngine.listModelCandidates(primaryProvider);
  if (modelCandidates.length === 0) {
    throw new Error(`No setup-visible models are available for ${primaryProviderCandidate.displayName}.`);
  }
  const primaryModelCandidate = await promptModelCandidate(prompt, {
    providerId: primaryProvider,
    candidates: modelCandidates,
    currentModelId: options.defaultSelections?.primaryModel,
  }, language);
  const primaryModel = primaryModelCandidate.id;

  const resolution = await flowEngine.resolveSelection(primaryProvider, primaryModel);
  if (resolution.kind === "diagnostic") {
    throw new Error(`Provider/model selection failed: ${resolution.reason}`);
  }

  const primaryBaseUrl = resolution.baseUrl;
  const primaryContextWindowTokens = resolution.profile.contextWindowTokens;
  const primaryApiMode = resolution.apiMode;
  const primaryAuthMethod = resolution.authMethod;

  let primaryCredential: FirstRunOnboardingSelections["primaryCredential"];
  let pendingCredentialWrite: PendingCredentialWrite | undefined;
  let credentialStatus: OnboardingCredentialSummaryStatus = "not_set";

  switch (resolution.credentialAction.kind) {
    case "none": {
      primaryCredential = { kind: "none" };
      write(options, `${setupCopyText(language, "onboarding.providers.primaryCredential.localProviderSkip")}\n`);
      break;
    }
    case "reuse": {
      const ref = resolution.credentialAction.reference;
      if (!ref.startsWith("env:")) {
        throw new Error(`Malformed reuse credential reference: ${ref}`);
      }
      const envVarName = ref.slice(4);
      primaryCredential = { kind: "env", name: envVarName };
      credentialStatus = "existing_detected";
      write(options, `Using existing credential from ${envVarName}.\n`);
      break;
    }
    case "collect": {
      const envVarName = resolution.credentialAction.envVarName;
      primaryCredential = { kind: "env", name: envVarName };
      const promptResult = await promptForApiKeyInput({
        prompt,
        providerId: primaryProvider,
        envVarName,
        question: `${setupCopyText(language, "onboarding.providers.primaryCredential")} [${envVarName}]: `,
      });

      if (promptResult.kind === "skipped") {
        write(options, `Config will expect ${envVarName} to be available externally.\n`);
      } else {
        credentialStatus = "new_pending";
        pendingCredentialWrite = {
          envVarName: promptResult.envVarName,
          value: promptResult.value,
        };
      }
      break;
    }

  }

  const securityMode = await promptSetupChoice(prompt, {
    title: setupCopyText(language, "onboarding.security.title"),
    message: `${setupCopyText(language, "onboarding.security")}\n`,
    choices: [
      {
        id: "adaptive",
        label: setupCopyText(language, "onboarding.security.options.adaptive.label"),
        description: setupCopyText(language, "onboarding.security.options.adaptive.description"),
        value: "adaptive" as const,
      },
      {
        id: "strict",
        label: setupCopyText(language, "onboarding.security.options.strict.label"),
        description: setupCopyText(language, "onboarding.security.options.strict.description"),
        value: "strict" as const,
      },
      {
        id: "open",
        label: setupCopyText(language, "onboarding.security.options.open.label"),
        description: setupCopyText(language, "onboarding.security.options.open.description"),
        value: "open" as const,
      },
    ],
    defaultValue: options.defaultSelections?.securityMode ?? "adaptive",
  });

  const workflowLearning = await promptSetupChoice(prompt, {
    title: setupCopyText(language, "onboarding.workflowLearning.title"),
    message: `${setupCopyText(language, "onboarding.workflowLearning")}\n`,
    choices: [
      {
        id: "suggest",
        label: setupCopyText(language, "onboarding.workflowLearning.options.suggest.label"),
        description: setupCopyText(language, "onboarding.workflowLearning.options.suggest.description"),
        value: "suggest" as const,
      },
      {
        id: "none",
        label: setupCopyText(language, "onboarding.workflowLearning.options.none.label"),
        description: setupCopyText(language, "onboarding.workflowLearning.options.none.description"),
        value: "none" as const,
      },
      {
        id: "proactive",
        label: setupCopyText(language, "onboarding.workflowLearning.options.proactive.label"),
        description: setupCopyText(language, "onboarding.workflowLearning.options.proactive.description"),
        value: "proactive" as const,
      },
      {
        id: "autonomous",
        label: setupCopyText(language, "onboarding.workflowLearning.options.autonomous.label"),
        description: setupCopyText(language, "onboarding.workflowLearning.options.autonomous.description"),
        value: "autonomous" as const,
      },
    ],
    defaultValue: options.defaultSelections?.workflowLearning ?? "suggest",
  });

  const optionalCapabilities = await chooseOptionalCapabilities(prompt, language, options.defaultSelections);
  const launchSelected = workspaceTrusted
    ? await promptSetupChoice(prompt, {
        title: setupCopyText(language, "onboarding.launch.preferenceTitle"),
        message: `${setupCopyText(language, "onboarding.launch")}\n`,
        choices: [
          {
            id: "skip",
            label: setupCopyText(language, "onboarding.launch.skipAction.label"),
            description: setupCopyText(language, "onboarding.launch.skipAction.description"),
            value: false,
          },
          {
            id: "offer",
            label: setupCopyText(language, "onboarding.launch.offerAction.label"),
            description: setupCopyText(language, "onboarding.launch.offerAction.description"),
            value: true,
          },
        ],
        defaultValue: options.defaultSelections?.launchSelected ?? false,
      })
    : false;

  const selections: FirstRunOnboardingSelections = {
    language,
    interfaceFlavor: interfaceChoice.flavor,
    activityLabels: interfaceChoice.activityLabels,
    workspaceRoot,
    workspaceTrusted,
    primaryProvider,
    primaryModel,
    primaryBaseUrl,
    primaryContextWindowTokens,
    primaryApiMode,
    primaryAuthMethod,
    primaryCredential,
    securityMode,
    workflowLearning,
    optionalCapabilities,
    optionalCapabilitiesSkipped: optionalCapabilities.length === 0,
    verifySelected: true,
    launchSelected,
  };

  const profileId = options.profileId ?? readActiveProfile({ homeDir: options.homeDir }).profileId ?? defaultProfileId();
  const wizardState = onboardingWizardStateFromSelections(selections, credentialStatus);
  const draftBundle = buildOnboardingWizardDraftBundle(wizardState, {
    configPath: resolveProfileStateHome({ homeDir: options.homeDir, profileId }).configPath,
    workspaceRoot,
    trustStorePath: stateHome.trustJsonPath,
  });
  const reviewManifest = buildSetupReviewManifest([draftBundle]);
  const summaryText = renderOnboardingWizardSummary(wizardState);
  write(options, `${summaryText}\n`);

  const reviewAccepted = await promptSetupChoice(prompt, {
    title: setupCopyText(language, "onboarding.summary.confirmTitle"),
    message: `${summaryText}\n\n${setupCopyText(language, "onboarding.summary.confirmMessage")}\n`,
    choices: [
      {
        id: "confirm",
        label: setupCopyText(language, "onboarding.summary.confirmAction"),
        description: setupCopyText(language, "setupApply.review.approved"),
        value: true,
      },
      {
        id: "cancel",
        label: setupCopyText(language, "onboarding.summary.cancelAction"),
        description: setupCopyText(language, "setupApply.review.cancelled"),
        value: false,
      },
    ],
    defaultValue: options.defaultSelections?.reviewAccepted ?? true,
  });

  const finalSelections = {
    ...selections,
    reviewAccepted,
    saveAccepted: reviewAccepted,
  };
  const applyPlanningResult = planSetupApply(reviewAccepted
    ? { kind: "approved-review-result", manifest: reviewManifest }
    : { kind: "cancelled-review-result", manifest: reviewManifest, reason: "User cancelled summary confirmation." });
  const applyEndState = applyPlanningResult.kind === "apply-plan-ready" && options.applyExecutor !== undefined
    ? await executeSetupApplyPlan(applyPlanningResult.applyPlan, options.applyExecutor, {
        ...options.applyFlowOptions,
        ...(pendingCredentialWrite !== undefined
          ? { deferredSecretWrites: [pendingCredentialWrite] }
          : {}),
      })
    : undefined;
  const renderedApplyOutput = applyEndState === undefined
    ? renderSetupApplyPlanningResult(applyPlanningResult, language)
    : renderSetupApplyEndState(applyEndState, language);
  const completed = applyEndState === undefined
    ? applyPlanningResult.kind === "apply-plan-ready"
    : applyEndState.kind !== "blocked" && applyEndState.kind !== "cancelled";
  const output = workspaceTrusted || !completed
    ? renderedApplyOutput
    : setupCopyText(language, "onboarding.workspace.trust.deferredFinal");

  return {
    completed,
    exitCode: completed ? 0 : 1,
    output,
    state,
    selections: finalSelections,
    wizardState,
    draftBundle,
    reviewManifest,
    applyPlanningResult,
    applyEndState,
  };
}

function onboardingWizardStateFromSelections(
  selections: FirstRunOnboardingSelections,
  credentialStatus: OnboardingCredentialSummaryStatus
): OnboardingWizardState {
  const credentialEnvVarName = selections.primaryCredential?.kind === "env"
    ? selections.primaryCredential.name
    : undefined;

  return {
    interfacePreferences: {
      language: selections.language,
      flavor: selections.interfaceFlavor,
      activityLabels: selections.activityLabels,
    },
    workspace: {
      path: selections.workspaceRoot,
      trustStatus: selections.workspaceTrusted === true ? "trusted" : "untrusted",
    },
    primaryRoute: {
      provider: selections.primaryProvider,
      model: selections.primaryModel,
      baseUrl: selections.primaryBaseUrl,
      contextWindowTokens: selections.primaryContextWindowTokens,
      apiMode: selections.primaryApiMode,
      authMethod: selections.primaryAuthMethod,
    },
    credential: {
      status: credentialStatus,
      envVarName: credentialEnvVarName,
    },
    securityMode: selections.securityMode,
    agentEvolution: selections.workflowLearning,
    optionalCapabilities: {
      selected: selections.optionalCapabilities ?? [],
      channels: {
        telegram: selections.optionalCapabilities?.includes("channels") === true ? "configured" : "not_set",
      },
      voice: {
        stt: selections.optionalCapabilities?.includes("voice") === true ? "configured" : "not_set",
        tts: selections.optionalCapabilities?.includes("voice") === true ? "configured" : "not_set",
      },
      browser: selections.optionalCapabilities?.includes("browser") === true ? "configured" : "not_set",
    },
    launchSelected: selections.launchSelected,
  };
}

async function promptForWorkspaceAndTrust(
  options: FirstRunSetupRunnerOptions,
  language: SetupCopyLocale
): Promise<{
  readonly workspaceRoot: string;
  readonly workspaceTrusted: boolean;
}> {
  while (true) {
    const workspaceRoot = await promptForCanonicalWorkspaceRoot(options, language);
    const action = await promptSetupChoice<WorkspaceTrustAction>(options.prompt, {
      title: setupCopyText(language, "onboarding.workspace.trust.title"),
      message: `${formatSetupCopy(language, "onboarding.workspace.trust", { workspacePath: workspaceRoot })}\n`,
      choices: [
        {
          id: "trust",
          label: setupCopyText(language, "onboarding.workspace.trustAction.label"),
          description: setupCopyText(language, "onboarding.workspace.trustAction.description"),
          value: "trust",
        },
        {
          id: "change-workspace",
          label: setupCopyText(language, "onboarding.workspace.changeWorkspaceAction.label"),
          description: setupCopyText(language, "onboarding.workspace.changeWorkspaceAction.description"),
          value: "change-workspace",
        },
        {
          id: "decide-later",
          label: setupCopyText(language, "onboarding.workspace.deferTrustAction.label"),
          description: setupCopyText(language, "onboarding.workspace.deferTrustAction.description"),
          value: "decide-later",
        },
      ],
      defaultValue: options.defaultSelections?.workspaceTrusted === false ? "decide-later" : "trust",
    });

    if (action === "change-workspace") {
      continue;
    }

    return {
      workspaceRoot,
      workspaceTrusted: action === "trust",
    };
  }
}

async function promptForCanonicalWorkspaceRoot(
  options: FirstRunSetupRunnerOptions,
  language: SetupCopyLocale
): Promise<string> {
  let defaultWorkspaceRoot = options.defaultSelections?.workspaceRoot ?? options.workspaceRoot;

  while (true) {
    await showSetupCard(options.prompt, language, {
      title: setupCopyText(language, "onboarding.workspace.title"),
      bodyLines: [setupCopyText(language, "onboarding.workspace.root")],
      technicalLines: [defaultWorkspaceRoot],
      options: [{ id: "workspace", label: defaultWorkspaceRoot, technical: true }],
    });
    const requestedWorkspaceRoot = await promptSetupStringWithDefault(
      options.prompt,
      `${setupCopyText(language, "onboarding.workspace.root")} [${defaultWorkspaceRoot}]: `,
      defaultWorkspaceRoot
    );
    const validation = await validateOnboardingWorkspacePath(requestedWorkspaceRoot);
    if (validation.ok) {
      return validation.canonicalPath;
    }

    write(options, `${validation.message}\n`);
    const action = await promptSetupChoice<OnboardingInvalidWorkspaceAction>(options.prompt, {
      title: setupCopyText(language, "onboarding.workspace.invalid.title"),
      message: `${validation.message}\n`,
      choices: [
        {
          id: "try-again",
          label: setupCopyText(language, "onboarding.workspace.invalid.tryAgain"),
          value: "try-again",
        },
        {
          id: "use-current",
          label: setupCopyText(language, "onboarding.workspace.invalid.useCurrent"),
          value: "use-current",
        },
        {
          id: "cancel",
          label: setupCopyText(language, "onboarding.workspace.invalid.cancel"),
          value: "cancel",
        },
      ],
      defaultValue: "try-again",
    });

    if (action === "cancel") {
      throw new Error("Setup cancelled during workspace selection.");
    }

    if (action === "use-current") {
      const currentValidation = await validateOnboardingWorkspacePath(options.workspaceRoot);
      if (currentValidation.ok) {
        return currentValidation.canonicalPath;
      }
      write(options, `${currentValidation.message}\n`);
      defaultWorkspaceRoot = options.workspaceRoot;
      continue;
    }

    defaultWorkspaceRoot = requestedWorkspaceRoot;
  }
}

async function createDefaultFlowEngine(options: CollectSetupEntryStateOptions): Promise<FlowEngine> {
  const loaded = await loadRuntimeConfig(options);
  const flow = await createProviderModelSelectionFlow({
    config: loaded.config,
    providerRegistry: loaded.providerRegistry,
    homeDir: options.homeDir,
    allowNetwork: false,
    mode: "setup",
  });

  return flow;
}

async function chooseOptionalCapabilities(
  prompt: Prompt,
  locale: SetupCopyLocale,
  defaultSelections: FirstRunOnboardingSelections | undefined
): Promise<readonly OptionalCapabilityId[]> {
  const selected = new Set(defaultSelections?.optionalCapabilities ?? []);
  const result: OptionalCapabilityId[] = [];

  for (const capabilityId of OPTIONAL_CAPABILITY_IDS) {
    const capabilityCopy = OPTIONAL_CAPABILITY_COPY_KEYS[capabilityId];
    const title = setupCopyText(locale, capabilityCopy.title);
    const enabled = await promptSetupChoice(prompt, {
      title,
      message: `${formatSetupCopy(locale, "onboarding.optionalCapabilities.promptCapability", {
        capabilityId: title,
      })}\n`,
      choices: [
        {
          id: "enable",
          label: setupCopyText(locale, "onboarding.optionalCapabilities.enable"),
          description: formatSetupCopy(locale, "onboarding.optionalCapabilities.enableDescription", { capabilityId: title }),
          value: true,
        },
        {
          id: "skip",
          label: setupCopyText(locale, "onboarding.optionalCapabilities.skip"),
          description: formatSetupCopy(locale, "setupValidation.capability.skipped", { capabilityId: title }),
          value: false,
        },
      ],
      defaultValue: selected.has(capabilityId),
    });
    if (enabled) {
      result.push(capabilityId);
    }
  }

  return result;
}

function write(options: FirstRunSetupRunnerOptions, value: string): void {
  options.output?.write(value);
}
