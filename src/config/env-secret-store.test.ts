import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeEnvSecret, loadDotEnvSecrets, defaultEnvPath } from "./env-secret-store.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-env-secret-test-"));
}

describe("writeEnvSecret", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates .env file with the key-value pair", async () => {
    const result = await writeEnvSecret({
      homeDir: tempDir,
      key: "OPENAI_API_KEY",
      value: "sk-test-1234",
    });

    expect(result.path).toBe(join(tempDir, ".estacoda", ".env"));
    expect(result.key).toBe("OPENAI_API_KEY");

    const content = await readFile(result.path, "utf8");
    expect(content).toContain('OPENAI_API_KEY="sk-test-1234"');
  });

  it("replaces existing key instead of duplicating", async () => {
    await writeEnvSecret({ homeDir: tempDir, key: "OPENAI_API_KEY", value: "old-value" });
    await writeEnvSecret({ homeDir: tempDir, key: "OPENAI_API_KEY", value: "new-value" });

    const content = await readFile(join(tempDir, ".estacoda", ".env"), "utf8");
    const matches = content.match(/OPENAI_API_KEY=/gu);
    expect(matches).toHaveLength(1);
    expect(content).toContain('OPENAI_API_KEY="new-value"');
  });

  it("preserves unrelated keys when replacing", async () => {
    await writeEnvSecret({ homeDir: tempDir, key: "OPENAI_API_KEY", value: "old-value" });
    await writeEnvSecret({ homeDir: tempDir, key: "DEEPSEEK_API_KEY", value: "ds-key" });

    const content = await readFile(join(tempDir, ".estacoda", ".env"), "utf8");
    expect(content).toContain('OPENAI_API_KEY="old-value"');
    expect(content).toContain('DEEPSEEK_API_KEY="ds-key"');
  });

  it("quotes special characters safely", async () => {
    await writeEnvSecret({
      homeDir: tempDir,
      key: "SPECIAL_KEY",
      value: 'val\\with"quotes\nnewline',
    });

    const content = await readFile(join(tempDir, ".estacoda", ".env"), "utf8");
    expect(content).toContain('SPECIAL_KEY="val\\\\with\\"quotes\\nnewline"');
  });

  it("sets file permissions to 0600 where supported", async () => {
    await writeEnvSecret({ homeDir: tempDir, key: "K", value: "v" });
    const s = await stat(join(tempDir, ".estacoda", ".env"));
    if (process.platform !== "win32") {
      expect(s.mode & 0o777).toBe(0o600);
    }
  });

  it("uses explicit path when provided", async () => {
    const explicitPath = join(tempDir, "custom.env");
    const result = await writeEnvSecret({ path: explicitPath, key: "K", value: "v" });
    expect(result.path).toBe(explicitPath);
    const content = await readFile(explicitPath, "utf8");
    expect(content).toContain('K="v"');
  });
});

describe("loadDotEnvSecrets", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads secrets into process.env and returns loaded keys", async () => {
    await writeEnvSecret({ homeDir: tempDir, key: "TEST_LOAD_KEY", value: "loaded-val" });
    delete process.env.TEST_LOAD_KEY;

    const loaded = await loadDotEnvSecrets({ homeDir: tempDir });
    expect(loaded).toContain("TEST_LOAD_KEY");
    expect(process.env.TEST_LOAD_KEY).toBe("loaded-val");

    delete process.env.TEST_LOAD_KEY;
  });

  it("does not override existing env vars by default", async () => {
    process.env.TEST_LOAD_KEY = "existing";
    await writeEnvSecret({ homeDir: tempDir, key: "TEST_LOAD_KEY", value: "new-val" });

    const loaded = await loadDotEnvSecrets({ homeDir: tempDir });
    expect(loaded).not.toContain("TEST_LOAD_KEY");
    expect(process.env.TEST_LOAD_KEY).toBe("existing");

    delete process.env.TEST_LOAD_KEY;
  });

  it("overrides existing env vars when override=true", async () => {
    process.env.TEST_LOAD_KEY = "existing";
    await writeEnvSecret({ homeDir: tempDir, key: "TEST_LOAD_KEY", value: "new-val" });

    const loaded = await loadDotEnvSecrets({ homeDir: tempDir, override: true });
    expect(loaded).toContain("TEST_LOAD_KEY");
    expect(process.env.TEST_LOAD_KEY).toBe("new-val");

    delete process.env.TEST_LOAD_KEY;
  });

  it("returns empty array for missing file", async () => {
    const loaded = await loadDotEnvSecrets({ homeDir: tempDir });
    expect(loaded).toEqual([]);
  });

  it("ignores comment lines", async () => {
    await writeEnvSecret({ homeDir: tempDir, key: "REAL_KEY", value: "real" });
    const path = join(tempDir, ".estacoda", ".env");
    const content = await readFile(path, "utf8");
    await writeFile(path, `# comment\n${content}`, "utf8");

    delete process.env.REAL_KEY;
    const loaded = await loadDotEnvSecrets({ homeDir: tempDir });
    expect(loaded).toContain("REAL_KEY");
    expect(process.env.REAL_KEY).toBe("real");
    delete process.env.REAL_KEY;
  });
});

describe("defaultEnvPath", () => {
  it("returns path under homeDir when provided", () => {
    expect(defaultEnvPath("/home/user")).toBe(join("/home/user", ".estacoda", ".env"));
  });
});

// Helper to write file content directly for comment-line test
async function writeFile(path: string, content: string, encoding: BufferEncoding): Promise<void> {
  const { writeFile: wf } = await import("node:fs/promises");
  await wf(path, content, encoding);
}
