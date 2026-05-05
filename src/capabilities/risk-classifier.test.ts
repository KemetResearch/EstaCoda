import { describe, it, expect } from "vitest";
import { classifyRisk } from "./risk-classifier.js";
import type { CapabilityManifest } from "../contracts/capability.js";

function baseManifest(overrides?: Partial<CapabilityManifest>): CapabilityManifest {
  return {
    id: "test",
    name: "Test",
    version: "1.0.0",
    description: "Test",
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
    },
    ...overrides
  };
}

describe("classifyRisk", () => {
  it("returns low for read-only bundled", () => {
    const result = classifyRisk(baseManifest());
    expect(result.level).toBe("low");
  });

  it("returns high for external with shell", () => {
    const result = classifyRisk(baseManifest({
      provenance: { origin: "external", trustLevel: "external_untrusted" },
      permissions: {
        shell: { allowedCommands: ["git"] }
      },
      sandbox: {
        defaultMode: "deny",
        filesystemMode: "deny",
        shellMode: "allow_list",
        networkMode: "deny",
        secretsMode: "deny"
      }
    }));
    expect(result.level).toBe("high");
    expect(result.reasons.some((r) => r.includes("shell"))).toBe(true);
  });

  it("returns medium for external with network only", () => {
    const result = classifyRisk(baseManifest({
      provenance: { origin: "external", trustLevel: "external_reviewed" },
      permissions: {
        network: { allowedHosts: ["github.com"] }
      },
      sandbox: {
        defaultMode: "deny",
        filesystemMode: "deny",
        shellMode: "deny",
        networkMode: "allow_list",
        secretsMode: "deny"
      }
    }));
    expect(result.level).toBe("medium");
    expect(result.reasons.some((r) => r.includes("network"))).toBe(true);
  });

  it("returns blocked for invalid manifest", () => {
    const result = classifyRisk(baseManifest({ id: "" }));
    expect(result.level).toBe("blocked");
  });

  it("returns blocked for permission findings", () => {
    const result = classifyRisk(baseManifest({
      permissions: {
        shell: { allowedCommands: ["*"] }
      }
    }));
    expect(result.level).toBe("blocked");
  });

  it("returns blocked for defaultMode=allow with shell", () => {
    const result = classifyRisk(baseManifest({
      sandbox: {
        defaultMode: "allow",
        filesystemMode: "deny",
        shellMode: "allow_list",
        networkMode: "deny",
        secretsMode: "deny"
      },
      permissions: {
        shell: { allowedCommands: ["git"] }
      }
    }));
    expect(result.level).toBe("blocked");
    expect(result.reasons[0]).toContain("defaultMode");
  });

  it("returns blocked for shellMode=ask", () => {
    const result = classifyRisk(baseManifest({
      sandbox: {
        defaultMode: "deny",
        filesystemMode: "deny",
        shellMode: "ask",
        networkMode: "deny",
        secretsMode: "deny"
      }
    }));
    expect(result.level).toBe("blocked");
    expect(result.reasons[0]).toContain("shellMode");
  });

  it("returns blocked for networkMode=ask", () => {
    const result = classifyRisk(baseManifest({
      sandbox: {
        defaultMode: "deny",
        filesystemMode: "deny",
        shellMode: "deny",
        networkMode: "ask",
        secretsMode: "deny"
      }
    }));
    expect(result.level).toBe("blocked");
    expect(result.reasons[0]).toContain("networkMode");
  });

  it("returns blocked for allow_list with empty allowedCommands", () => {
    const result = classifyRisk(baseManifest({
      sandbox: {
        defaultMode: "deny",
        filesystemMode: "deny",
        shellMode: "allow_list",
        networkMode: "deny",
        secretsMode: "deny"
      },
      permissions: {
        shell: { allowedCommands: [] }
      }
    }));
    expect(result.level).toBe("blocked");
    expect(result.reasons[0]).toContain("empty");
  });

  it("returns blocked for allow_list with empty allowedHosts", () => {
    const result = classifyRisk(baseManifest({
      sandbox: {
        defaultMode: "deny",
        filesystemMode: "deny",
        shellMode: "deny",
        networkMode: "allow_list",
        secretsMode: "deny"
      },
      permissions: {
        network: { allowedHosts: [] }
      }
    }));
    expect(result.level).toBe("blocked");
    expect(result.reasons[0]).toContain("empty");
  });
});
