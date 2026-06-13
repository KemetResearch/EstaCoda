import { resolveGlobalStateHome } from "../config/profile-home.js";
import {
  getRegisteredPythonCapabilitySpec
} from "./capability-registry.js";
import {
  checkManagedPythonCapabilityStatus,
  type ManagedPythonCapabilityFailureReason
} from "./capability-manager.js";

export type CapabilityPythonEnvResolveReason =
  | ManagedPythonCapabilityFailureReason
  | "unverified";

export type CapabilityPythonEnvResolveOptions = {
  groups?: string[];
  install?: false;
  homeDir?: string;
  stateRoot?: string;
};

export type CapabilityPythonEnvResolveResult =
  | {
      ok: true;
      capabilityId: string;
      version: string;
      pythonPath: string;
      envPath: string;
      specHash: string;
      installedGroups: string[];
    }
  | {
      ok: false;
      capabilityId: string;
      reason: CapabilityPythonEnvResolveReason;
      message: string;
      expectedSpecHash?: string;
      installedGroups?: string[];
      repairCommand?: string;
      diagnostic?: string;
    };

export async function resolveCapabilityPythonEnv(
  specId: string,
  options: CapabilityPythonEnvResolveOptions = {}
): Promise<CapabilityPythonEnvResolveResult> {
  const spec = getRegisteredPythonCapabilitySpec(specId);
  if (spec === undefined) {
    return {
      ok: false,
      capabilityId: specId,
      reason: "not_configured",
      message: `Unknown managed Python capability: ${specId}`
    };
  }

  const groups = normalizeGroups(options.groups ?? []);
  for (const groupId of groups) {
    if (spec.optionalGroups?.[groupId] === undefined) {
      return {
        ok: false,
        capabilityId: specId,
        reason: "not_configured",
        message: `Unknown optional group '${groupId}' for managed Python capability '${specId}'.`
      };
    }
  }

  const stateRoot = options.stateRoot ?? resolveGlobalStateHome({ homeDir: options.homeDir }).stateRoot;
  const status = await checkManagedPythonCapabilityStatus({
    stateRoot,
    capabilityId: specId,
    groups
  });

  if (!status.ok) {
    return {
      ok: false,
      capabilityId: specId,
      reason: status.reason,
      message: status.message,
      expectedSpecHash: status.expectedSpecHash,
      installedGroups: status.manifest?.installedGroups,
      repairCommand: repairCommand(status.reason, specId, groups),
      diagnostic: status.diagnostic
    };
  }

  if (status.status !== "verified") {
    return {
      ok: false,
      capabilityId: specId,
      reason: "unverified",
      message: "Managed Python capability environment is installed but has not been verified.",
      expectedSpecHash: status.specHash,
      installedGroups: [...status.installedGroups],
      repairCommand: commandWithGroups("estacoda python-env verify", specId, groups)
    };
  }

  return {
    ok: true,
    capabilityId: specId,
    version: status.version,
    pythonPath: status.pythonPath,
    envPath: status.envPath,
    specHash: status.specHash,
    installedGroups: [...status.installedGroups]
  };
}

function normalizeGroups(groups: string[]): string[] {
  return [...new Set(groups.map((group) => group.trim()).filter((group) => group.length > 0))].sort();
}

function repairCommand(
  reason: ManagedPythonCapabilityFailureReason,
  capabilityId: string,
  groups: string[]
): string | undefined {
  switch (reason) {
    case "install_required":
      return commandWithGroups("estacoda python-env setup", capabilityId, groups);
    case "upgrade_required":
      return commandWithGroups("estacoda python-env upgrade", capabilityId, groups);
    case "broken_env":
    case "broken_manifest":
    case "venv_missing":
    case "import_verify_failed":
      return commandWithGroups("estacoda python-env verify", capabilityId, groups);
    case "python_missing":
    case "venv_create_failed":
    case "pip_install_failed":
    case "permission_denied":
    case "disk_insufficient":
      return commandWithGroups("estacoda python-env setup", capabilityId, groups);
    default:
      return undefined;
  }
}

function commandWithGroups(command: string, capabilityId: string, groups: string[]): string {
  return [
    command,
    capabilityId,
    ...groups.flatMap((group) => ["--group", group])
  ].join(" ");
}
