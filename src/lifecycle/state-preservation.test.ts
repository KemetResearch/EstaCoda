import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync as nodeReadFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getProtectedPaths,
  backupState,
  restoreState,
  isBackupReady
} from "./state-preservation.js";

function readFileSync(path: string, encoding: BufferEncoding): string {
  return nodeReadFileSync(path, encoding);
}

describe("getProtectedPaths", () => {
  it("includes core user paths", () => {
    const paths = getProtectedPaths("/home/test");
    const labels = paths.map((p) => p.label);
    const sources = paths.map((p) => p.source);
    expect(labels).toContain("active profile pointer");
    expect(labels).toContain("profile state directories");
    expect(labels).toContain("trust store");
    expect(labels).toContain("workspace approvals");
    expect(labels).toContain("session database");
    expect(labels).toContain("memory directory");
    expect(labels).toContain("pack registry");
    expect(sources).toContain("/home/test/.estacoda/profiles");
    expect(sources).toContain("/home/test/.estacoda/memory");
    expect(sources).toContain("/home/test/.estacoda/sessions.sqlite");
    expect(sources).toContain("/home/test/.estacoda/trust.json");
    expect(sources).toContain("/home/test/.estacoda/workspace-approvals.json");
    expect(sources).toContain("/home/test/.estacoda/active-profile.json");
    expect(sources).toContain("/home/test/.estacoda/packs/registry.jsonl");
    expect(sources).not.toContain("/home/test/.estacoda/node_modules");
    expect(sources).not.toContain("/home/test/.estacoda/dist");
    expect(sources).not.toContain("/home/test/.estacoda/logs");
  });

  it("includes project config when workspaceRoot is given", () => {
    const paths = getProtectedPaths("/home/test", "/project");
    const labels = paths.map((p) => p.label);
    expect(labels).toContain("project config");
  });
});

describe("backupState and restoreState", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "estacoda-backup-test-"));
    mkdirSync(join(tempHome, ".estacoda", "profiles", "default"), { recursive: true });
    mkdirSync(join(tempHome, ".estacoda", "memory", "shared"), { recursive: true });
    writeFileSync(join(tempHome, ".estacoda", "active-profile.json"), JSON.stringify({ profileId: "default" }), "utf8");
    writeFileSync(join(tempHome, ".estacoda", "profiles", "default", "config.json"), "{}", "utf8");
    writeFileSync(join(tempHome, ".estacoda", "memory", "shared", "note.txt"), "hello", "utf8");
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("backs up existing protected paths", async () => {
    const result = await backupState({ homeDir: tempHome });
    expect(result.backedUp.length).toBeGreaterThan(0);
    expect(existsSync(result.backupPath)).toBe(true);
    expect(existsSync(join(result.backupPath, "memory", "shared", "note.txt"))).toBe(true);
    expect(existsSync(join(result.backupPath, "node_modules"))).toBe(false);
    expect(existsSync(join(result.backupPath, "dist"))).toBe(false);
    expect(existsSync(join(result.backupPath, "logs"))).toBe(false);
  });

  it("skips missing protected paths without failing the backup", async () => {
    const result = await backupState({ homeDir: tempHome });

    expect(result.backedUp.length).toBeGreaterThan(0);
    expect(result.skipped.some((item) => item.includes("trust store"))).toBe(true);
    expect(result.skipped.some((item) => item.includes("workspace approvals"))).toBe(true);
    expect(result.skipped.some((item) => item.includes("session database"))).toBe(true);
    expect(result.skipped.some((item) => item.includes("pack registry"))).toBe(true);
    expect(existsSync(result.backupPath)).toBe(true);
  });

  it("restores backed-up files", async () => {
    const backup = await backupState({ homeDir: tempHome });

    // Modify original
    writeFileSync(join(tempHome, ".estacoda", "profiles", "default", "config.json"), "{\"changed\":true}", "utf8");

    const restore = await restoreState(backup.backupPath);
    expect(restore.restored.length).toBeGreaterThan(0);

    const restoredContent = readFileSync(join(tempHome, ".estacoda", "profiles", "default", "config.json"), "utf8");
    expect(restoredContent).toBe("{}");
  });
});

describe("isBackupReady", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "estacoda-backup-ready-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("returns ok for a writable directory", async () => {
    const result = await isBackupReady(tempHome);
    expect(result.ok).toBe(true);
  });
});
