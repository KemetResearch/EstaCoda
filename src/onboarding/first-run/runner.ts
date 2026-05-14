import { resolveStateHome } from "../../config/state-home.js";
import {
  loadRuntimeConfig,
  type ActivityLabelsLocale,
  type UiFlavor,
  type UiLanguage,
} from "../../config/runtime-config.js";
import { getDefaultApiKeyEnv } from "../../providers/provider-metadata.js";
import type { ProviderId } from "../../contracts/provider.js";
import type { Prompt } from "../../cli/readline-prompt.js";
import { promptForApiKey } from "../../cli/secret-prompt.js";
import { createModelSelectionCatalog } from "../../providers/model-selection-catalog.js";
import {
  type FirstRunOnboardingSelections,
  type OptionalCapabilityId,
} from "../first-run-plan.js";
import { buildFirstRunDraftBundle, type SetupDraftBundle } from "../setup-drafts.js";
import {
  buildSetupReviewManifest,
  type SetupReviewManifest,
} from "../setup-review-manifest.js";
import {
  executeSetupApplyPlan,
  planSetupApply,
  type SetupApplyEndState,
  type SetupApplyExecutor,
  type SetupApplyFlowOptions,
  type SetupApplyPlanningResult,
} from "../setup-apply-plan.js";
import {
  collectSetupEntryState,
  type CollectSetupEntryStateOptions,
  type SetupEntryState,
} from "../setup-entry-state.js";
import { routeSetupEntryState, type FirstRunPlanSession } from "../setup-router.js";
import type { SetupCopyKey, SetupCopyLocale } from "../setup-copy.js";
import {
  formatSetupCopy,
  promptSetupChoice,
  promptSetupStringWithDefault,
  renderSetupApplyEndState,
  renderSetupApplyPlanningResult,
  renderSetupReviewManifest,
  setupCopyText,
  showSetupCard,
  type SetupChoice,
} from "../setup-prompts.js";

export type FirstRunProviderOption = {
  readonly id: ProviderId;
  readonly label: string;
  readonly description?: string;
  readonly requiresCredential: boolean;
};

