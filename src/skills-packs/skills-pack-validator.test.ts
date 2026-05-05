import { describe, it, expect } from "vitest";
import { validateSkillsPackManifest } from "./skills-pack-validator.js";
import type { SkillsPackManifest } from "../contracts/skills-pack.js";

function validManifest(): SkillsPackManifest {
  return {
    id: "test-skills-pack",
    name: "Test Skills Pack",
    version: "1.0.0",
    description: "A test skills pack",
    skillsPackType: "skill_pack",
    entrypoints: {},
    permissions: {},
    provenance: {
      origin: "bundled",
      trustLevel: "first_party"
    },
    sandbox: {
      defaultMode: "deny",
      filesystemMode: "deny",
      shellMode: "deny",
      networkMode: "deny",
      secretsMode: "deny"
    }
  };
}

describe("validateSkillsPackManifest", () => {
  it("accepts a valid manifest", () => {
    const result = validateSkillsPackManifest(validManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe("test-skills-pack");
    }
  });

  it("rejects null", () => {
    const result = validateSkillsPackManifest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("must be an object");
    }
  });

  it("rejects missing id", () => {
    const m = { ...validManifest(), id: "" };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("id"))).toBe(true);
    }
  });

  it("rejects missing name", () => {
    const m = { ...validManifest(), name: "" };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("rejects missing version", () => {
    const m = { ...validManifest(), version: undefined };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("version"))).toBe(true);
    }
  });

  it("rejects invalid skillsPackType", () => {
    const m = { ...validManifest(), skillsPackType: "unknown" as any };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("skillsPackType"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.defaultMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, defaultMode: "invalid" as any } };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("defaultMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.filesystemMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, filesystemMode: "invalid" as any } };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("filesystemMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.shellMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, shellMode: "invalid" as any } };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("shellMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.networkMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, networkMode: "invalid" as any } };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("networkMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.secretsMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, secretsMode: "invalid" as any } };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("secretsMode"))).toBe(true);
    }
  });

  it("rejects invalid provenance.origin", () => {
    const m = { ...validManifest(), provenance: { ...validManifest().provenance, origin: "invalid" as any } };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("provenance.origin"))).toBe(true);
    }
  });

  it("rejects invalid provenance.trustLevel", () => {
    const m = { ...validManifest(), provenance: { ...validManifest().provenance, trustLevel: "invalid" as any } };
    const result = validateSkillsPackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("provenance.trustLevel"))).toBe(true);
    }
  });
});
