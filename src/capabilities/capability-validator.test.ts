import { describe, it, expect } from "vitest";
import { validateCapabilityManifest } from "./capability-validator.js";
import type { CapabilityManifest } from "../contracts/capability.js";

function validManifest(): CapabilityManifest {
  return {
    id: "test-capability",
    name: "Test Capability",
    version: "1.0.0",
    description: "A test capability",
    capabilityType: "skill_pack",
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

describe("validateCapabilityManifest", () => {
  it("accepts a valid manifest", () => {
    const result = validateCapabilityManifest(validManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe("test-capability");
    }
  });

  it("rejects null", () => {
    const result = validateCapabilityManifest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("must be an object");
    }
  });

  it("rejects missing id", () => {
    const m = { ...validManifest(), id: "" };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("id"))).toBe(true);
    }
  });

  it("rejects missing name", () => {
    const m = { ...validManifest(), name: "" };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("rejects missing version", () => {
    const m = { ...validManifest(), version: undefined };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("version"))).toBe(true);
    }
  });

  it("rejects invalid capabilityType", () => {
    const m = { ...validManifest(), capabilityType: "unknown" as any };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("capabilityType"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.defaultMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, defaultMode: "invalid" as any } };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("defaultMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.filesystemMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, filesystemMode: "invalid" as any } };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("filesystemMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.shellMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, shellMode: "invalid" as any } };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("shellMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.networkMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, networkMode: "invalid" as any } };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("networkMode"))).toBe(true);
    }
  });

  it("rejects invalid sandbox.secretsMode", () => {
    const m = { ...validManifest(), sandbox: { ...validManifest().sandbox, secretsMode: "invalid" as any } };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("secretsMode"))).toBe(true);
    }
  });

  it("rejects invalid provenance.origin", () => {
    const m = { ...validManifest(), provenance: { ...validManifest().provenance, origin: "invalid" as any } };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("provenance.origin"))).toBe(true);
    }
  });

  it("rejects invalid provenance.trustLevel", () => {
    const m = { ...validManifest(), provenance: { ...validManifest().provenance, trustLevel: "invalid" as any } };
    const result = validateCapabilityManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("provenance.trustLevel"))).toBe(true);
    }
  });
});
