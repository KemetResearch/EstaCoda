import type { ProviderExecutionResult } from "./provider-executor.js";

export function summarizeProviderFailure(execution: ProviderExecutionResult): string {
  if (execution.attempts.length === 0) {
    return "No configured provider route was available for this request.";
  }

  const last = execution.attempts[execution.attempts.length - 1];
  const attempts = execution.attempts
    .map((attempt) => `${attempt.provider}/${attempt.model} (${humanProviderIssue(attempt.errorClass)})`)
    .join(", ");

  return `The configured model path did not complete. Last issue: ${humanProviderIssue(last?.errorClass)}. Attempts: ${attempts}.`;
}

export function humanProviderIssue(errorClass: string | undefined): string {
  switch (errorClass) {
    case "auth":
      return "authentication needs attention";
    case "rate-limit":
      return "rate limited";
    case "quota":
      return "quota or billing limit";
    case "network":
      return "network issue";
    case "server":
      return "provider server issue";
    case "model-unavailable":
      return "model unavailable";
    case "timeout":
      return "timed out";
    case undefined:
      return "unknown provider issue";
    default:
      return errorClass;
  }
}
