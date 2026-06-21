import type { Prompt } from "../cli/readline-prompt.js";
import type { SelectPromptInput } from "../cli/interactive-select.js";
import type {
  FlowEngine,
  ModelCandidate,
  ProviderCandidate,
  ProviderModelSelectionResult,
} from "../providers/provider-model-selection-flow.js";
import type { ProviderId, ModelProfile } from "../contracts/provider.js";
import {
  setupCopyText,
} from "./setup-prompts.js";
import type { SetupCopyLocale } from "./setup-copy.js";

export type ProviderModelRoutePromptMode =
  | "primary"
  | "fallback"
  | "auxiliary"
  | "onboarding";

export type SelectProviderModelRouteOptions = {
  readonly prompt: Prompt;
  readonly flowEngine: FlowEngine;
  readonly locale: SetupCopyLocale;
  readonly currentProviderId?: string;
  readonly currentModelId?: string;
  readonly allowBack?: boolean;
  readonly allowCancel?: boolean;
  readonly mode: ProviderModelRoutePromptMode;
};

export type ProviderModelPromptResult =
  | { readonly kind: "selected"; readonly selection: ProviderModelSelectionResult }
  | { readonly kind: "back" }
  | { readonly kind: "cancel" }
  | { readonly kind: "diagnostic"; readonly output: string };

type ProviderPromptAction =
  | { readonly kind: "provider"; readonly provider: ProviderCandidate }
  | { readonly kind: "back" }
  | { readonly kind: "cancel" };

type ModelPromptAction =
  | { readonly kind: "model"; readonly model: ModelCandidate }
  | { readonly kind: "back" }
  | { readonly kind: "cancel" };

const PROMPT_HINT = "↑↓ navigate   ENTER select";

export async function selectProviderModelRoute(
  options: SelectProviderModelRouteOptions
): Promise<ProviderModelPromptResult> {
  const providers = await options.flowEngine.listProviderCandidates();
  if (providers.length === 0) {
    return { kind: "diagnostic", output: "No setup-visible provider candidates are available." };
  }

  const providerAction = await promptProvider(options, providers);
  if (providerAction.kind === "back" || providerAction.kind === "cancel") {
    return { kind: providerAction.kind };
  }

  const provider = providerAction.provider;
  const models = await options.flowEngine.listModelCandidates(provider.id);
  if (models.length === 0) {
    return { kind: "diagnostic", output: `No setup-visible models are available for ${provider.displayName}.` };
  }

  const modelAction = await promptModel(options, provider, models);
  if (modelAction.kind === "back" || modelAction.kind === "cancel") {
    return { kind: modelAction.kind };
  }

  const resolved = await options.flowEngine.resolveSelection(provider.id, modelAction.model.id);
  if (resolved.kind === "diagnostic") {
    return { kind: "diagnostic", output: `Provider/model selection failed: ${resolved.reason}` };
  }

  return { kind: "selected", selection: resolved };
}

async function promptProvider(
  options: SelectProviderModelRouteOptions,
  candidates: readonly ProviderCandidate[]
): Promise<ProviderPromptAction> {
  const promptOptions: Array<SelectPromptInput<ProviderPromptAction>["options"][number]> = [
    ...candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.displayName,
      value: { kind: "provider" as const, provider: candidate },
      cells: {
        name: candidate.displayName,
        details: providerDetails(candidate),
      },
    })),
    ...navigationOptions<ProviderPromptAction>(options),
  ];

  return selectStructuredOption(options.prompt, {
    title: providerTitle(options.locale, options.mode),
    body: `${providerBody(options.locale, options.mode)}\n`,
    columns: promptColumns(options.locale),
    options: promptOptions,
    defaultIndex: 0,
    fallbackPrompt: "Choose: ",
    surface: "promptCard",
    hint: PROMPT_HINT,
    locale: options.locale,
    direction: options.locale === "ar" ? "rtl" : "ltr",
  });
}

async function promptModel(
  options: SelectProviderModelRouteOptions,
  provider: ProviderCandidate,
  candidates: readonly ModelCandidate[]
): Promise<ModelPromptAction> {
  const promptOptions: Array<SelectPromptInput<ModelPromptAction>["options"][number]> = [
    ...candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.id,
      value: { kind: "model" as const, model: candidate },
      cells: {
        name: candidate.id,
        details: modelDetails(options.locale, candidate),
      },
    })),
    ...navigationOptions<ModelPromptAction>(options),
  ];

  return selectStructuredOption(options.prompt, {
    title: modelTitle(options.locale, options.mode),
    body: `${modelBody(options.locale, options.mode).replace("{providerId}", provider.id)}\n`,
    columns: promptColumns(options.locale),
    options: promptOptions,
    defaultIndex: 0,
    fallbackPrompt: "Choose: ",
    surface: "promptCard",
    hint: PROMPT_HINT,
    locale: options.locale,
    direction: options.locale === "ar" ? "rtl" : "ltr",
  });
}

