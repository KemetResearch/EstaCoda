import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleSlashCommand } from "./session-loop.js";
import { loadRuntimeConfig, setupProviderConfig } from "../config/runtime-config.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";

function fakeRuntime(modelInfo: {
  provider: string;
  model: string;
  contextWindowTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
}) {
  return {
    sessionId: "test-session",
    getModelInfo: () => ({
      kind: "kv" as const,
      title: "Model",
      entries: [
        { key: "provider", value: modelInfo.provider },
        { key: "model", value: modelInfo.model },
        { key: "context window", value: String(modelInfo.contextWindowTokens) }
      ]
    }),
    getStatus: () => ({
      kind: "status" as const,
      title: "EstaCoda is ready",
      lines: []
    }),
    tools: () => [],
    dispose: async () => {}
  } as any;
}

describe("session-loop /model", () => {
  let tempHome: string;
  let outputChunks: string[];
  let output: NodeJS.WritableStream;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "estacoda-session-model-test-"));
    outputChunks = [];
    output = {
      write: (chunk: string | Buffer) => { outputChunks.push(String(chunk)); },
      end: () => {}
    } as NodeJS.WritableStream;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("/model shows current model info", async () => {
    const runtime = fakeRuntime({
      provider: "local",
      model: "qwen2.5:3b",
      contextWindowTokens: 128000,
      supportsTools: true,
      supportsVision: false,
      supportsStructuredOutput: true
    });

    const result = await handleSlashCommand({
      text: "/model",
      runtime,
      output,
      renderer: { render: renderPlain },
      workspaceRoot: tempHome,
      homeDir: tempHome
    });

    expect(result).toBe(false);
    expect(outputChunks.join("")).toContain("provider: local");
    expect(outputChunks.join("")).toContain("model: qwen2.5:3b");
  });

  it("/model set switches the active model and persists to config", async () => {
    const estacodaDir = join(tempHome, ".estacoda");
    mkdirSync(estacodaDir, { recursive: true });
    writeFileSync(join(estacodaDir, "config.json"), JSON.stringify({
      providers: {
        local: {
          kind: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          models: ["qwen2.5:3b", "phi4:latest"],
          enableNetwork: true
        }
      },
      primaryModel: "local/qwen2.5:3b"
    }));

    const runtime = fakeRuntime({
      provider: "local",
      model: "qwen2.5:3b",
      contextWindowTokens: 128000,
      supportsTools: true,
      supportsVision: false,
      supportsStructuredOutput: true
    });

    const refreshedModels: string[] = [];

    const result = await handleSlashCommand({
      text: "/model set local/phi4:latest",
      runtime,
      output,
      renderer: { render: renderPlain },
      workspaceRoot: tempHome,
      homeDir: tempHome,
      refreshRuntime: async () => {
        refreshedModels.push("refreshed");
        return runtime;
      }
    });

    expect(typeof result).not.toBe("boolean");
    expect(result).toHaveProperty("runtime");
    expect(result).toHaveProperty("notice");
    const noticeText = (result as any).notice(runtime);
    expect(noticeText).toContain("Switched to local/phi4:latest");

    const config = await loadRuntimeConfig({ workspaceRoot: tempHome, homeDir: tempHome });
    expect(config.model.provider).toBe("local");
    expect(config.model.id).toBe("phi4:latest");
  });

  it("/model set rejects unknown provider", async () => {
    const estacodaDir = join(tempHome, ".estacoda");
    mkdirSync(estacodaDir, { recursive: true });
    writeFileSync(join(estacodaDir, "config.json"), JSON.stringify({
      providers: {
        local: {
          kind: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          models: ["qwen2.5:3b"],
          enableNetwork: true
        }
      },
      primaryModel: "local/qwen2.5:3b"
    }));

    const runtime = fakeRuntime({
      provider: "local",
      model: "qwen2.5:3b",
      contextWindowTokens: 128000,
      supportsTools: true,
      supportsVision: false,
      supportsStructuredOutput: true
    });

    const result = await handleSlashCommand({
      text: "/model set unknown/model",
      runtime,
      output,
      renderer: { render: renderPlain },
      workspaceRoot: tempHome,
      homeDir: tempHome
    });

    expect(result).toBe(false);
    expect(outputChunks.join("")).toContain('provider "unknown" is not configured');
  });

  it("/model set rejects unknown model for known provider", async () => {
    const estacodaDir = join(tempHome, ".estacoda");
    mkdirSync(estacodaDir, { recursive: true });
    writeFileSync(join(estacodaDir, "config.json"), JSON.stringify({
      providers: {
        local: {
          kind: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          models: ["qwen2.5:3b"],
          enableNetwork: true
        }
      },
      primaryModel: "local/qwen2.5:3b"
    }));

    const runtime = fakeRuntime({
      provider: "local",
      model: "qwen2.5:3b",
      contextWindowTokens: 128000,
      supportsTools: true,
      supportsVision: false,
      supportsStructuredOutput: true
    });

    const result = await handleSlashCommand({
      text: "/model set local/nonexistent",
      runtime,
      output,
      renderer: { render: renderPlain },
      workspaceRoot: tempHome,
      homeDir: tempHome
    });

    expect(result).toBe(false);
    expect(outputChunks.join("")).toContain('model "nonexistent" is not listed');
  });

  it("/model set rejects missing slash syntax", async () => {
    const runtime = fakeRuntime({
      provider: "local",
      model: "qwen2.5:3b",
      contextWindowTokens: 128000,
      supportsTools: true,
      supportsVision: false,
      supportsStructuredOutput: true
    });

    const result = await handleSlashCommand({
      text: "/model set badmodel",
      runtime,
      output,
      renderer: { render: renderPlain },
      workspaceRoot: tempHome,
      homeDir: tempHome
    });

    expect(result).toBe(false);
    expect(outputChunks.join("")).toContain('expected <provider>/<model>');
  });
});
