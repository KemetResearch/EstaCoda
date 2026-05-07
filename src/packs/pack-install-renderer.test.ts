import { describe, it, expect } from "vitest";
import { renderPackReview } from "./pack-install-renderer.js";
import type { PackManifest } from "../contracts/pack.js";
import type { PackRiskClassification } from "./pack-risk-classifier.js";

function makeManifest(overrides?: Partial<PackManifest>): PackManifest {
  return {
    id: "github-ops",
    name: "GitHub Operations",
    version: "0.1.0",
    description: "GitHub operations pack",
    packType: "skill_pack",
    entrypoints: {},
    permissions: {
      filesystem: { read: ["project"], write: [".estacoda/artifacts"] },
      shell: { allowedCommands: ["git"], requiresApproval: true },
      network: { allowedHosts: ["github.com"], requiresApproval: true },
      secrets: { requiredEnvironmentVariables: ["GITHUB_TOKEN"] },
      memory: { canRead: true, canWrite: true, requiresPromotionApproval: true }
    },
    provenance: {
      origin: "external",
      trustLevel: "external_untrusted"
    },
    sandbox: {
      defaultMode: "deny",
      filesystemMode: "scoped_write",
      shellMode: "allow_list",
      networkMode: "allow_list",
      secretsMode: "explicit_only"
    },
    ...overrides
  };
}

describe("renderPackReview", () => {
  it("matches the roadmap example format", () => {
    const manifest = makeManifest();
    const risk: PackRiskClassification = { level: "medium", reasons: ["external reviewed provenance", "requests network access"] };
    const output = renderPackReview(manifest, risk);

    expect(output).toContain("pack: GitHub Operations");
    expect(output).toContain("Origin: external");
    expect(output).toContain("Version: 0.1.0");
    expect(output).toContain("Trust: unverified external");
    expect(output).toContain("Filesystem:");
    expect(output).toContain("Shell: asks before running commands");
    expect(output).toContain("Network: github.com");
    expect(output).toContain("Secrets: GITHUB_TOKEN required");
    expect(output).toContain("Memory:");
    expect(output).toContain("Risk: medium");
    expect(output).toContain("Default status: disabled until enabled");
  });

  it("renders denied shell and network when empty", () => {
    const manifest = makeManifest({
      permissions: {
        filesystem: { read: ["project"] }
      },
      sandbox: {
        defaultMode: "deny",
        filesystemMode: "read_only",
        shellMode: "deny",
        networkMode: "deny",
        secretsMode: "deny"
      }
    });
    const risk: PackRiskClassification = { level: "low", reasons: ["read-only, bundled/local provenance, no secrets, no shell"] };
    const output = renderPackReview(manifest, risk);

    expect(output).toContain("Shell: denied");
    expect(output).toContain("Network: denied");
    expect(output).toContain("Secrets: none");
    expect(output).toContain("Risk: low");
  });

  it("renders enabled default status for bundled", () => {
    const manifest = makeManifest({
      provenance: { origin: "bundled", trustLevel: "first_party" }
    });
    const risk: PackRiskClassification = { level: "low", reasons: [] };
    const output = renderPackReview(manifest, risk);

    expect(output).toContain("Default status: enabled");
  });
});
