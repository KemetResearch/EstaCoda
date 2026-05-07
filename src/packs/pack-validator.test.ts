import { describe, it, expect } from "vitest";
import { validatePackManifest } from "./pack-validator.js";
import type { PackManifest } from "../contracts/pack.js";

function validManifest(): PackManifest {
  return {
    id: "test-pack",
    name: "Test pack",
    version: "1.0.0",
    description: "A test pack",
    packType: "skill_pack",
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

describe("validatePackManifest", () => {
  it("accepts a valid manifest", () => {
    const result = validatePackManifest(validManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe("test-pack");
    }
  });

  it("rejects null", () => {
    const result = validatePackManifest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("must be an object");
    }
  });

  it("rejects missing id", () => {
    const m = { ...validManifest(), id: "" };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("id"))).toBe(true);
    }
  });

  it("rejects missing name", () => {
    const m = { ...validManifest(), name: "" };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("rejects missing version", () => {
    const m = { ...validManifest(), version: undefined };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("version"))).toBe(true);
    }
  });

  it("rejects invalid packType", () => {
    const m = { ...validManifest(), packType: "unknown" as any };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("packType"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.defaultMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, defaultMode: "invalid" as any } };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("defaultMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.filesystemMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, filesystemMode: "invalid" as any } };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("filesystemMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.shellMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, shellMode: "invalid" as any } };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("shellMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.networkMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, networkMode: "invalid" as any } };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("networkMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.secretsMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, secretsMode: "invalid" as any } };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("secretsMode"))).toBe(true);
    }
  });

  it("rejects invalid provenance.origin", () => {
    const m = { ...validManifest(), provenance: { ...validManifest().provenance, origin: "invalid" as any } };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("provenance.origin"))).toBe(true);
    }
  });

  it("rejects invalid provenance.trustLevel", () => {
    const m = { ...validManifest(), provenance: { ...validManifest().provenance, trustLevel: "invalid" as any } };
    const result = validatePackManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("provenance.trustLevel"))).toBe(true);
    }
  });
});
