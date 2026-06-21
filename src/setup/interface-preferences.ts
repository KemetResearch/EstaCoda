import type { Prompt } from "../cli/readline-prompt.js";
import type { ActivityLabelsLocale, UiFlavor, UiLanguage } from "../config/runtime-config.js";
import type { SetupCopyKey, SetupCopyLocale } from "./setup-copy.js";
import {
  promptSetupChoice,
  setupPromptContext,
  setupCopyText,
  setupCurrentStatusLine,
  setupNavigationChoice,
  type SetupChoice,
} from "./setup-prompts.js";

export type InterfaceStyleChoice = SetupChoice<{
  readonly flavor: UiFlavor;
  readonly activityLabels: ActivityLabelsLocale;
}> & {
  readonly labelKey: SetupCopyKey;
  readonly descriptionKey: SetupCopyKey;
};

export type InterfaceLanguageAndStyleSelection = {
  readonly language: UiLanguage;
  readonly flavor: UiFlavor;
  readonly activityLabels: ActivityLabelsLocale;
};

export type InterfaceLanguageAndStylePromptResult =
  | { readonly kind: "selected"; readonly selection: InterfaceLanguageAndStyleSelection }
  | { readonly kind: "back" };

type InterfaceLanguageAndStylePromptOptions = {
  readonly initialLocale?: SetupCopyLocale;
  readonly currentLanguage?: UiLanguage;
  readonly currentFlavor?: UiFlavor;
  readonly showCurrentState?: boolean;
};

export async function promptInterfaceLanguageAndStyle(
  prompt: Prompt,
  input: InterfaceLanguageAndStylePromptOptions & { readonly allowBack: true }
): Promise<InterfaceLanguageAndStylePromptResult>;
export async function promptInterfaceLanguageAndStyle(
  prompt: Prompt,
  input?: InterfaceLanguageAndStylePromptOptions & { readonly allowBack?: false }
): Promise<InterfaceLanguageAndStyleSelection>;
export async function promptInterfaceLanguageAndStyle(
  prompt: Prompt,
  input: InterfaceLanguageAndStylePromptOptions & { readonly allowBack?: boolean } = {}
): Promise<InterfaceLanguageAndStyleSelection | InterfaceLanguageAndStylePromptResult> {
  const initialLocale = input.initialLocale ?? input.currentLanguage ?? "en";
  const defaultLanguage = input.currentLanguage ?? "en";
  type LanguageChoiceValue = UiLanguage | "back";
  const languageChoices: SetupChoice<LanguageChoiceValue>[] = [
    {
      id: "en",
      label: setupCopyText(initialLocale, "onboarding.interfaceLanguage.options.en.label"),
      description: setupCopyText(initialLocale, "onboarding.interfaceLanguage.options.en.description"),
      value: "en" as const,
      current: input.showCurrentState === true && defaultLanguage === "en",
    },
    {
      id: "ar",
      label: setupCopyText(initialLocale, "onboarding.interfaceLanguage.options.ar.label"),
      description: setupCopyText(initialLocale, "onboarding.interfaceLanguage.options.ar.description"),
      value: "ar" as const,
      current: input.showCurrentState === true && defaultLanguage === "ar",
    },
    ...(input.allowBack === true
      ? [setupNavigationChoice({
          id: "back",
          label: initialLocale === "ar" ? "رجوع" : "Back",
          description: setupCopyText(initialLocale, "onboarding.providers.navigation.back.description"),
          value: "back" as const,
        })]
      : []),
  ];
  const currentLanguageLabel = languageChoices.find((choice) => choice.value === defaultLanguage)?.label;
  const language = await promptSetupChoice(setupPromptContext(prompt, initialLocale), {
    title: setupCopyText(initialLocale, "onboarding.interfaceLanguage.title"),
    message: `${setupCopyText(initialLocale, "onboarding.interfaceLanguage")}\n`,
    statusLines: input.showCurrentState === true && currentLanguageLabel !== undefined
      ? [setupCurrentStatusLine(initialLocale, currentLanguageLabel)]
      : undefined,
    showCurrentBadge: input.showCurrentState === true ? false : undefined,
    choices: languageChoices,
    defaultValue: defaultLanguage,
  });
  if (language === "back") {
    return { kind: "back" };
  }

  const style = defaultInterfacePreferencesForLanguage(language);
  const selection = {
    language,
    flavor: style.flavor,
    activityLabels: style.activityLabels,
  };
  if (input.allowBack === true) {
    return { kind: "selected", selection };
  }
  return selection;
}

function defaultInterfacePreferencesForLanguage(
  language: UiLanguage
): Pick<InterfaceLanguageAndStyleSelection, "flavor" | "activityLabels"> {
  return language === "ar"
    ? { flavor: "arabic-light", activityLabels: "ar" }
    : { flavor: "standard", activityLabels: "en" };
}

export function interfaceStyleChoices(language: UiLanguage): readonly InterfaceStyleChoice[] {
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
