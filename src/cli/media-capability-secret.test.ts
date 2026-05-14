import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliCommand } from "./cli.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-media-secret-test-"));
}

describe("media capability setup does not render raw secrets", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    await mkdir(join(tempDir, ".estacoda"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("image setup with --api-key writes .env and outputs only safe path references", async () => {
    const rawKey = "sk-image-gen-secret-8888";
    const result = await runCliCommand({
      argv: ["image", "setup", "--provider", "fal", "--api-key", rawKey],
      workspaceRoot: tempDir,
      homeDir: tempDir,
    });

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain(rawKey);
    expect(result.output).toContain("Secret store:");
    expect(result.output).toContain(".estacoda");
    expect(result.output).toContain("FAL_KEY");
  });

  it("voice setup with --tts-api-key writes .env and outputs only safe path references", async () => {
    const rawKey = "sk-tts-secret-7777";
    const result = await runCliCommand({
      argv: ["voice", "setup", "--tts-provider", "openai", "--tts-api-key", rawKey],
      workspaceRoot: tempDir,
      homeDir: tempDir,
    });

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain(rawKey);
    expect(result.output).toContain("Secret store:");
    expect(result.output).toContain(".estacoda");
    expect(result.output).toContain("VOICE_TOOLS_OPENAI_KEY");
  });

  it("voice setup with --stt-api-key writes .env and outputs only safe path references", async () => {
    const rawKey = "sk-stt-secret-6666";
    const result = await runCliCommand({
      argv: ["voice", "setup", "--stt-provider", "groq", "--stt-api-key", rawKey],
      workspaceRoot: tempDir,
      homeDir: tempDir,
    });

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain(rawKey);
    expect(result.output).toContain("Secret store:");
    expect(result.output).toContain(".estacoda");
    expect(result.output).toContain("GROQ_API_KEY");
  });
});
