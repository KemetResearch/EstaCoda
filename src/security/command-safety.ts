import type { ToolRiskClass } from "../contracts/tool.js";

export type HardCommandBlockCode =
  | "destructive-delete-root-or-broad-path"
  | "disk-destructive"
  | "system-power"
  | "fork-bomb-or-killall"
  | "secret-read"
  | "pipe-to-interpreter"
  | "inline-code-destructive"
  | "git-force-push";

export type CommandSafetyAssessment = {
  normalized: string;
  riskClass?: ToolRiskClass;
  hardBlock?: {
    code: HardCommandBlockCode;
    reason: string;
  };
};

export function assessCommandSafety(command: string): CommandSafetyAssessment {
  const normalized = normalizeCommandForSafety(command);
  const hardBlock = detectHardBlock(command);

  if (hardBlock !== undefined) {
    return {
      normalized,
      riskClass: inferRiskClass(command),
      hardBlock
    };
  }

  return {
    normalized,
    riskClass: inferRiskClass(command)
  };
}

export function normalizeCommandForSafety(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function inferRiskClass(command: string): ToolRiskClass | undefined {
  if (looksCredentialSeeking(command)) {
    return "credential-access";
  }

  if (looksDestructive(command)) {
    return "destructive-local";
  }

  return undefined;
}

function detectHardBlock(command: string): { code: HardCommandBlockCode; reason: string } | undefined {
  if (matchesBroadDelete(command)) {
    return {
      code: "destructive-delete-root-or-broad-path",
      reason: "command attempts recursive deletion of a broad or root-like path"
    };
  }

  if (matchesDiskDestructive(command)) {
    return {
      code: "disk-destructive",
      reason: "command targets destructive disk or partition operations"
    };
  }

  if (matchesSystemPower(command)) {
    return {
      code: "system-power",
      reason: "command attempts shutdown, reboot, or power control"
    };
  }

  if (matchesForkBombOrKillall(command)) {
    return {
      code: "fork-bomb-or-killall",
      reason: "command matches a fork-bomb or mass-kill pattern"
    };
  }

  if (matchesSecretRead(command)) {
    return {
      code: "secret-read",
      reason: "command attempts to read or reveal secrets or credential material"
    };
  }

  if (matchesPipeToInterpreter(command)) {
    return {
      code: "pipe-to-interpreter",
      reason: "command pipes downloaded content directly into an interpreter"
    };
  }

  if (matchesInlineCodeDestructive(command)) {
    return {
      code: "inline-code-destructive",
      reason: "command runs inline code that can delete files, execute subprocesses, or bypass shell safety checks"
    };
  }

  if (matchesGitForcePush(command)) {
    return {
      code: "git-force-push",
      reason: "command attempts a force push to a remote branch"
    };
  }

  return undefined;
}

/* ------------------------------------------------------------------ */
/* Token-aware rm parsing                                              */
/* ------------------------------------------------------------------ */

const BROAD_SYSTEM_SEGMENTS = new Set([
  "usr", "etc", "var", "home", "Users", "root", "opt", "bin", "sbin", "lib", "lib64"
]);

const WRAPPER_COMMANDS = new Set(["sudo", "command", "env"]);

function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/u);
}

