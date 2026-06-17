export type CronPromptSurface = "user" | "assembled";

export type CronSafetyAssessment = {
  ok: boolean;
  issues: string[];
  sanitizedText?: string;
  removedCodepoints?: string[];
};

export type CronSafetyResult = CronSafetyAssessment;

const SECRET_REFERENCE_PATTERN = /api[_-]?key|secret|token|password|credential|private\s+key|\.env|id_rsa|id_ed25519/iu;
const INVISIBLE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/u;
const INVISIBLE_CONTROL_GLOBAL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu;

const USER_BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/iu, reason: "prompt-injection instruction override" },
  { pattern: /(?:disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions/iu, reason: "prompt-injection instruction override" },
  { pattern: /exfiltrat/iu, reason: "possible exfiltration verb" },
  { pattern: SECRET_REFERENCE_PATTERN, reason: "credential or secret reference" },
  { pattern: /authorized_keys|ssh-rsa|ssh-ed25519|reverse\s+shell|backdoor/iu, reason: "possible SSH backdoor instruction" },
  { pattern: INVISIBLE_CONTROL_PATTERN, reason: "invisible or bidirectional Unicode control character" }
];

const ASSEMBLED_BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/iu, reason: "assembled prompt instruction override" },
  { pattern: /(?:disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions/iu, reason: "assembled prompt instruction override" },
  { pattern: /(?:reveal|print|dump|show)\s+(?:the\s+)?(?:system|developer)\s+prompt/iu, reason: "assembled prompt prompt-disclosure directive" },
  { pattern: /pretend\s+(?:to\s+be|you\s+are)\s+(?:system|developer|admin)/iu, reason: "assembled prompt role deception directive" }
];

export function assessCronUserPromptSafety(prompt: string): CronSafetyAssessment {
  const issues = USER_BLOCKED_PATTERNS
    .filter(({ pattern }) => pattern.test(prompt))
    .map(({ reason }) => reason);

  const exfiltrationPair =
    /(?:send|post|upload|curl|webhook|email|telegram|discord)/iu.test(prompt) &&
    SECRET_REFERENCE_PATTERN.test(prompt);

  if (exfiltrationPair && !issues.includes("credential exfiltration pattern")) {
    issues.push("credential exfiltration pattern");
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function assessCronAssembledPromptSafety(input: {
  assembled: string;
  userPrompt: string;
  includesSkillContent: boolean;
  includesDataContext: boolean;
  includesScriptOutput: boolean;
}): CronSafetyAssessment {
  const issues = ASSEMBLED_BLOCKED_PATTERNS
    .filter(({ pattern }) => pattern.test(input.assembled))
    .map(({ reason }) => reason);
  const sanitized = stripInvisibleControls(input.assembled);

  return {
    ok: issues.length === 0,
    issues,
    sanitizedText: sanitized.text === input.assembled ? undefined : sanitized.text,
    removedCodepoints: sanitized.removed.length === 0 ? undefined : sanitized.removed
  };
}

export function redactCronDataContext(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, "[redacted private key]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/giu, "$1[redacted]")
    .replace(/^(\s*[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY|CREDENTIAL)[A-Z0-9_]*\s*=\s*).+$/gimu, "$1[redacted]")
    .replace(/\b((?:api[_-]?key|token|secret|password|credential|private[_-]?key)\s*[:=]\s*)[^\s'",;]+/giu, "$1[redacted]");
}

export function assessCronPromptSafety(prompt: string): CronSafetyAssessment {
  return assessCronUserPromptSafety(prompt);
}

export function assertCronPromptSafe(prompt: string): void {
  const result = assessCronUserPromptSafety(prompt);
  if (!result.ok) {
    throw new Error(`Cron prompt blocked: ${result.issues.join(", ")}`);
  }
}

function stripInvisibleControls(text: string): { text: string; removed: string[] } {
  const removed = new Set<string>();
  const sanitized = text.replace(INVISIBLE_CONTROL_GLOBAL_PATTERN, (match) => {
    removed.add(codepointLabel(match));
    return "";
  });
  return { text: sanitized, removed: [...removed] };
}

function codepointLabel(value: string): string {
  const codepoint = value.codePointAt(0) ?? 0;
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}
