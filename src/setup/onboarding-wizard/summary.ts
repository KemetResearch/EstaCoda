import type {
  OnboardingCredentialSummaryStatus,
  OnboardingOptionalCapabilitySummaryStatus,
  OnboardingWizardState,
  OnboardingWorkspaceTrustStatus,
} from "./state.js";

const NOT_SET_LABEL = "Not set";

export function renderOnboardingWizardSummary(state: OnboardingWizardState): string {
  const interfacePreferences = state.interfacePreferences;
  const workspace = state.workspace;
  const primaryRoute = state.primaryRoute;
  const optionalCapabilities = state.optionalCapabilities;

  return [
    "Configuration summary",
    `Workspace: ${workspace?.path ?? NOT_SET_LABEL} (${workspaceTrustStatusLabel(workspace?.trustStatus)})`,
    `Language: ${interfacePreferences?.language ?? NOT_SET_LABEL}`,
    `Interface/style: ${interfacePreferences?.flavor ?? NOT_SET_LABEL}`,
    `Activity labels: ${interfacePreferences?.activityLabels ?? NOT_SET_LABEL}`,
    `Primary Provider: ${primaryRoute?.provider ?? NOT_SET_LABEL}`,
    `Model: ${primaryRoute?.model ?? NOT_SET_LABEL}`,
    `Credential status: ${credentialSummaryStatusLabel(state.credential?.status)}`,
    `Security Mode: ${state.securityMode ?? NOT_SET_LABEL}`,
    `Agent Evolution: ${state.agentEvolution ?? NOT_SET_LABEL}`,
    "Optional Capabilities:",
    `  - Channels / Telegram: ${optionalCapabilityStatusLabel(optionalCapabilities?.channels?.telegram)}`,
    `  - Voice STT: ${optionalCapabilityStatusLabel(optionalCapabilities?.voice?.stt)}`,
    `  - Voice TTS: ${optionalCapabilityStatusLabel(optionalCapabilities?.voice?.tts)}`,
    `  - Browser: ${optionalCapabilityStatusLabel(optionalCapabilities?.browser)}`,
  ].join("\n");
}

export function credentialSummaryStatusLabel(status: OnboardingCredentialSummaryStatus | undefined): string {
  switch (status) {
    case "existing_detected":
      return "Existing credential detected";
    case "new_pending":
      return "New credential pending";
    case "not_set":
    case undefined:
      return NOT_SET_LABEL;
  }
}

export function optionalCapabilityStatusLabel(status: OnboardingOptionalCapabilitySummaryStatus | undefined): string {
  switch (status) {
    case "configured":
      return "Configured";
    case "not_set":
    case undefined:
      return NOT_SET_LABEL;
  }
}

export function workspaceTrustStatusLabel(status: OnboardingWorkspaceTrustStatus | undefined): string {
  switch (status) {
    case "trusted":
      return "trusted";
    case "untrusted":
    case undefined:
      return "untrusted";
  }
}