function parseRmTokens(tokens: string[]): {
  hasRecursive: boolean;
  hasForce: boolean;
  targets: string[];
} | undefined {
  let index = 0;

  while (index < tokens.length && WRAPPER_COMMANDS.has(tokens[index]!)) {
    index++;
  }

  if (index >= tokens.length || tokens[index] !== "rm") {
    return undefined;
  }

  index++;

  let hasRecursive = false;
  let hasForce = false;
  let afterTerminator = false;
  const targets: string[] = [];

  for (; index < tokens.length; index++) {
    const token = tokens[index]!;

    if (token === "--") {
      afterTerminator = true;
      continue;
    }

    if (afterTerminator) {
      targets.push(token);
      continue;
    }

    if (token.startsWith("--")) {
      if (token === "--recursive") {
        hasRecursive = true;
      } else if (token === "--force") {
        hasForce = true;
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      for (const ch of token.slice(1)) {
        if (ch === "r" || ch === "R") {
          hasRecursive = true;
        } else if (ch === "f") {
          hasForce = true;
        }
      }
      continue;
    }

    targets.push(token);
  }

  return { hasRecursive, hasForce, targets };
}

function isBroadDeleteTarget(target: string): boolean {
  if (target === "/" || target === "~" || target === "." || target === "..") {
    return true;
  }

  if (target.startsWith("~/")) {
    return true;
  }

  if (target.startsWith("/")) {
    const segments = target.split("/");
    const first = segments[1];
    if (first !== undefined && BROAD_SYSTEM_SEGMENTS.has(first)) {
      return true;
    }
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Classification helpers                                              */
/* ------------------------------------------------------------------ */

function looksDestructive(command: string): boolean {
  const tokens = tokenizeCommand(command);
  const rm = parseRmTokens(tokens);
  if (rm !== undefined && rm.hasRecursive && rm.hasForce) {
    return true;
  }

  return /\bsudo\b|\bchmod\s+-R\b|\bchown\s+-R\b|\bmkfs\.|\bdd\b.+\bof=|>\/dev\/sd[a-z]/iu.test(command);
}

function looksCredentialSeeking(command: string): boolean {
  return /\b(printenv|env|security\s+find|op\s+read|gh\s+auth\s+token|pass\s+show)\b/iu.test(command) ||
    /(\.env|\.ssh|\.aws|\.gnupg|id_rsa|id_ed25519|\.npmrc|token|secret|api[_-]?key|credentials)/iu.test(command);
}

function matchesBroadDelete(command: string): boolean {
  const tokens = tokenizeCommand(command);
  const rm = parseRmTokens(tokens);
  if (rm === undefined) {
    return false;
  }
  if (!rm.hasRecursive || !rm.hasForce) {
    return false;
  }
  return rm.targets.some(isBroadDeleteTarget);
}

function matchesDiskDestructive(command: string): boolean {
  return /\bmkfs\./iu.test(command) ||
    /\bdd\b.*\bof=\/dev\/(?:sd[a-z]|disk\d|nvme\d+n\d+)/iu.test(command) ||
    /\b(?:fdisk|parted)\b/iu.test(command) ||
    /\bdiskutil\s+erase(?:Disk|Volume)\b/iu.test(command);
}

function matchesSystemPower(command: string): boolean {
  return /\b(?:shutdown|reboot|halt|poweroff)\b/iu.test(command) ||
    /\bsystemctl\s+(?:poweroff|reboot)\b/iu.test(command) ||
    /\binit\s+(?:0|6)\b/iu.test(command);
}

function matchesForkBombOrKillall(command: string): boolean {
  const compact = command.replace(/\s+/gu, "");
  return compact.includes(":(){:|:&};") ||
    /\bkill\s+-1\b/iu.test(command) ||
    /\bpkill\s+-9\s+-u\b/iu.test(command) ||
    /\bkillall\s+-u\b/iu.test(command);
}

function matchesSecretRead(command: string): boolean {
  return /\b(?:cat|less|more|head|tail|grep|sed|awk)\b.*(?:\.env(?:\b|$)|\.ssh\/|id_rsa\b|id_ed25519\b|\.aws\/credentials\b|\.npmrc\b|\.gnupg\/)/iu.test(command) ||
    /(?:^|[;&|]\s*)(?:env|printenv|set)(?:\s|$)/iu.test(command) ||
    /\bsecurity\s+find-(?:generic-password|internet-password)\b/iu.test(command) ||
    /\bop\s+read\b/iu.test(command) ||
    /\bgh\s+auth\s+token\b/iu.test(command);
}

function matchesPipeToInterpreter(command: string): boolean {
  return /\b(?:curl|wget|fetch)\b[^|;&]*(?:\|\s*|>\s*>\([^)]*\)\s*|\|\s*(?:sudo\s+)?)(?:sudo\s+)?(?:sh|bash|zsh|fish|python|python3|node|bun|ruby|perl|php|deno)\b/iu.test(command) ||
    /\b(?:sh|bash|zsh|fish|python|python3|node|bun|ruby|perl|php|deno)\b\s*<\s*<\s*\(/iu.test(command);
}

function matchesGitForcePush(command: string): boolean {
  return /\bgit\s+push\b.*(?:--force|-f|--force-with-lease)\b/iu.test(command);
}

function matchesInlineCodeDestructive(command: string): boolean {
  if (!/\b(?:python|python3)\s+-c\b|\b(?:node|bun|deno)\s+-e\b/iu.test(command)) {
    return false;
  }
  return /\b(?:shutil\.rmtree|os\.remove|os\.unlink|subprocess\.|os\.system|child_process|execSync|spawnSync|rmSync|unlinkSync|rmdirSync|Deno\.remove|Bun\.spawn|Bun\.spawnSync)\b/iu.test(command);
}