async function selectStructuredOption<T>(
  prompt: Prompt,
  input: SelectPromptInput<T>
): Promise<T> {
  if (prompt.select !== undefined) {
    return prompt.select(input);
  }

  const options = input.options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");
  const raw = await prompt(`${input.body ?? ""}${options}\n${input.fallbackPrompt}`);
  const selectedIndex = Number.parseInt(raw.trim(), 10) - 1;
  return input.options[selectedIndex]?.value ?? input.options[input.defaultIndex ?? 0]?.value ?? input.options[0]!.value;
}

function navigationOptions<T extends { readonly kind: string }>(
  options: SelectProviderModelRouteOptions
): Array<SelectPromptInput<T>["options"][number]> {
  const rows: Array<SelectPromptInput<T>["options"][number]> = [];
  if (options.allowBack === true) {
    rows.push({
      id: "back",
      label: backLabel(options.locale),
      value: { kind: "back" } as T,
      cells: {
        name: backLabel(options.locale),
        details: backDetails(options.locale),
      },
    });
  }
  if (options.allowCancel === true) {
    rows.push({
      id: "cancel",
      label: setupCopyText(options.locale, "onboarding.review.cancelAction"),
      value: { kind: "cancel" } as T,
      cells: {
        name: setupCopyText(options.locale, "onboarding.review.cancelAction"),
        details: cancelDetails(options.locale),
      },
    });
  }
  return rows;
}

function promptColumns(locale: SetupCopyLocale): SelectPromptInput<unknown>["columns"] {
  return [
    { key: "name", header: locale === "ar" ? "الاسم" : "Name" },
    { key: "details", header: locale === "ar" ? "التفاصيل" : "Details" },
  ];
}

function providerDetails(candidate: ProviderCandidate): string {
  return candidate.baseUrl
    ? `${candidate.baseUrl} (${candidate.modelsCount} ${modelCountLabel(candidate.modelsCount)})`
    : `${candidate.modelsCount} ${modelCountLabel(candidate.modelsCount)}`;
}

function modelDetails(locale: SetupCopyLocale, candidate: ModelCandidate): string {
  return [
    candidate.profile.supportsTools ? setupCopyText(locale, "onboarding.catalog.model.features.tools") : undefined,
    candidate.profile.supportsVision ? setupCopyText(locale, "onboarding.catalog.model.features.vision") : undefined,
    candidate.profile.supportsReasoning ? setupCopyText(locale, "onboarding.catalog.model.features.reasoning") : undefined,
    renderableModelStatus(candidate.profile.status),
  ].filter((part): part is string => part !== undefined).join(", ");
}

function renderableModelStatus(status: ModelProfile["status"]): ModelProfile["status"] | undefined {
  return status === "alpha" || status === "beta" || status === "deprecated" ? status : undefined;
}

function modelCountLabel(count: number): string {
  return count === 1 ? "model" : "models";
}

function providerTitle(locale: SetupCopyLocale, mode: ProviderModelRoutePromptMode): string {
  if (mode === "fallback") return locale === "ar" ? "المزوّد الاحتياطي" : "Fallback provider";
  if (mode === "auxiliary") return locale === "ar" ? "المزوّد المساعد" : "Auxiliary provider";
  return setupCopyText(locale, "onboarding.providers.primary.title");
}

function providerBody(locale: SetupCopyLocale, mode: ProviderModelRoutePromptMode): string {
  if (mode === "fallback") return locale === "ar" ? "اختر مزوّدًا احتياطيًا." : "Choose a fallback provider.";
  if (mode === "auxiliary") return locale === "ar" ? "اختر مزوّدًا مساعدًا." : "Choose an auxiliary provider.";
  return setupCopyText(locale, "onboarding.providers.primary");
}

function modelTitle(locale: SetupCopyLocale, mode: ProviderModelRoutePromptMode): string {
  if (mode === "fallback") return locale === "ar" ? "النموذج الاحتياطي" : "Fallback model";
  if (mode === "auxiliary") return locale === "ar" ? "النموذج المساعد" : "Auxiliary model";
  return setupCopyText(locale, "onboarding.providers.primaryModel.title");
}

function modelBody(locale: SetupCopyLocale, mode: ProviderModelRoutePromptMode): string {
  if (mode === "fallback") return locale === "ar" ? "اختر النموذج الاحتياطي للمزوّد {providerId}." : "Choose the fallback model for {providerId}.";
  if (mode === "auxiliary") return locale === "ar" ? "اختر النموذج المساعد للمزوّد {providerId}." : "Choose the auxiliary model for {providerId}.";
  return setupCopyText(locale, "onboarding.providers.primaryModel");
}

function backLabel(locale: SetupCopyLocale): string {
  return locale === "ar" ? "رجوع" : "Back";
}

function backDetails(locale: SetupCopyLocale): string {
  return locale === "ar" ? "ارجع إلى البطاقة السابقة." : "Return to the previous card.";
}

function cancelDetails(locale: SetupCopyLocale): string {
  return locale === "ar" ? "اخرج بدون تغيير الإعداد." : "Exit without changing setup.";
}
