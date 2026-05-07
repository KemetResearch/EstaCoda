export type PackType = "skill_pack" | "tool_pack" | "workflow_pack" | "mixed";

export type PackManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  source?: string;
  license?: string;
  packType: PackType;
  entrypoints: {
    skills?: string[];
    tools?: string[];
    workflows?: string[];
  };
  permissions: PackPermissionManifest;
  provenance: PackProvenanceManifest;
  sandbox: PackSandboxPolicy;
  evals?: PackEvalHook[];
  rollback?: PackRollbackPolicy;
};

export type PackPermissionManifest = {
  filesystem?: {
    read?: string[];
    write?: string[];
  };
  shell?: {
    allowedCommands?: string[];
    deniedCommands?: string[];
    requiresApproval?: boolean;
  };
  network?: {
    allowedHosts?: string[];
    requiresApproval?: boolean;
  };
  secrets?: {
    requiredEnvironmentVariables?: string[];
    requiredCredentialFiles?: string[];
  };
  memory?: {
    canRead?: boolean;
    canWrite?: boolean;
    requiresPromotionApproval?: boolean;
  };
  channels?: {
    canSendMessages?: boolean;
    canReceiveMessages?: boolean;
    requiresApproval?: boolean;
  };
};

export type ProvenanceOrigin = "bundled" | "local" | "external";

export type TrustLevel =
  | "first_party"
  | "local_user"
  | "external_reviewed"
  | "external_untrusted";

export type PackProvenanceManifest = {
  origin: ProvenanceOrigin;
  sourceUrl?: string;
  installedAt?: string;
  installedBy?: string;
  verified?: boolean;
  signatureStatus?: "unsigned" | "verified" | "failed" | "unknown";
  trustLevel: TrustLevel;
};

export type SandboxMode = "deny" | "ask" | "allow";
export type FilesystemMode = "deny" | "read_only" | "scoped_write";
export type ShellMode = "deny" | "ask" | "allow_list";
export type NetworkMode = "deny" | "ask" | "allow_list";
export type SecretsMode = "deny" | "explicit_only";

export type PackSandboxPolicy = {
  defaultMode: SandboxMode;
  filesystemMode: FilesystemMode;
  shellMode: ShellMode;
  networkMode: NetworkMode;
  secretsMode: SecretsMode;
};

export type PackEvalHook = {
  name: string;
  command: string;
  description?: string;
};

export type PackRollbackPolicy = {
  strategy: "remove" | "restore_previous" | "none";
  previousSnapshotPath?: string;
};

export type PackStatus =
  | "disabled"
  | "pending_approval"
  | "enabled"
  | "error";

export type InstalledPack = {
  manifest: PackManifest;
  status: PackStatus;
  installedAt: string;
  installedBy: string;
};

export type PackForceAuditRecord = {
  timestamp: string;
  packId: string;
  version: string;
  manifestHash: string;
  riskReasons: string[];
  overrideActor: string;
};