import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeCapabilitySecret } from "./capability-setup.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-capability-secret-test-"));
}

describe("storeCapabilitySecret", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes secret to .env and returns only safe references", async () => {
    const result = await storeCapabilitySecret({
      homeDir: tempDir,
      envName: "FAL_KEY",
      secret: "raw-fal-secret-1234",
    });

    expect(result.envName).toBe("FAL_KEY");
    expect(result.secretPath).toBe(join(tempDir, ".estacoda", ".env"));

    const envContent = await readFile(result.secretPath, "utf8");
    expect(envContent).toContain('FAL_KEY="raw-fal-secret-1234"');

    // Result must never contain raw secret value
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain("raw-fal-secret-1234");
    expect(resultJson).toContain("FAL_KEY");
    expect(resultJson).toContain(".estacoda");
  });

  it("sets .env permissions to 0600 where supported", async () => {
    const result = await storeCapabilitySecret({
      homeDir: tempDir,
      envName: "TEST_KEY",
      secret: "test-value",
    });

    const s = await stat(result.secretPath);
    if (process.platform !== "win32") {
      expect(s.mode & 0o777).toBe(0o600);
    }
  });

  it("does not leak raw secret in any return field", async () => {
    const result = await storeCapabilitySecret({
      homeDir: tempDir,
      envName: "VOICE_TOOLS_OPENAI_KEY",
      secret: "sk-tts-super-secret-9999",
    });

    const json = JSON.stringify(result);
    expect(json).not.toContain("sk-tts-super-secret-9999");
    expect(json).toContain("VOICE_TOOLS_OPENAI_KEY");
  });
});
