import { redactString } from "../utils/redaction.js";

const DEFAULT_DIAGNOSTIC_LIMIT_CHARS = 1_200;

export function redactPythonEnvDiagnostic(text: string): string {
  return redactString(text, { strict: true, additionalKeys: ["key"] });
}

export function boundDiagnostic(text: string, maxChars = DEFAULT_DIAGNOSTIC_LIMIT_CHARS): string {
  const redacted = redactPythonEnvDiagnostic(text);
  if (redacted.length <= maxChars) {
    return redacted;
  }
  return `${redacted.slice(0, maxChars)}...[truncated]`;
}
