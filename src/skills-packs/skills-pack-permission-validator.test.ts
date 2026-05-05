import { describe, it, expect } from "vitest";
import { validateSkillsPackPermissions } from "./skills-pack-permission-validator.js";
import type { SkillsPackPermissionManifest } from "../contracts/skills-pack.js";

describe("validateSkillsPackPermissions", () => {
  it("returns empty findings for empty permissions", () => {
    const findings = validateSkillsPackPermissions({});
    expect(findings).toEqual([]);
  });

  it("flags dangerous filesystem write path /", () => {
    const findings = validateSkillsPackPermissions({ filesystem: { write: ["/"] } });
    expect(findings.some((f) => f.includes("Dangerous filesystem write path"))).toBe(true);
  });

  it("flags dangerous filesystem write path *", () => {
    const findings = validateSkillsPackPermissions({ filesystem: { write: ["*"] } });
    expect(findings.some((f) => f.includes("Dangerous filesystem write path"))).toBe(true);
  });

  it("flags dangerous filesystem write path empty string", () => {
    const findings = validateSkillsPackPermissions({ filesystem: { write: [""] } });
    expect(findings.some((f) => f.includes("Dangerous filesystem write path"))).toBe(true);
  });

  it("flags wildcard shell allowed commands", () => {
    const findings = validateSkillsPackPermissions({ shell: { allowedCommands: ["*"] } });
    expect(findings.some((f) => f.includes("Dangerous shell allowed command"))).toBe(true);
  });

  it("flags empty string shell allowed command", () => {
    const findings = validateSkillsPackPermissions({ shell: { allowedCommands: [""] } });
    expect(findings.some((f) => f.includes("Dangerous shell allowed command"))).toBe(true);
  });

  it("flags wildcard network allowed hosts", () => {
    const findings = validateSkillsPackPermissions({ network: { allowedHosts: ["*"] } });
    expect(findings.some((f) => f.includes("Dangerous network allowed host"))).toBe(true);
  });

  it("flags empty string network allowed host", () => {
    const findings = validateSkillsPackPermissions({ network: { allowedHosts: [""] } });
    expect(findings.some((f) => f.includes("Dangerous network allowed host"))).toBe(true);
  });

  it("flags wildcard secrets env var", () => {
    const findings = validateSkillsPackPermissions({ secrets: { requiredEnvironmentVariables: ["*"] } });
    expect(findings.some((f) => f.includes("Dangerous secrets required environment variable"))).toBe(true);
  });

  it("flags empty string secrets env var", () => {
    const findings = validateSkillsPackPermissions({ secrets: { requiredEnvironmentVariables: [""] } });
    expect(findings.some((f) => f.includes("Dangerous secrets required environment variable"))).toBe(true);
  });

  it("flags memory write without promotion approval", () => {
    const findings = validateSkillsPackPermissions({ memory: { canWrite: true, requiresPromotionApproval: false } });
    expect(findings.some((f) => f.includes("Memory write enabled without promotion approval"))).toBe(true);
  });

  it("accepts safe read-only permissions", () => {
    const findings = validateSkillsPackPermissions({
      filesystem: { read: ["./src"], write: ["./output"] },
      shell: { allowedCommands: ["git", "npm"] },
      network: { allowedHosts: ["github.com"] },
      secrets: { requiredEnvironmentVariables: ["GITHUB_TOKEN"] },
      memory: { canWrite: true, requiresPromotionApproval: true }
    });
    expect(findings).toEqual([]);
  });
});
