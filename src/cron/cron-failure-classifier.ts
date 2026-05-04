export type CronFailureClass =
  | "script_error"
  | "timeout"
  | "delivery_error"
  | "lock_error"
  | "config_error"
  | "runtime_error"
  | "provider_error"
  | "unknown_error";

export type ClassifiedCronFailure = {
  class: CronFailureClass;
  message: string;
  recoverable: boolean;
};

export function classifyCronFailure(input: {
  scriptFailed?: boolean;
  scriptSummary?: string;
  timedOut?: boolean;
  deliveryFailed?: boolean;
  deliveryError?: string;
  lockFailed?: boolean;
  configError?: string;
  runtimeError?: string;
  runtimeErrorMessage?: string;
  providerError?: string;
  providerErrorMessage?: string;
}): ClassifiedCronFailure {
  // Priority order matters: config > lock > script > timeout > delivery > provider > runtime > unknown

  if (input.configError !== undefined) {
    return {
      class: "config_error",
      message: input.configError,
      recoverable: false
    };
  }

  if (input.lockFailed === true) {
    return {
      class: "lock_error",
      message: "Could not acquire job execution lock. Another instance may be running.",
      recoverable: true
    };
  }

  if (input.scriptFailed === true) {
    return {
      class: "script_error",
      message: input.scriptSummary ?? "Script execution failed.",
      recoverable: true
    };
  }

  if (input.timedOut === true) {
    return {
      class: "timeout",
      message: input.scriptSummary ?? "Execution timed out.",
      recoverable: true
    };
  }

  if (input.deliveryFailed === true) {
    return {
      class: "delivery_error",
      message: input.deliveryError ?? "Failed to deliver output to configured target.",
      recoverable: true
    };
  }

  if (input.providerError !== undefined) {
    return {
      class: "provider_error",
      message: input.providerErrorMessage ?? input.providerError,
      recoverable: true
    };
  }

  if (input.runtimeError !== undefined) {
    return {
      class: "runtime_error",
      message: input.runtimeErrorMessage ?? input.runtimeError,
      recoverable: true
    };
  }

  return {
    class: "unknown_error",
    message: "Unclassified cron failure.",
    recoverable: true
  };
}

export function classifyCronScriptFailure(summary: string, timedOut: boolean): ClassifiedCronFailure {
  if (timedOut) {
    return {
      class: "timeout",
      message: summary,
      recoverable: true
    };
  }

  if (
    summary.includes("not found") ||
    summary.includes("unavailable") ||
    summary.includes("extension is not supported")
  ) {
    return {
      class: "config_error",
      message: summary,
      recoverable: false
    };
  }

  return {
    class: "script_error",
    message: summary,
    recoverable: true
  };
}

export function classifyCronDeliveryFailure(errorMessage: string): ClassifiedCronFailure {
  return {
    class: "delivery_error",
    message: errorMessage,
    recoverable: true
  };
}
