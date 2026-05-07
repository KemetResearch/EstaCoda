import { describe, it, expect } from "vitest";
import { classifyPackRisk } from "./pack-risk-classifier.js";
import type { PackManifest } from "../contracts/pack.js";

function baseManifest(overrides?: Partial<PackManifest>): PackManifest {
  return {
    id: "test",
    name: "Test",
    version: "1.0.0",
    description: "Test",
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
    },
    ...overrides
  };
}

describe("classifyPackRisk", () => {
  it("returns low for read-only bundled", () => {
    const result = classifyPackRisk(baseManifest());
    expect(result.level).toBe("low");
  });

  it("returns high for external with shell", () => {
    const result = classifyPackRisk(baseManifest({
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
    const result = classifyPackRisk(baseManifest({
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
    const result = classifyPackRisk(baseManifest({ id: "" }));
    expect(result.level).toBe("blocked");
  });

  it("returns blocked for permission findings", () => {
    const result = classifyPackRisk(baseManifest({
      permissions: {
        shell: { allowedCommands: ["*"] }
      }
    }));
    expect(result.level).toBe("blocked");
  });

  it("returns blocked for defaultMode=allow with shell", () => {
    const result = classifyPackRisk(baseManifest({
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
    const result = classifyPackRisk(baseManifest({
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
    const result = classifyPackRisk(baseManifest({
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
    const result = classifyPackRisk(baseManifest({
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
    const result = classifyPackRisk(baseManifest({
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
