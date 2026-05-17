import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInitCommand, bootstrapStateDirectories } from "./init-command.js";

function defaultProfileConfigPath(homeDir: string): string {
  return join(homeDir, ".estacoda", "profiles", "default", "config.json");
}

function defaultProfileSkillsPath(homeDir: string): string {
  return join(homeDir, ".estacoda", "profiles", "default", "skills");
}

describe("bootstrapStateDirectories", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "estacoda-init-test-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("creates all expected directories", async () => {
    await bootstrapStateDirectories(tempHome);
    expect(existsSync(join(tempHome, ".estacoda", "memory", "shared"))).toBe(true);
    expect(existsSync(join(tempHome, ".estacoda", "packs"))).toBe(true);
    expect(existsSync(join(tempHome, ".estacoda", ".backups"))).toBe(true);
  });
});

describe("runInitCommand", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "estacoda-init-test-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("creates config.json with empty provider config", async () => {
    const result = await runInitCommand({ homeDir: tempHome });
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(existsSync(defaultProfileConfigPath(tempHome))).toBe(true);
    expect(existsSync(defaultProfileSkillsPath(tempHome))).toBe(true);
  });

  it("creates trust.json", async () => {
    await runInitCommand({ homeDir: tempHome });
    expect(existsSync(join(tempHome, ".estacoda", "trust.json"))).toBe(true);
  });

  it("supports concurrent fresh-home init without malformed bootstrap files", async () => {
    const results = await Promise.all(
      Array.from({ length: 16 }, () => runInitCommand({ homeDir: tempHome }))
    );

    expect(results.map((result) => result.exitCode)).toEqual(Array.from({ length: 16 }, () => 0));
    expect(() => JSON.parse(readFileSync(defaultProfileConfigPath(tempHome), "utf8"))).not.toThrow();
    expect(() => JSON.parse(readFileSync(join(tempHome, ".estacoda", "trust.json"), "utf8"))).not.toThrow();
    expect(existsSync(join(defaultProfileSkillsPath(tempHome), ".evolution"))).toBe(true);
  });

  it("supports repeated init after initialization", async () => {
    const first = await runInitCommand({ homeDir: tempHome });
    const second = await runInitCommand({ homeDir: tempHome });

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(() => JSON.parse(readFileSync(defaultProfileConfigPath(tempHome), "utf8"))).not.toThrow();
    expect(() => JSON.parse(readFileSync(join(tempHome, ".estacoda", "trust.json"), "utf8"))).not.toThrow();
  });

  it("fails when homeDir is empty and state root cannot be resolved", async () => {
    const result = await runInitCommand({ homeDir: "" });
    expect(result.exitCode).toBe(1);
  });
});