export type FirstRunModelOption = {
  readonly provider: ProviderId;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type FirstRunCatalog = {
  readonly listProviders: () => Promise<readonly FirstRunProviderOption[]>;
  readonly listModels: (provider: ProviderId) => Promise<readonly FirstRunModelOption[]>;
};

export type FirstRunSetupRunnerOptions = CollectSetupEntryStateOptions & {
  readonly prompt: Prompt;
  readonly catalog?: FirstRunCatalog;
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
  readonly planSession: FirstRunPlanSession;
  readonly draftBundle: SetupDraftBundle;
  readonly reviewManifest: SetupReviewManifest;
  readonly applyPlanningResult: SetupApplyPlanningResult;
  readonly applyEndState?: SetupApplyEndState;
};

type InterfaceStyleChoice = SetupChoice<{
  readonly flavor: UiFlavor;
  readonly activityLabels: ActivityLabelsLocale;
}> & {
  readonly labelKey: SetupCopyKey;
  readonly descriptionKey: SetupCopyKey;
};

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
  const stateHome = resolveStateHome({ homeDir: options.homeDir });
  const catalog = options.catalog ?? await createDefaultCatalog(options);
  const initialLocale = options.defaultSelections?.language ?? "en";

  await showSetupCard(prompt, initialLocale, {
    title: setupCopyText(initialLocale, "onboarding.welcome.title"),
    bodyLines: [setupCopyText(initialLocale, "onboarding.welcome")],
    options: [{ id: "begin", label: setupCopyText(initialLocale, "onboarding.common.begin") }],
  });

  const language = await promptSetupChoice(prompt, {
    title: setupCopyText(initialLocale, "onboarding.interfaceLanguage.title"),
    message: `${setupCopyText(initialLocale, "onboarding.interfaceLanguage")}\n`,
    choices: [
      {
        id: "en",
        label: setupCopyText(initialLocale, "onboarding.interfaceLanguage.options.en.label"),
        description: setupCopyText(initialLocale, "onboarding.interfaceLanguage.options.en.description"),
        value: "en" as const,
      },
      {
        id: "ar",
        label: setupCopyText(initialLocale, "onboarding.interfaceLanguage.options.ar.label"),
        description: setupCopyText(initialLocale, "onboarding.interfaceLanguage.options.ar.description"),
        value: "ar" as const,
      },
    ],
    defaultValue: options.defaultSelections?.language ?? "en",
  });

  const interfaceChoices = interfaceStyleChoices(language);
  const defaultInterfaceChoice = interfaceChoices.find((choice) =>
    choice.value.flavor === options.defaultSelections?.interfaceFlavor
  )?.value ?? interfaceChoices[0]!.value;
  const interfaceChoice = await promptSetupChoice(prompt, {
    title: setupCopyText(language, "onboarding.interfaceStyle.title"),
    message: `${setupCopyText(language, "onboarding.interfaceStyle.prompt")}\n`,
    choices: interfaceChoices.map((choice) => ({
      ...choice,
      label: setupCopyText(language, choice.labelKey),
      description: setupCopyText(language, choice.descriptionKey),
    })),
    defaultValue: defaultInterfaceChoice,
  });

  await showSetupCard(prompt, language, {
    title: setupCopyText(language, "onboarding.workspace.title"),
    bodyLines: [setupCopyText(language, "onboarding.workspace.root")],
    technicalLines: [options.workspaceRoot],
    options: [{ id: "workspace", label: options.workspaceRoot, technical: true }],
  });
  const workspaceRoot = await promptSetupStringWithDefault(
    prompt,
    `${setupCopyText(language, "onboarding.workspace.root")} [${options.workspaceRoot}]: `,
    options.defaultSelections?.workspaceRoot ?? options.workspaceRoot
  );

  const workspaceTrusted = await promptSetupChoice(prompt, {
    title: setupCopyText(language, "onboarding.workspace.trust.title"),
    message: `${setupCopyText(language, "onboarding.workspace.trust")}\n`,
    choices: [
      {
        id: "trust",
        label: setupCopyText(language, "onboarding.workspace.trustAction.label"),
        description: setupCopyText(language, "onboarding.workspace.trustAction.description"),
        value: true,
      },
      {
        id: "skip",
        label: setupCopyText(language, "onboarding.workspace.deferTrustAction.label"),
        description: setupCopyText(language, "onboarding.workspace.deferTrustAction.description"),
        value: false,
      },
    ],
    defaultValue: options.defaultSelections?.workspaceTrusted ?? true,
  });

  const providerOptions = await catalog.listProviders();
  const primaryProvider = await promptSetupChoice(prompt, {
    title: setupCopyText(language, "onboarding.providers.primary.title"),
    message: `${setupCopyText(language, "onboarding.providers.primary")}\n`,
    choices: providerOptions.map((provider) => ({
      id: provider.id,
      label: provider.label,
      description: provider.description,
      value: provider.id,
    })),
    defaultValue: options.defaultSelections?.primaryProvider ?? providerOptions[0]?.id,
  });

  const modelOptions = await catalog.listModels(primaryProvider);
  const primaryModel = await promptSetupChoice(prompt, {
    title: setupCopyText(language, "onboarding.providers.primaryModel.title"),
    message: `${setupCopyText(language, "onboarding.providers.primaryModel").replace("{providerId}", primaryProvider)}\n`,
    choices: modelOptions.map((model) => ({
      id: model.id,
      label: model.label,
      description: model.description,
      value: model.id,
    })),
    defaultValue: options.defaultSelections?.primaryModel ?? modelOptions[0]?.id,
  });

  const providerRequiresCredential = providerOptions.find((provider) => provider.id === primaryProvider)?.requiresCredential ?? primaryProvider !== "local";
  const defaultEnvVar = getDefaultApiKeyEnv(primaryProvider);
  const primaryCredential = providerRequiresCredential
    ? {
        kind: "env" as const,
        name: defaultEnvVar,
      }
    : { kind: "none" as const };

  if (providerRequiresCredential) {
    const promptResult = await promptForApiKey({
      prompt,
      providerId: primaryProvider,
      envVarName: defaultEnvVar,
      homeDir: options.homeDir,
      question: `${setupCopyText(language, "onboarding.providers.primaryCredential")} [${defaultEnvVar}]: `,
    });

    if (promptResult.kind === "skipped") {
      write(options, `Config will expect ${defaultEnvVar} to be available externally.\n`);
    }
  } else {
    write(options, `${setupCopyText(language, "onboarding.providers.primaryCredential.localProviderSkip")}\n`);
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
  const launchSelected = await promptSetupChoice(prompt, {
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
  });

  const selections: FirstRunOnboardingSelections = {
    language,
    interfaceFlavor: interfaceChoice.flavor,
    activityLabels: interfaceChoice.activityLabels,
    workspaceRoot,
    workspaceTrusted,
    primaryProvider,
    primaryModel,
    primaryCredential,
    securityMode,
    workflowLearning,
    optionalCapabilities,
    optionalCapabilitiesSkipped: optionalCapabilities.length === 0,
    verifySelected: true,
    launchSelected,
  };

  const routeDecision = routeSetupEntryState(state, {
    selection: "run-first-run",
    firstRunSelections: selections,
  });
  if (routeDecision.firstRunPlanSession === undefined) {
    throw new Error("Setup router did not produce a first-run plan session.");
  }

  const draftBundle = buildFirstRunDraftBundle(routeDecision.firstRunPlanSession, {
    configPath: options.userConfigPath ?? stateHome.configPath,
    workspaceRoot,
    trustStorePath: stateHome.trustJsonPath,
  });
  const reviewManifest = buildSetupReviewManifest([draftBundle]);
  const reviewText = renderSetupReviewManifest(reviewManifest, language);
  write(options, `${setupCopyText(language, "onboarding.review")}\n${reviewText}\n`);

  const reviewAccepted = await promptSetupChoice(prompt, {
    title: setupCopyText(language, "onboarding.review"),
    message: `${setupCopyText(language, "onboarding.review.validation.accepted")}\n`,
    choices: [
      {
        id: "approve",
        label: setupCopyText(language, "onboarding.review.approveAction"),
        description: setupCopyText(language, "setupApply.review.approved"),
        value: true,
      },
      {
        id: "cancel",
        label: setupCopyText(language, "onboarding.review.cancelAction"),
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
    : { kind: "cancelled-review-result", manifest: reviewManifest, reason: "User cancelled review." });
  const applyEndState = applyPlanningResult.kind === "apply-plan-ready" && options.applyExecutor !== undefined
    ? await executeSetupApplyPlan(applyPlanningResult.applyPlan, options.applyExecutor, options.applyFlowOptions)
    : undefined;
  const output = applyEndState === undefined
    ? renderSetupApplyPlanningResult(applyPlanningResult, language)
    : renderSetupApplyEndState(applyEndState, language);
  const completed = applyEndState === undefined
    ? applyPlanningResult.kind === "apply-plan-ready"
    : applyEndState.kind !== "blocked" && applyEndState.kind !== "cancelled";

  return {
    completed,
    exitCode: completed ? 0 : 1,
    output,
    state,
    selections: finalSelections,
    planSession: routeDecision.firstRunPlanSession,
    draftBundle,
    reviewManifest,
    applyPlanningResult,
    applyEndState,
  };
}

async function createDefaultCatalog(options: CollectSetupEntryStateOptions): Promise<FirstRunCatalog> {
  const loaded = await loadRuntimeConfig(options);
  const catalog = await createModelSelectionCatalog({
    config: loaded.config,
    providerRegistry: loaded.providerRegistry,
    homeDir: options.homeDir,
    allowNetwork: false,
  });

  return {
    listProviders: async () => {
      const providers = (await catalog.listProviders()).filter((provider) => provider.id !== "unconfigured");
      return providers.map((provider) => ({
        id: provider.id,
        label: provider.name,
        description: provider.catalogOnly
          ? setupCopyText("en", "onboarding.catalog.provider.catalogOnly")
          : provider.configured
            ? setupCopyText("en", "onboarding.catalog.provider.configured")
            : setupCopyText("en", "onboarding.catalog.provider.available"),
        requiresCredential: provider.setupMode !== "none" && provider.id !== "local",
      }));
    },
    listModels: async (providerId) => {
      const models = (await catalog.listModels({ provider: providerId, includeBeta: true }))
        .filter((model) => model.id !== "unconfigured");
      return models.map((model) => ({
        provider: model.provider,
        id: model.id,
        label: model.id,
        description: [
          model.profile.supportsTools ? setupCopyText("en", "onboarding.catalog.model.features.tools") : undefined,
          model.profile.supportsVision ? setupCopyText("en", "onboarding.catalog.model.features.vision") : undefined,
          model.profile.supportsReasoning ? setupCopyText("en", "onboarding.catalog.model.features.reasoning") : undefined,
          model.profile.status !== undefined ? model.profile.status : undefined,
        ].filter((part): part is string => part !== undefined).join(", "),
      }));
    },
  };
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

function interfaceStyleChoices(language: UiLanguage): readonly InterfaceStyleChoice[] {
  if (language === "ar") {
    return [
      {
        id: "arabic-light",
        label: "",
        labelKey: "onboarding.interfaceStyle.arabicLight.label",
        description: "",
        descriptionKey: "onboarding.interfaceStyle.arabicLight.description",
        value: { flavor: "arabic-light", activityLabels: "ar" },
      },
      {
        id: "standard",
        label: "",
        labelKey: "onboarding.interfaceStyle.standard.label",
        description: "",
        descriptionKey: "onboarding.interfaceStyle.arabicStandard.description",
        value: { flavor: "standard", activityLabels: "ar" },
      },
    ];
  }

  return [
    {
      id: "standard",
      label: "",
      labelKey: "onboarding.interfaceStyle.standard.label",
      description: "",
      descriptionKey: "onboarding.interfaceStyle.standard.description",
      value: { flavor: "standard", activityLabels: "en" },
    },
    {
      id: "arabic-light",
      label: "",
      labelKey: "onboarding.interfaceStyle.arabicLight.label",
      description: "",
      descriptionKey: "onboarding.interfaceStyle.englishArabicLight.description",
      value: { flavor: "arabic-light", activityLabels: "en" },
    },
  ];
}

function write(options: FirstRunSetupRunnerOptions, value: string): void {
  options.output?.write(value);
}
