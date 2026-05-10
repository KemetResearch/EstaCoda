import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliCommand } from "./cli.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-cli-setup-test-"));
}

describe("cli setup command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    await mkdir(join(tempDir, "workspace"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps no-arg noninteractive setup output deterministic", async () => {
    const input = {
      argv: ["setup"],
      workspaceRoot: join(tempDir, "workspace"),
      homeDir: tempDir,
      interactive: false,
    };

    const first = await runCliCommand(input);
    const second = await runCliCommand(input);

    expect(first.handled).toBe(true);
    expect(first.exitCode).toBe(0);
    expect(first.output).toBe(second.output);
    expect(first.output).toContain("EstaCoda setup");
    expect(first.output).toContain("Recommended path:");
    expect(first.output).toContain("Direct provider example:");
  });

  it("preserves direct noninteractive provider setup flags", async () => {
    const workspaceRoot = join(tempDir, "workspace");
    const result = await runCliCommand({
      argv: ["setup", "--provider", "local", "--model", "hermes-local", "--offline", "--user"],
      workspaceRoot,
      homeDir: tempDir,
      interactive: false,
    });
    const config = JSON.parse(await readFile(join(tempDir, ".estacoda", "config.json"), "utf8")) as {
      model?: { provider?: string; id?: string };
      providers?: Record<string, { enableNetwork?: boolean; models?: string[] }>;
    };

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Configured local/hermes-local.");
    expect(config.model).toEqual({ provider: "local", id: "hermes-local" });
    expect(config.providers?.local?.enableNetwork).toBe(false);
    expect(config.providers?.local?.models).toContain("hermes-local");
  });
});
