import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { LoadedSkill, SkillDefinition } from "../contracts/skill.js";
import { resolveOsHomeDir } from "../config/home-dir.js";

export type SkillConfiguredValues = Record<string, unknown> | undefined;

export type SkillSetupContext = {
  skillDirectory?: string;
  requiredEnvironmentVariables: Array<{ name: string; present: boolean }>;
  requiredCredentialFiles: Array<{ path: string; present: boolean; resolvedPath?: string }>;
  configFields: Array<{
    key: string;
    description?: string;
    required?: boolean;
    value?: unknown;
    source: "config" | "default" | "missing";
  }>;
};

export function resolveSkillSetupContext(
  skill: LoadedSkill | SkillDefinition,
  configuredValues: SkillConfiguredValues
): SkillSetupContext {
  return {
    skillDirectory: isLoadedSkill(skill) ? dirname(skill.sourcePath) : undefined,
    requiredEnvironmentVariables: (skill.requiredEnvironmentVariables ?? []).map((name) => ({
      name,
      present: typeof process.env[name] === "string" && process.env[name]!.length > 0
    })),
    requiredCredentialFiles: (skill.requiredCredentialFiles ?? []).map((path) => ({
      path,
      present: credentialFileExists(path),
      resolvedPath: expandUserEnvPath(path)
    })),
    configFields: (skill.configFields ?? []).map((field) => {
      const configuredValue = resolveConfiguredSkillValue(configuredValues, field.key);
      if (configuredValue !== undefined) {
        return {
          key: field.key,
          description: field.description,
          required: field.required,
          value: configuredValue,
          source: "config" as const
        };
      }

      if (field.defaultValue !== undefined) {
        return {
          key: field.key,
          description: field.description,
          required: field.required,
          value: field.defaultValue,
          source: "default" as const
        };
      }

      return {
        key: field.key,
        description: field.description,
        required: field.required,
        source: "missing" as const
      };
    })
  };
}

export function buildSkillReadinessMetadata(
  _skill: LoadedSkill | SkillDefinition,
  setup: SkillSetupContext
): {
  setup_needed: boolean;
  readiness_status: "available" | "missing-setup";
  missing_required_environment_variables: string[];
  missing_required_credential_files: string[];
  missing_config_fields: string[];
  setup_note?: string;
} {
  const missingRequiredEnvironmentVariables = setup.requiredEnvironmentVariables
    .filter((entry) => !entry.present)
    .map((entry) => entry.name);
  const missingRequiredCredentialFiles = setup.requiredCredentialFiles
    .filter((entry) => !entry.present)
    .map((entry) => entry.path);
  const missingConfigFields = setup.configFields
    .filter((field) => field.required === true && field.source === "missing")
    .map((field) => field.key);
  const missingCount = missingRequiredEnvironmentVariables.length +
    missingRequiredCredentialFiles.length +
    missingConfigFields.length;
  const setupNeeded = missingCount > 0;

  return {
    setup_needed: setupNeeded,
    readiness_status: setupNeeded ? "missing-setup" : "available",
    missing_required_environment_variables: missingRequiredEnvironmentVariables,
    missing_required_credential_files: missingRequiredCredentialFiles,
    missing_config_fields: missingConfigFields,
    setup_note: setupNeeded
      ? `Missing ${missingCount} required setup item${missingCount === 1 ? "" : "s"}.`
      : undefined
  };
}

function isLoadedSkill(skill: LoadedSkill | SkillDefinition): skill is LoadedSkill {
  return "instructions" in skill && "sourcePath" in skill;
}

function credentialFileExists(path: string): boolean {
  const resolved = expandUserEnvPath(path);
  return existsSync(resolved);
}

function expandUserEnvPath(path: string): string {
  const withHome = path.startsWith("~/")
    ? `${resolveOsHomeDir()}/${path.slice(2)}`
    : path;

  return withHome.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
}

function resolveConfiguredSkillValue(
  configuredValues: Record<string, unknown> | undefined,
  key: string
): unknown {
  if (configuredValues === undefined) {
    return undefined;
  }

  const variants = new Set<string>([key, toSnakeCase(key), toCamelCase(key)]);

  for (const variant of variants) {
    if (configuredValues[variant] !== undefined) {
      return configuredValues[variant];
    }
  }

  return undefined;
}

function toSnakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}
