import type { ActivityLabelsLocale, UiFlavor, UiLanguage } from "../../config/runtime-config.js";
import type { ProviderId } from "../../contracts/provider.js";
import type { SecurityApprovalMode } from "../../contracts/security.js";
import type { SkillAutonomy } from "../../skills/skill-learning.js";

export type OnboardingCredentialSummaryStatus =
  | "not_set"
  | "existing_detected"
  | "new_pending";

export type OnboardingWorkspaceTrustStatus = "trusted" | "untrusted";

export type OnboardingOptionalCapabilitySummaryStatus = "configured" | "not_set";

export type OnboardingInterfacePreferences = {
  readonly language?: UiLanguage;
  readonly flavor?: UiFlavor;
  readonly activityLabels?: ActivityLabelsLocale;
};

export type OnboardingWorkspaceSummary = {
  readonly path?: string;
  readonly trustStatus?: OnboardingWorkspaceTrustStatus;
};

export type OnboardingPrimaryRouteSummary = {
  readonly provider?: ProviderId;
  readonly model?: string;
};

export type OnboardingCredentialSummary = {
  readonly status: OnboardingCredentialSummaryStatus;
};

export type OnboardingOptionalCapabilitySummaries = {
  readonly channels?: {
    readonly telegram?: OnboardingOptionalCapabilitySummaryStatus;
  };
  readonly voice?: {
    readonly stt?: OnboardingOptionalCapabilitySummaryStatus;
    readonly tts?: OnboardingOptionalCapabilitySummaryStatus;
  };
  readonly browser?: OnboardingOptionalCapabilitySummaryStatus;
};

export type OnboardingWizardState = {
  readonly interfacePreferences?: OnboardingInterfacePreferences;
  readonly workspace?: OnboardingWorkspaceSummary;
  readonly primaryRoute?: OnboardingPrimaryRouteSummary;
  readonly credential?: OnboardingCredentialSummary;
  readonly securityMode?: SecurityApprovalMode;
  readonly agentEvolution?: SkillAutonomy;
  readonly optionalCapabilities?: OnboardingOptionalCapabilitySummaries;
};
