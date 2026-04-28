import {
  capabilityFirstDefaults,
  type SecurityApprovalMode,
  type SecurityDecision,
  type SecurityPolicy,
  type SecurityRequest
} from "../contracts/security.js";

export function normalizeSecurityApprovalMode(mode: string | undefined): SecurityApprovalMode {
  switch (mode) {
    case "manual":
    case "strict":
      return "strict";
    case "smart":
    case "adaptive":
      return "adaptive";
    case "off":
    case "open":
      return "open";
    default:
      return "adaptive";
  }
}

export function createSecurityPolicyForMode(mode: SecurityApprovalMode): SecurityPolicy {
  switch (mode) {
    case "open":
      return {
        decide(request) {
          if (isUnconditionallyDangerous(request)) {
            return "deny";
          }
          return "allow";
        }
      };
    case "adaptive":
      return {
        decide(request) {
          const baseline = capabilityFirstDefaults.decide(request);
          if (baseline !== "ask") {
            return baseline;
          }
          return smartAssess(request);
        }
      };
    case "strict":
    default:
      return capabilityFirstDefaults;
  }
}

function smartAssess(request: SecurityRequest): SecurityDecision {
  if (
    request.riskClass === "credential-access" ||
    request.riskClass === "sandbox-escape" ||
    request.riskClass === "spend-money"
  ) {
    return "deny";
  }

  if (request.riskClass !== "destructive-local") {
    return "ask";
  }

  if (isUnconditionallyDangerous(request)) {
    return "deny";
  }

  if (request.command !== undefined && isLikelyFalsePositive(request.command)) {
    return "allow";
  }

  return "ask";
}

function isLikelyFalsePositive(command: string): boolean {
  const normalized = normalizeCommand(command);
  return /\b(?:echo|printf|python\s+-c|node\s+-e|bun\s+-e)\b/u.test(normalized) &&
    !/\b(?:rm\s+-rf|sudo|chmod\s+-R|chown\s+-R|mkfs\.|dd\b|shutdown|reboot|halt|poweroff|kill\s+-1)\b/u.test(normalized);
}

function isUnconditionallyDangerous(request: SecurityRequest): boolean {
  const command = request.command ?? request.targetSummary ?? "";
  const normalized = normalizeCommand(command);
  const compact = normalized.replace(/\s+/gu, "");

  return /\brm\s+-rf\s+\/(?:\s|$)/u.test(normalized) ||
    /\bmkfs\./u.test(normalized) ||
    /\bdd\b.*\bof=\/dev\/(?:sd[a-z]|disk\d|nvme\d+n\d+)/u.test(normalized) ||
    /\b(?:shutdown|reboot|halt|poweroff)\b/u.test(normalized) ||
    compact.includes(":(){:|:&};:") ||
    /\bkill\s+-1\b/u.test(normalized);
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
