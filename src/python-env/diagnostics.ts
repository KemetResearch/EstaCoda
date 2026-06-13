import { redactString } from "../utils/redaction.js";

const DEFAULT_DIAGNOSTIC_LIMIT_CHARS = 1_200;
const PYTHON_ENV_SECRET_ASSIGNMENT_PATTERN =
  /\b((?=[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASS|PRIVATE[_-]?KEY|ACCESS[_-]?KEY))[A-Z][A-Z0-9_]*\s*=\s*)(['"]?)[^\s'"]+\2/gu;

export function redactPythonEnvDiagnostic(text: string): string {
  const withoutAuthorizationHeaders = text
    .replace(/\bauthorization\s*:\s*[^\r\n]+/giu, "Authorization: [REDACTED]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(PYTHON_ENV_SECRET_ASSIGNMENT_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`);
  return redactString(withoutAuthorizationHeaders, { strict: true, additionalKeys: ["key"] });
}

export function boundDiagnostic(text: string, maxChars = DEFAULT_DIAGNOSTIC_LIMIT_CHARS): string {
  const redacted = redactPythonEnvDiagnostic(text);
  if (redacted.length <= maxChars) {
    return redacted;
  }
  return `${redacted.slice(0, maxChars)}...[truncated]`;
}
