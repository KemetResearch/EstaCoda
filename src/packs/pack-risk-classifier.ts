import type { PackManifest } from "../contracts/pack.js";
import { validatePackManifest } from "./pack-validator.js";
import { validatePackPermissions } from "./pack-permission-validator.js";

export type PackRiskClassification = {
  level: "low" | "medium" | "high" | "blocked";
  reasons: string[];
};

export function classifyPackRisk(manifest: PackManifest): PackRiskClassification {
  const reasons: string[] = [];

  // 1. Manifest validation
  const validation = validatePackManifest(manifest);
  if (!validation.ok) {
    return {
      level: "blocked",
      reasons: [`Invalid manifest: ${validation.errors.join("; ")}`]
    };
  }

  // 2. Permission findings
  const permissionFindings = validatePackPermissions(manifest.permissions);
  if (permissionFindings.length > 0) {
    return {
      level: "blocked",
      reasons: [`Permission findings: ${permissionFindings.join("; ")}`]
    };
  }

  const perms = manifest.permissions;
  const sandbox = manifest.sandbox;

  // 3. defaultMode="allow" with shell/network permissions requested
  if (sandbox.defaultMode === "allow") {
    const hasShell = perms.shell?.allowedCommands !== undefined && perms.shell.allowedCommands.length > 0;
    const hasNetwork = perms.network?.allowedHosts !== undefined && perms.network.allowedHosts.length > 0;
    if (hasShell || hasNetwork) {
      return {
        level: "blocked",
        reasons: [`sandbox.defaultMode is "allow" with shell or network permissions requested`]
      };
    }
  }

  // 4. shellMode must be "deny" or "allow_list"
  if (sandbox.shellMode !== "deny" && sandbox.shellMode !== "allow_list") {
    return {
      level: "blocked",
      reasons: [`Invalid sandbox.shellMode: ${sandbox.shellMode}. Must be "deny" or "allow_list"`]
    };
  }

  // 5. networkMode must be "deny" or "allow_list"
  if (sandbox.networkMode !== "deny" && sandbox.networkMode !== "allow_list") {
    return {
      level: "blocked",
      reasons: [`Invalid sandbox.networkMode: ${sandbox.networkMode}. Must be "deny" or "allow_list"`]
    };
  }

  // 6. allow_list with empty or wildcard allowed commands
  if (sandbox.shellMode === "allow_list") {
    const allowed = perms.shell?.allowedCommands ?? [];
    if (allowed.length === 0) {
      return {
        level: "blocked",
        reasons: [`sandbox.shellMode is "allow_list" but permissions.shell.allowedCommands is empty`]
      };
    }
    if (allowed.includes("*")) {
      return {
        level: "blocked",
        reasons: [`sandbox.shellMode is "allow_list" but permissions.shell.allowedCommands contains wildcard`]
      };
    }
  }

  // 7. allow_list with empty or wildcard allowed hosts
  if (sandbox.networkMode === "allow_list") {
    const hosts = perms.network?.allowedHosts ?? [];
    if (hosts.length === 0) {
      return {
        level: "blocked",
        reasons: [`sandbox.networkMode is "allow_list" but permissions.network.allowedHosts is empty`]
      };
    }
    if (hosts.includes("*")) {
      return {
        level: "blocked",
        reasons: [`sandbox.networkMode is "allow_list" but permissions.network.allowedHosts contains wildcard`]
      };
    }
  }

  // 8. high risk: shell, write, secrets, channel send, or external untrusted
  const hasShell = perms.shell?.allowedCommands !== undefined && perms.shell.allowedCommands.length > 0;
  const hasWrite = perms.filesystem?.write !== undefined && perms.filesystem.write.length > 0;
  const hasSecrets =
    (perms.secrets?.requiredEnvironmentVariables !== undefined && perms.secrets.requiredEnvironmentVariables.length > 0) ||
    (perms.secrets?.requiredCredentialFiles !== undefined && perms.secrets.requiredCredentialFiles.length > 0);
  const hasChannelSend = perms.channels?.canSendMessages === true;
  const isExternalUntrusted = manifest.provenance.trustLevel === "external_untrusted";

  if (hasShell || hasWrite || hasSecrets || hasChannelSend || isExternalUntrusted) {
    const r: string[] = [];
    if (hasShell) r.push("requests shell execution");
    if (hasWrite) r.push("requests filesystem write");
    if (hasSecrets) r.push("requests secrets access");
    if (hasChannelSend) r.push("requests channel send");
    if (isExternalUntrusted) r.push("external untrusted provenance");
    return { level: "high", reasons: r };
  }

  // 9. medium risk: network read, memory write, or external reviewed
  const hasNetwork = perms.network?.allowedHosts !== undefined && perms.network.allowedHosts.length > 0;
  const hasMemoryWrite = perms.memory?.canWrite === true;
  const isExternalReviewed = manifest.provenance.trustLevel === "external_reviewed";

  if (hasNetwork || hasMemoryWrite || isExternalReviewed) {
    const r: string[] = [];
    if (hasNetwork) r.push("requests network access");
    if (hasMemoryWrite) r.push("requests memory write");
    if (isExternalReviewed) r.push("external reviewed provenance");
    return { level: "medium", reasons: r };
  }

  // 10. low risk: default
  return { level: "low", reasons: ["read-only, bundled/local provenance, no secrets, no shell"] };
}
