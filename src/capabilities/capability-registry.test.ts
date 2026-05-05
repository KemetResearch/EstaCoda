import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityRegistry } from "./capability-registry.js";
import type { CapabilityManifest } from "../contracts/capability.js";

function makeManifest(overrides?: Partial<CapabilityManifest>): CapabilityManifest {
  return {
    id: "test-cap",
    name: "Test Cap",
    version: "1.0.0",
    description: "A test capability",
    capabilityType: "skill_pack",
    entrypoints: {},
    permissions: {},
    provenance: {
      origin: "bundled",
      trustLevel: "first_party",
      ...overrides?.provenance
    },
    sandbox: {
      defaultMode: "deny",
      filesystemMode: "deny",
      shellMode: "deny",
      networkMode: "deny",
      secretsMode: "deny",
      ...overrides?.sandbox
    },
    ...overrides
  };
}

describe("CapabilityRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-cap-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("installs and lists a capability", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    const manifest = makeManifest();
    const result = await registry.install(manifest, "test-user");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.manifest.id).toBe("test-cap");
      expect(result.entry.status).toBe("enabled");
    }

    const list = await registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].manifest.id).toBe("test-cap");
  });

  it("finds a capability by id", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    const found = await registry.find("test-cap");
    expect(found).toBeDefined();
    expect(found!.manifest.id).toBe("test-cap");
  });

  it("returns undefined for missing capability", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    const found = await registry.find("missing");
    expect(found).toBeUndefined();
  });

  it("defaults external to disabled", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    const result = await registry.install(
      makeManifest({ provenance: { origin: "external", trustLevel: "external_untrusted" } }),
      "test-user"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.status).toBe("disabled");
    }
  });

  it("defaults bundled to enabled", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    const result = await registry.install(makeManifest(), "test-user");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.status).toBe("enabled");
    }
  });

  it("rejects invalid manifests", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    const bad = makeManifest({ id: "" });
    const result = await registry.install(bad, "test-user");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate ids", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    const result = await registry.install(makeManifest(), "test-user");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("already installed");
    }
  });

  it("updates status", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    const updated = await registry.updateStatus("test-cap", "disabled");
    expect(updated).toBe(true);
    const found = await registry.find("test-cap");
    expect(found!.status).toBe("disabled");
  });

  it("returns false updating missing capability", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    const updated = await registry.updateStatus("missing", "disabled");
    expect(updated).toBe(false);
  });

  it("removes a capability", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    const removed = await registry.remove("test-cap");
    expect(removed).toBe(true);
    const list = await registry.list();
    expect(list).toHaveLength(0);
  });

  it("returns false removing missing capability", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    const removed = await registry.remove("missing");
    expect(removed).toBe(false);
  });

  it("skips malformed lines on read", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");

    // Append a malformed line directly to the file
    const { appendFile } = await import("node:fs/promises");
    const path = join(tmpDir, ".estacoda", "capabilities", "registry.jsonl");
    await appendFile(path, "not-json\n", "utf8");

    const list = await registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].manifest.id).toBe("test-cap");
  });

  it("getErrors reports validation failures", async () => {
    const registry = new CapabilityRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    await registry.updateStatus("test-cap", "error");
    const errors = await registry.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe("test-cap");
  });
});
