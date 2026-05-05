import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInitCommand, bootstrapStateDirectories } from "./init-command.js";

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
    expect(existsSync(join(tempHome, ".estacoda", "memory"))).toBe(true);
    expect(existsSync(join(tempHome, ".estacoda", "skills", "local"))).toBe(true);
    expect(existsSync(join(tempHome, ".estacoda", "skills", ".evolution"))).toBe(true);
    expect(existsSync(join(tempHome, ".estacoda", "capabilities"))).toBe(true);
    expect(existsSync(join(tempHome, ".estacoda", "cron"))).toBe(true);
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
    expect(existsSync(join(tempHome, ".estacoda", "config.json"))).toBe(true);
  });

  it("creates trust.json", async () => {
    await runInitCommand({ homeDir: tempHome });
    expect(existsSync(join(tempHome, ".estacoda", "trust.json"))).toBe(true);
  });

  it("creates sessions.sqlite", async () => {
    await runInitCommand({ homeDir: tempHome });
    expect(existsSync(join(tempHome, ".estacoda", "sessions.sqlite"))).toBe(true);
  });

  it("fails when homeDir is empty and HOME is unset", async () => {
    const originalHome = process.env.HOME;
    delete process.env.HOME;
    const result = await runInitCommand({});
    expect(result.exitCode).toBe(1);
    process.env.HOME = originalHome;
  });
});
