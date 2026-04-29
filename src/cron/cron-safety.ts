export type CronSafetyResult = {
  ok: boolean;
  issues: string[];
};

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/iu, reason: "prompt-injection instruction override" },
  { pattern: /exfiltrat/iu, reason: "possible exfiltration verb" },
  { pattern: /api[_-]?key|secret|token|password|credential|private\s+key|\.env|id_rsa|id_ed25519/iu, reason: "credential or secret reference" },
  { pattern: /authorized_keys|ssh-rsa|ssh-ed25519/iu, reason: "possible SSH backdoor instruction" },
  { pattern: /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/u, reason: "invisible or bidirectional Unicode control character" }
];

export function assessCronPromptSafety(prompt: string): CronSafetyResult {
  const issues = BLOCKED_PATTERNS
    .filter(({ pattern }) => pattern.test(prompt))
    .map(({ reason }) => reason);

  const exfiltrationPair =
    /(?:send|post|upload|curl|webhook|email|telegram|discord)/iu.test(prompt) &&
    /(?:api[_-]?key|secret|token|password|credential|private\s+key|\.env|id_rsa|id_ed25519)/iu.test(prompt);

  if (exfiltrationPair && !issues.includes("credential exfiltration pattern")) {
    issues.push("credential exfiltration pattern");
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function assertCronPromptSafe(prompt: string): void {
  const result = assessCronPromptSafety(prompt);
  if (!result.ok) {
    throw new Error(`Cron prompt blocked: ${result.issues.join(", ")}`);
  }
}
