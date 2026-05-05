import type { SkillsPackManifest } from "../contracts/skills-pack.js";
import type { SkillsPackRiskClassification } from "./skills-pack-risk-classifier.js";

export function renderSkillsPackReview(
  manifest: SkillsPackManifest,
  risk: SkillsPackRiskClassification
): string {
  const lines: string[] = [];

  lines.push(`Skills pack: ${manifest.name}`);
  lines.push(`Origin: ${manifest.provenance.origin}`);
  lines.push(`Version: ${manifest.version}`);
  lines.push(`Trust: ${formatTrustLevel(manifest.provenance.trustLevel)}`);

  const fs = manifest.permissions.filesystem;
  if (fs !== undefined) {
    const parts: string[] = [];
    if (fs.read !== undefined && fs.read.length > 0) parts.push(`read ${fs.read.join(", ")}`);
    if (fs.write !== undefined && fs.write.length > 0) parts.push(`write ${fs.write.join(", ")}`);
    if (parts.length > 0) {
      lines.push(`Filesystem: ${parts.join(", ")}`);
    } else {
      lines.push("Filesystem: none");
    }
  } else {
    lines.push("Filesystem: none");
  }

  const shell = manifest.permissions.shell;
  if (shell !== undefined && shell.allowedCommands !== undefined && shell.allowedCommands.length > 0) {
    lines.push(`Shell: ${shell.requiresApproval === false ? "allowed" : "asks before running commands"}`);
  } else {
    lines.push("Shell: denied");
  }

  const network = manifest.permissions.network;
  if (network !== undefined && network.allowedHosts !== undefined && network.allowedHosts.length > 0) {
    lines.push(`Network: ${network.allowedHosts.join(", ")}`);
  } else {
    lines.push("Network: denied");
  }

  const secrets = manifest.permissions.secrets;
  if (secrets !== undefined) {
    const reqs: string[] = [];
    if (secrets.requiredEnvironmentVariables !== undefined && secrets.requiredEnvironmentVariables.length > 0) {
      reqs.push(`${secrets.requiredEnvironmentVariables.join(", ")} required`);
    }
    if (secrets.requiredCredentialFiles !== undefined && secrets.requiredCredentialFiles.length > 0) {
      reqs.push(`credential files: ${secrets.requiredCredentialFiles.join(", ")}`);
    }
    if (reqs.length > 0) {
      lines.push(`Secrets: ${reqs.join("; ")}`);
    } else {
      lines.push("Secrets: none");
    }
  } else {
    lines.push("Secrets: none");
  }

  const memory = manifest.permissions.memory;
  if (memory !== undefined) {
    const canRead = memory.canRead === true ? "can read memory" : "cannot read memory";
    const canWrite = memory.canWrite === true ? "can write memory" : "cannot write memory";
    const promo = memory.requiresPromotionApproval === false ? "can promote without approval" : "cannot promote without approval";
    lines.push(`Memory: ${canRead}, ${canWrite}, ${promo}`);
  } else {
    lines.push("Memory: none");
  }

  lines.push(`Risk: ${risk.level}`);
  lines.push(`Verification: ${risk.level === "blocked" ? "0/6 checks passed" : "6/6 checks passed"}`);

  const defaultStatus = manifest.provenance.origin === "external" ? "disabled until enabled" : "enabled";
  lines.push(`Default status: ${defaultStatus}`);

  return lines.join("\n");
}

function formatTrustLevel(level: string): string {
  switch (level) {
    case "first_party": return "first party";
    case "local_user": return "local user";
    case "external_reviewed": return "reviewed external";
    case "external_untrusted": return "unverified external";
    default: return level;
  }
}
