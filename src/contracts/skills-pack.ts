export type SkillsPackType = "skill_pack" | "tool_pack" | "workflow_pack" | "mixed";

export type SkillsPackManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  source?: string;
  license?: string;
  skillsPackType: SkillsPackType;
  entrypoints: {
    skills?: string[];
    tools?: string[];
    workflows?: string[];
  };
  permissions: SkillsPackPermissionManifest;
  provenance: SkillsPackProvenanceManifest;
  sandbox: SkillsPackSandboxPolicy;
  evals?: SkillsPackEvalHook[];
  rollback?: SkillsPackRollbackPolicy;
};

export type SkillsPackPermissionManifest = {
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

export type SkillsPackProvenanceManifest = {
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

export type SkillsPackSandboxPolicy = {
  defaultMode: SandboxMode;
  filesystemMode: FilesystemMode;
  shellMode: ShellMode;
  networkMode: NetworkMode;
  secretsMode: SecretsMode;
};

export type SkillsPackEvalHook = {
  name: string;
  command: string;
  description?: string;
};

export type SkillsPackRollbackPolicy = {
  strategy: "remove" | "restore_previous" | "none";
  previousSnapshotPath?: string;
};

export type SkillsPackStatus =
  | "disabled"
  | "pending_approval"
  | "enabled"
  | "error";

export type InstalledSkillsPack = {
  manifest: SkillsPackManifest;
  status: SkillsPackStatus;
  installedAt: string;
  installedBy: string;
};

export type SkillsPackForceAuditRecord = {
  timestamp: string;
  skillsPackId: string;
  version: string;
  manifestHash: string;
  riskReasons: string[];
  overrideActor: string;
};