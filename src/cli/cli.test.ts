import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCliCommand } from "./cli.js";
import type { Prompt } from "./readline-prompt.js";

describe("runCliCommand WhatsApp dispatch", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "estacoda-cli-whatsapp-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("dispatches estacoda whatsapp to the single setup wizard", async () => {
    const result = await runCliCommand({
      argv: ["whatsapp"],
      workspaceRoot: tempDir,
      homeDir: tempDir,
      prompt: fakePrompt(["cancel"]),
      whatsappWizardDependencies: {
        getDependencyStatus: async () => ({
          bridgeDir: "/tmp/bridge",
          packagePresent: true,
          lockfilePresent: true,
          entrypointPresent: true,
          nodeModulesPresent: true,
          missing: [],
        }),
        installDependencies: vi.fn(),
        pairDevice: vi.fn(),
      },
    });

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("EstaCoda WhatsApp setup");
  });

  it("does not expose WhatsApp subcommands", async () => {
    const result = await runCliCommand({
      argv: ["whatsapp", "status"],
      workspaceRoot: tempDir,
      homeDir: tempDir,
    });

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("single command");
  });
});

function fakePrompt(answers: string[]): Prompt {
  const prompt = vi.fn(async () => answers.shift() ?? "");
  return prompt as unknown as Prompt;
}
