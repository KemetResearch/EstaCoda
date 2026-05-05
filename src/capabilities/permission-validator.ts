import type { PermissionManifest } from "../contracts/capability.js";

export function validatePermissions(permissions: PermissionManifest): string[] {
  const findings: string[] = [];

  // filesystem
  if (permissions.filesystem?.write !== undefined) {
    for (const path of permissions.filesystem.write) {
      if (path === "/" || path === "*" || path === "") {
        findings.push(`Dangerous filesystem write path: "${path}"`);
      }
    }
  }

  // shell
  if (permissions.shell?.allowedCommands !== undefined) {
    for (const cmd of permissions.shell.allowedCommands) {
      if (cmd === "*" || cmd === "") {
        findings.push(`Dangerous shell allowed command: "${cmd}"`);
      }
    }
  }

  // network
  if (permissions.network?.allowedHosts !== undefined) {
    for (const host of permissions.network.allowedHosts) {
      if (host === "*" || host === "") {
        findings.push(`Dangerous network allowed host: "${host}"`);
      }
    }
  }

  // secrets
  if (permissions.secrets?.requiredEnvironmentVariables !== undefined) {
    for (const env of permissions.secrets.requiredEnvironmentVariables) {
      if (env === "*" || env === "") {
        findings.push(`Dangerous secrets required environment variable: "${env}"`);
      }
    }
  }

  // memory
  if (permissions.memory?.canWrite === true && permissions.memory?.requiresPromotionApproval === false) {
    findings.push("Memory write enabled without promotion approval");
  }

  return findings;
}
