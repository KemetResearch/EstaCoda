import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRuntimeConfig } from "./runtime-config.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-config-test-"));
}

describe("loadRuntimeConfig busyPolicy normalization", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("defaults busyPolicy to reject and queueDepth to 3", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, JSON.stringify({ model: { provider: "test", id: "test" } }));

    const loaded = await loadRuntimeConfig({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      userConfigPath: configPath,
    });

    expect(loaded.channels.telegram.busyPolicy).toBe("reject");
    expect(loaded.channels.telegram.queueDepth).toBe(3);
    expect(loaded.channels.discord.busyPolicy).toBe("reject");
    expect(loaded.channels.discord.queueDepth).toBe(3);
    expect(loaded.channels.email.busyPolicy).toBe("reject");
    expect(loaded.channels.email.queueDepth).toBe(3);
    expect(loaded.channels.whatsapp.busyPolicy).toBe("reject");
    expect(loaded.channels.whatsapp.queueDepth).toBe(3);
  });

  it("preserves explicit per-channel busyPolicy and queueDepth", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, JSON.stringify({
      model: { provider: "test", id: "test" },
      channels: {
        telegram: { enabled: false, busyPolicy: "queue", queueDepth: 5 },
        discord: { enabled: false, busyPolicy: "interrupt", queueDepth: 2 },
        email: { enabled: false, busyPolicy: "reject", queueDepth: 1 },
        whatsapp: { enabled: false, busyPolicy: "queue", queueDepth: 10 },
      },
    }));

    const loaded = await loadRuntimeConfig({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      userConfigPath: configPath,
    });

    expect(loaded.channels.telegram.busyPolicy).toBe("queue");
    expect(loaded.channels.telegram.queueDepth).toBe(5);
    expect(loaded.channels.discord.busyPolicy).toBe("interrupt");
    expect(loaded.channels.discord.queueDepth).toBe(2);
    expect(loaded.channels.email.busyPolicy).toBe("reject");
    expect(loaded.channels.email.queueDepth).toBe(1);
    expect(loaded.channels.whatsapp.busyPolicy).toBe("queue");
    expect(loaded.channels.whatsapp.queueDepth).toBe(10);
  });

  it("clamps queueDepth to [1, 10]", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, JSON.stringify({
      model: { provider: "test", id: "test" },
      channels: {
        telegram: { enabled: false, queueDepth: 0 },
        discord: { enabled: false, queueDepth: 100 },
        email: { enabled: false, queueDepth: -5 },
        whatsapp: { enabled: false, queueDepth: 5 },
      },
    }));

    const loaded = await loadRuntimeConfig({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      userConfigPath: configPath,
    });

    expect(loaded.channels.telegram.queueDepth).toBe(1);
    expect(loaded.channels.discord.queueDepth).toBe(10);
    expect(loaded.channels.email.queueDepth).toBe(1);
    expect(loaded.channels.whatsapp.queueDepth).toBe(5);
  });

  it("falls back invalid busyPolicy to reject", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, JSON.stringify({
      model: { provider: "test", id: "test" },
      channels: {
        telegram: { enabled: false, busyPolicy: "unknown" },
      },
    }));

    const loaded = await loadRuntimeConfig({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      userConfigPath: configPath,
    });

    expect(loaded.channels.telegram.busyPolicy).toBe("reject");
  });

  it("isolates per-channel queueDepth", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, JSON.stringify({
      model: { provider: "test", id: "test" },
      channels: {
        telegram: { enabled: false, queueDepth: 7 },
        discord: { enabled: false, queueDepth: 3 },
      },
    }));

    const loaded = await loadRuntimeConfig({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      userConfigPath: configPath,
    });

    expect(loaded.channels.telegram.queueDepth).toBe(7);
    expect(loaded.channels.discord.queueDepth).toBe(3);
    expect(loaded.channels.email.queueDepth).toBe(3);
    expect(loaded.channels.whatsapp.queueDepth).toBe(3);
  });
});
