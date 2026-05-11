import type { ActivityLabelsLocale, UiFlavor, UiLanguage } from "../config/runtime-config.js";
import type { ProviderId } from "../contracts/provider.js";
import type { ModelSelectionCatalog } from "../providers/model-selection-catalog.js";
import type { OnboardingCopy } from "./onboarding-copy.js";

export type ModelChoice = {
  provider: ProviderId;
  model: string;
  label: string;
  description?: string;
};

export type ProviderChoice = {
  provider: ProviderId;
  label: string;
  description: string;
  models: ModelChoice[];
};

export type InterfaceChoice = {
  language: UiLanguage;
  label: string;
  description: string;
};

export type InterfaceStyleChoice = {
  flavor: UiFlavor;
  activityLabels: ActivityLabelsLocale;
  label: string;
  description: string;
};

export function formatProviderModel(provider: string, model: string): string {
  return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
}

export async function providerChoices(
  catalog: ModelSelectionCatalog,
  copy: OnboardingCopy
): Promise<ProviderChoice[]> {
  const providers = (await catalog.listProviders()).filter((p) => p.id !== "unconfigured");
  const copyCatalog = copy.providers.catalog;

  const result: ProviderChoice[] = [];
  for (const provider of providers) {
    const models = (await catalog.listModels({ provider: provider.id, includeBeta: true }))
      .filter((m) => m.id !== "unconfigured");
    const providerCopy = copyCatalog[provider.id];

    result.push({
      provider: provider.id,
      label: providerCopy?.label ?? provider.name,
      description: providerCopy?.description ?? "",
      models: models.map((model) => {
        const modelCopy = providerCopy?.models?.[model.id];
        return {
          provider: provider.id,
          model: model.id,
          label: modelCopy?.label ?? model.id,
          description: modelCopy?.description
        };
      })
    });
  }

  return result;
}

export function interfaceLanguageChoices(copy: OnboardingCopy): InterfaceChoice[] {
  return [
    {
      language: "en",
      label: copy.interfaceLanguage.options.en.label,
      description: copy.interfaceLanguage.options.en.description
    },
    {
      language: "ar",
      label: copy.interfaceLanguage.options.ar.label,
      description: copy.interfaceLanguage.options.ar.description
    }
  ];
}

export function interfaceStyleChoices(language: UiLanguage, copy: OnboardingCopy): InterfaceStyleChoice[] {
  if (language === "ar") {
    return [
      {
        flavor: "arabic-light",
        activityLabels: "ar",
        label: copy.interfaceStyle.arabicTouch.label,
        description: copy.interfaceStyle.arabicTouch.description
      },
      {
        flavor: "standard",
        activityLabels: "ar",
        label: copy.interfaceStyle.arabicStandard.label,
        description: copy.interfaceStyle.arabicStandard.description
      }
    ];
  }

  return [
    {
      flavor: "standard",
      activityLabels: "en",
      label: copy.interfaceStyle.standard.label,
      description: copy.interfaceStyle.standard.description
    },
    {
      flavor: "arabic-light",
      activityLabels: "en",
      label: copy.interfaceStyle.arabicTouch.label,
      description: copy.interfaceStyle.arabicTouch.description
    }
  ];
}
