import { redactString } from "../utils/redaction.js";

const DEFAULT_DIAGNOSTIC_LIMIT_CHARS = 1_200;

export function redactPythonEnvDiagnostic(text: string): string {
  const withoutAuthorizationHeaders = text
    .replace(/\bauthorization\s*:\s*[^\r\n]+/giu, "Authorization: [REDACTED]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
  return redactString(withoutAuthorizationHeaders, { strict: true, additionalKeys: ["key"] });
}

export function boundDiagnostic(text: string, maxChars = DEFAULT_DIAGNOSTIC_LIMIT_CHARS): string {
  const redacted = redactPythonEnvDiagnostic(text);
  if (redacted.length <= maxChars) {
    return redacted;
  }
  return `${redacted.slice(0, maxChars)}...[truncated]`;
}
