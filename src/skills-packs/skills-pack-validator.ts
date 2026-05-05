import type { SkillsPackManifest, SkillsPackType, SandboxMode, FilesystemMode, ShellMode, NetworkMode, SecretsMode, ProvenanceOrigin, TrustLevel } from "../contracts/skills-pack.js";

const VALID_SKILLS_PACK_TYPES: SkillsPackType[] = ["skill_pack", "tool_pack", "workflow_pack", "mixed"];
const VALID_SANDBOX_MODES: SandboxMode[] = ["deny", "ask", "allow"];
const VALID_FILESYSTEM_MODES: FilesystemMode[] = ["deny", "read_only", "scoped_write"];
const VALID_SHELL_MODES: ShellMode[] = ["deny", "ask", "allow_list"];
const VALID_NETWORK_MODES: NetworkMode[] = ["deny", "ask", "allow_list"];
const VALID_SECRETS_MODES: SecretsMode[] = ["deny", "explicit_only"];
const VALID_PROVENANCE_ORIGINS: ProvenanceOrigin[] = ["bundled", "local", "external"];
const VALID_TRUST_LEVELS: TrustLevel[] = ["first_party", "local_user", "external_reviewed", "external_untrusted"];

export function validateSkillsPackManifest(manifest: unknown): { ok: true; manifest: SkillsPackManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (manifest === null || typeof manifest !== "object") {
    return { ok: false, errors: ["Manifest must be an object"] };
  }

  const m = manifest as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ["id", "name", "version", "description"] as const;
  for (const key of requiredStrings) {
    if (typeof m[key] !== "string" || (m[key] as string).length === 0) {
      errors.push(`Missing or invalid required field: ${key}`);
    }
  }

  // skillsPackType
  if (!VALID_SKILLS_PACK_TYPES.includes(m.skillsPackType as SkillsPackType)) {
    errors.push(`Invalid skillsPackType: ${String(m.skillsPackType)}. Must be one of ${VALID_SKILLS_PACK_TYPES.join(", ")}`);
  }

  // entrypoints
  if (m.entrypoints !== undefined && (m.entrypoints === null || typeof m.entrypoints !== "object" || Array.isArray(m.entrypoints))) {
    errors.push("entrypoints must be an object if provided");
  }

  // permissions
  if (m.permissions === null || typeof m.permissions !== "object" || Array.isArray(m.permissions)) {
    errors.push("Missing or invalid permissions object");
  }

  // provenance
  if (m.provenance === null || typeof m.provenance !== "object" || Array.isArray(m.provenance)) {
    errors.push("Missing or invalid provenance object");
  } else {
    const p = m.provenance as Record<string, unknown>;
    if (!VALID_PROVENANCE_ORIGINS.includes(p.origin as ProvenanceOrigin)) {
      errors.push(`Invalid provenance.origin: ${String(p.origin)}. Must be one of ${VALID_PROVENANCE_ORIGINS.join(", ")}`);
    }
    if (!VALID_TRUST_LEVELS.includes(p.trustLevel as TrustLevel)) {
      errors.push(`Invalid provenance.trustLevel: ${String(p.trustLevel)}. Must be one of ${VALID_TRUST_LEVELS.join(", ")}`);
    }
  }

  // sandbox
  if (m.sandbox === null || typeof m.sandbox !== "object" || Array.isArray(m.sandbox)) {
    errors.push("Missing or invalid sandbox object");
  } else {
    const s = m.sandbox as Record<string, unknown>;
    if (!VALID_SANDBOX_MODES.includes(s.defaultMode as SandboxMode)) {
      errors.push(`Invalid sandbox.defaultMode: ${String(s.defaultMode)}. Must be one of ${VALID_SANDBOX_MODES.join(", ")}`);
    }
    if (!VALID_FILESYSTEM_MODES.includes(s.filesystemMode as FilesystemMode)) {
      errors.push(`Invalid sandbox.filesystemMode: ${String(s.filesystemMode)}. Must be one of ${VALID_FILESYSTEM_MODES.join(", ")}`);
    }
    if (!VALID_SHELL_MODES.includes(s.shellMode as ShellMode)) {
      errors.push(`Invalid sandbox.shellMode: ${String(s.shellMode)}. Must be one of ${VALID_SHELL_MODES.join(", ")}`);
    }
    if (!VALID_NETWORK_MODES.includes(s.networkMode as NetworkMode)) {
      errors.push(`Invalid sandbox.networkMode: ${String(s.networkMode)}. Must be one of ${VALID_NETWORK_MODES.join(", ")}`);
    }
    if (!VALID_SECRETS_MODES.includes(s.secretsMode as SecretsMode)) {
      errors.push(`Invalid sandbox.secretsMode: ${String(s.secretsMode)}. Must be one of ${VALID_SECRETS_MODES.join(", ")}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, manifest: m as SkillsPackManifest };
}
