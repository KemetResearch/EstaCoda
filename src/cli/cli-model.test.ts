import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliCommand } from "./cli.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-cli-model-test-"));
}

async function writeUserConfig(homeDir: string, config: unknown): Promise<void> {
  const configPath = join(homeDir, ".estacoda", "config.json");
  await mkdir(join(homeDir, ".estacoda"), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function readUserConfig(homeDir: string): Promise<unknown> {
  const configPath = join(homeDir, ".estacoda", "config.json");
  const content = await readFile(configPath, "utf8");
  return JSON.parse(content);
}

describe("cli model", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("bare model command", () => {
    it("renders overview plus command guide without writing config", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        }
      });

      const result = await runCliCommand({
        argv: ["model"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Primary:");
      expect(result.output).toContain("Status:");
      expect(result.output).toContain("Fallbacks:");
      expect(result.output).toContain("Commands:");
      expect(result.output).toContain("estacoda model status");
      expect(result.output).toContain("estacoda model diagnose");
      expect(result.output).toContain("estacoda model set");
      expect(result.output).toContain("estacoda model fallback status");
      expect(result.output).toContain("estacoda model fallback add");
      expect(result.output).toContain("estacoda model fallback remove");
      expect(result.output).toContain("estacoda model fallback reorder");
      expect(result.output).toContain("estacoda model fallback clear");
    });
  });

  describe("model status", () => {
    it("renders current effective model state offline", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        }
      });

      const result = await runCliCommand({
        argv: ["model", "status"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Primary: local/qwen2.5:3b");
      expect(result.output).toContain("Context window:");
      expect(result.output).toContain("Tools:");
      expect(result.output).toContain("Vision:");
      expect(result.output).toContain("Structured output:");
      expect(result.output).toContain("Network:");
      expect(result.output).toContain("Fallbacks: none");
    });
  });

  describe("model diagnose", () => {
    it("renders readiness/failure analysis", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        }
      });

      const result = await runCliCommand({
        argv: ["model", "diagnose"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.output).toContain("EstaCoda model diagnose");
      expect(result.output).toContain("Selected route:");
      expect(result.output).toContain("Fallback chain:");
    });

    it("ignores deprecated auxiliaryProviders and does not affect diagnostics or fallback routes", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        },
        auxiliaryProviders: {}
      });

      const result = await runCliCommand({
        argv: ["model", "diagnose"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      // auxiliaryProviders should not appear in output at all
      expect(result.output).not.toContain("auxiliaryProviders");
      // Model should still resolve correctly
      expect(result.output).toContain("Selected route: local/qwen2.5:3b");
      // Fallback chain should be empty, not populated from auxiliaryProviders
      expect(result.output).toContain("Fallback chain: none configured");
    });

    it("shows auxiliary models section with auto-resolved routes", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        }
      });

      const result = await runCliCommand({
        argv: ["model", "diagnose"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.output).toContain("Auxiliary models:");
      expect(result.output).toContain("vision:");
      expect(result.output).toContain("approval:");
    });
  });

  describe("model auxiliary status", () => {
    it("renders the auxiliary task list", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        }
      });

      const result = await runCliCommand({
        argv: ["model", "auxiliary", "status"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Auxiliary model status:");
      expect(result.output).toContain("vision:");
      expect(result.output).toContain("approval:");
    });

    it("shows command guide when no subcommand given", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        }
      });

      const result = await runCliCommand({
        argv: ["model", "auxiliary"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("estacoda model auxiliary status");
    });
  });

  describe("model fallback status", () => {
    it("shows empty state", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        }
      });

      const result = await runCliCommand({
        argv: ["model", "fallback", "status"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fallback status: empty");
      expect(result.output).toContain("No fallback routes are configured");
    });

    it("shows configured state", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b", "phi4:latest"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b",
          fallbacks: [
            { provider: "local", id: "phi4:latest" }
          ]
        }
      });

      const result = await runCliCommand({
        argv: ["model", "fallback", "status"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fallback status: configured");
      expect(result.output).toContain("1. local/phi4:latest");
      expect(result.output).toContain("Context window:");
      expect(result.output).toContain("Tools:");
      expect(result.output).toContain("Vision:");
      expect(result.output).toContain("Structured output:");
    });
  });

  describe("model fallback add", () => {
    it("writes expected config", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b", "phi4:latest"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b"
        }
      });

      const result = await runCliCommand({
        argv: ["model", "fallback", "add", "local/phi4:latest"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Added fallback local/phi4:latest");

      const config = await readUserConfig(tmpDir) as any;
      expect(config.model?.fallbacks).toHaveLength(1);
      expect(config.model?.fallbacks?.[0]).toEqual({
        provider: "local",
        id: "phi4:latest"
      });
    });

    it("preserves baseUrl and apiKeyEnv", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          openai: {
            kind: "openai-compatible",
            models: ["gpt-4.1-mini"],
            enableNetwork: true
          }
        },
        model: {
          provider: "openai",
          id: "gpt-4.1-mini"
        }
      });

      const result = await runCliCommand({
        argv: ["model", "fallback", "add", "openai/gpt-4.1-mini", "--base-url", "https://api.openai.com/v1", "--api-key-env", "OPENAI_API_KEY"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);

      const config = await readUserConfig(tmpDir) as any;
      expect(config.model?.fallbacks?.[0]).toEqual({
        provider: "openai",
        id: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY"
      });
    });
  });

  describe("model fallback remove", () => {
    it("removes exact route", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b", "phi4:latest"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b",
          fallbacks: [
            { provider: "local", id: "phi4:latest" }
          ]
        }
      });

      const result = await runCliCommand({
        argv: ["model", "fallback", "remove", "local/phi4:latest"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Removed fallback local/phi4:latest");

      const config = await readUserConfig(tmpDir) as any;
      expect(config.model?.fallbacks ?? []).toHaveLength(0);
    });
  });

  describe("model fallback reorder", () => {
    it("updates order without changing contents", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b", "phi4:latest", "llama3.1:latest"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b",
          fallbacks: [
            { provider: "local", id: "phi4:latest" },
            { provider: "local", id: "llama3.1:latest" }
          ]
        }
      });

      const result = await runCliCommand({
        argv: ["model", "fallback", "reorder", "local/llama3.1:latest", "local/phi4:latest"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Reordered fallback chain");

      const config = await readUserConfig(tmpDir) as any;
      expect(config.model?.fallbacks).toHaveLength(2);
      expect(config.model?.fallbacks?.[0]?.id).toBe("llama3.1:latest");
      expect(config.model?.fallbacks?.[1]?.id).toBe("phi4:latest");
    });
  });

  describe("model fallback clear", () => {
    it("removes all entries after confirmation", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b", "phi4:latest"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b",
          fallbacks: [
            { provider: "local", id: "phi4:latest" }
          ]
        }
      });

      const result = await runCliCommand({
        argv: ["model", "fallback", "clear", "--yes"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Cleared all fallback routes");

      const config = await readUserConfig(tmpDir) as any;
      expect(config.model?.fallbacks ?? []).toHaveLength(0);
    });

    it("requires --yes confirmation", async () => {
      await writeUserConfig(tmpDir, {
        providers: {
          local: {
            kind: "openai-compatible",
            baseUrl: "http://localhost:11434/v1",
            models: ["qwen2.5:3b", "phi4:latest"],
            enableNetwork: true
          }
        },
        model: {
          provider: "local",
          id: "qwen2.5:3b",
          fallbacks: [
            { provider: "local", id: "phi4:latest" }
          ]
        }
      });

      const result = await runCliCommand({
        argv: ["model", "fallback", "clear"],
        workspaceRoot: tmpDir,
        homeDir: tmpDir
      });

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("--yes");

      const config = await readUserConfig(tmpDir) as any;
      expect(config.model?.fallbacks).toHaveLength(1);
    });
  });
});
