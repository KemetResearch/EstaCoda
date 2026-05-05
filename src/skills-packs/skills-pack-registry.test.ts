import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillsPackRegistry } from "./skills-pack-registry.js";
import type { SkillsPackManifest } from "../contracts/skills-pack.js";

function makeManifest(overrides?: Partial<SkillsPackManifest>): SkillsPackManifest {
  return {
    id: "test-sp",
    name: "Test Skills Pack",
    version: "1.0.0",
    description: "A test skills pack",
    skillsPackType: "skill_pack",
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

describe("SkillsPackRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-sp-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("installs and lists a skills pack", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    const manifest = makeManifest();
    const result = await registry.install(manifest, "test-user");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.manifest.id).toBe("test-sp");
      expect(result.entry.status).toBe("enabled");
    }

    const list = await registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].manifest.id).toBe("test-sp");
  });

  it("finds a skills pack by id", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    const found = await registry.find("test-sp");
    expect(found).toBeDefined();
    expect(found!.manifest.id).toBe("test-sp");
  });

  it("returns undefined for missing skills pack", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    const found = await registry.find("missing");
    expect(found).toBeUndefined();
  });

  it("defaults external to disabled", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
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
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    const result = await registry.install(makeManifest(), "test-user");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.status).toBe("enabled");
    }
  });

  it("rejects invalid manifests", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    const bad = makeManifest({ id: "" });
    const result = await registry.install(bad, "test-user");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate ids", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    const result = await registry.install(makeManifest(), "test-user");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("already installed");
    }
  });

  it("updates status", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    const updated = await registry.updateStatus("test-sp", "disabled");
    expect(updated).toBe(true);
    const found = await registry.find("test-sp");
    expect(found!.status).toBe("disabled");
  });

  it("returns false updating missing skills pack", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    const updated = await registry.updateStatus("missing", "disabled");
    expect(updated).toBe(false);
  });

  it("removes a skills pack", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    const removed = await registry.remove("test-sp");
    expect(removed).toBe(true);
    const list = await registry.list();
    expect(list).toHaveLength(0);
  });

  it("returns false removing missing skills pack", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    const removed = await registry.remove("missing");
    expect(removed).toBe(false);
  });

  it("skips malformed lines on read", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");

    // Append a malformed line directly to the file
    const { appendFile } = await import("node:fs/promises");
    const path = join(tmpDir, ".estacoda", "skills-packs", "registry.jsonl");
    await appendFile(path, "not-json\n", "utf8");

    const list = await registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].manifest.id).toBe("test-sp");
  });

  it("getErrors reports validation failures", async () => {
    const registry = new SkillsPackRegistry({ homeDir: tmpDir });
    await registry.install(makeManifest(), "test-user");
    await registry.updateStatus("test-sp", "error");
    const errors = await registry.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe("test-sp");
  });
});
