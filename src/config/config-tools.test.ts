import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionEvent } from "../contracts/session.js";
import { InMemorySessionDB } from "../session/in-memory-session-db.js";
import { resolveProfileStateHome } from "./profile-home.js";
import { createConfigTools } from "../tools/config-tools.js";

type CompressionStatusMetadata = {
  compressionStatus: {
    config: {
      enabled: boolean;
      effectiveEnabled: boolean;
      experimental: boolean;
      active: boolean;
      threshold: number;
      targetRatio: number;
      protectFirstN: number;
      protectLastN: number;
      summaryModelContextLength?: number;
    };
    auxiliaryRoute: {
      configured: boolean;
      resolved: boolean;
      provider?: string;
      model?: string;
      timeoutMs?: number;
      fallbackToMain: boolean;
      diagnostics: string[];
    };
    session?: {
      available: boolean;
      state?: {
        compressionCount: number;
        lastCompressedAt?: string;
        lastCompressedThroughMessageId?: string;
        lastPromptTokensEstimated?: number;
        lastActualPromptTokens?: number;
        lastCompressionSavingsPct?: number;
        ineffectiveCompressionCount: number;
        recentSavingsRatios?: number[];
        summaryFailureCooldownUntil?: string;
        latestFallbackReason?: string;
        warningCount: number;
      };
      latestEvent?: {
        trigger?: string;
        mode: string;
        fallbackUsed?: boolean;
        fallbackReason?: string;
        modelUsed?: string;
        summaryLengthTokens?: number;
        sourceMessageCount?: number;
        protectedMessageCount?: number;
        droppedMessageCount?: number;
        warningCount: number;
        failure?: { code: string; message: string };
      };
    };
  };
};

describe("config.compression.status", () => {
  it("reports default disabled compression without session state", async () => {
    const homeDir = await configHome({ model: { provider: "openai", id: "gpt-4o" } });
    const result = await runCompressionStatusTool({ homeDir });

    const status = metadata(result).compressionStatus;
    expect(status.config).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
      experimental: false,
      active: false,
      threshold: 0.5,
      targetRatio: 0.2,
      protectFirstN: 3,
      protectLastN: 20
    });
    expect(status.auxiliaryRoute.configured).toBe(false);
    expect(status.session).toBeUndefined();
    expect(result.content).toContain("Active: no");
  });

  it("shows active false when config requests enabled but experimental is false", async () => {
    const homeDir = await configHome({
      model: { provider: "openai", id: "gpt-4o" },
      compression: {
        enabled: true,
        experimental: false
      }
    });

    const result = await runCompressionStatusTool({ homeDir });

    expect(metadata(result).compressionStatus.config).toMatchObject({
      enabled: true,
      effectiveEnabled: false,
      experimental: false,
      active: false
    });
  });

  it("reports active normalized compression values and auxiliary route without secrets", async () => {
    const homeDir = await configHome({
      model: { provider: "openai", id: "gpt-4o", contextWindowTokens: 128_000 },
      compression: {
        enabled: true,
        experimental: true,
        threshold: 0.99,
        targetRatio: "0.05",
        protectFirstN: "2",
        protectLastN: 0,
        summaryModelContextLength: "64000"
      },
      auxiliaryModels: {
        compression: {
          provider: "openai",
          id: "gpt-4o-mini",
          timeoutMs: 4321,
          fallbackToMain: true,
          apiKeyEnv: "SECRET_COMPRESSION_KEY"
        }
      }
    });

    const result = await runCompressionStatusTool({ homeDir });
    const status = metadata(result).compressionStatus;

    expect(status.config).toMatchObject({
      enabled: true,
      effectiveEnabled: true,
      experimental: true,
      active: true,
      threshold: 0.95,
      targetRatio: 0.1,
      protectFirstN: 2,
      protectLastN: 1,
      summaryModelContextLength: 64_000
    });
    expect(status.auxiliaryRoute).toMatchObject({
      configured: true,
      resolved: true,
      provider: "openai",
      model: "gpt-4o-mini",
      timeoutMs: 4321,
      fallbackToMain: true
    });
    expect(JSON.stringify(status)).not.toContain("SECRET_COMPRESSION_KEY");
    expect(result.content).not.toContain("SECRET_COMPRESSION_KEY");
  });

  it("works when the auxiliary compression route is explicitly missing", async () => {
    const homeDir = await configHome({
      model: { provider: "openai", id: "gpt-4o" },
      auxiliaryModels: {
        compression: {
          enabled: false,
          provider: "openai",
          id: "gpt-4o-mini"
        }
      }
    });

    const result = await runCompressionStatusTool({ homeDir });
    const status = metadata(result).compressionStatus;

    expect(status.auxiliaryRoute).toMatchObject({
      configured: true,
      resolved: false,
      fallbackToMain: false
    });
    expect(status.auxiliaryRoute.diagnostics.join("\n")).toContain("Slot is explicitly disabled");
  });

  it("reads latest session compression state and event without exposing previous summary", async () => {
    const homeDir = await configHome({
      model: { provider: "openai", id: "gpt-4o" },
      compression: { enabled: true, experimental: true }
    });
    const sessionDb = new InMemorySessionDB();
    await sessionDb.createSession({ id: "session-1", profileId: "default" });
    await sessionDb.appendEvent("session-1", {
      kind: "session-history-compressed",
      trigger: "manual",
      source: { startMessageId: "m1", endMessageId: "m10", messageCount: 8, estimatedTokens: 12_000 },
      sourceMessageCount: 10,
      protectedFirstN: 1,
      protectedLastN: 2,
      protectedMessageCount: 3,
      summaryFormatVersion: "v1",
      summaryChars: 1200,
      summaryLengthTokens: 300,
      droppedMessageCount: 6,
      fallbackUsed: true,
      fallbackReason: "deterministic fallback",
      modelUsed: "gpt-4o-mini",
      warnings: ["bounded warning"]
    });
    await sessionDb.appendEvent("session-1", {
      kind: "session-compression-state",
      state: {
        compressionCount: 7,
        lastCompressedAt: "2026-05-20T00:00:00.000Z",
        previousSummary: "previous summary with TOKEN=secretsecretsecretsecretsecret",
        lastCompressedThroughMessageId: "m10",
        lastPromptTokensEstimated: 111,
        lastActualPromptTokens: 99,
        lastCompressionSavingsPct: 42,
        ineffectiveCompressionCount: 1,
        recentSavingsRatios: [0.4, 0.42],
        summaryFailureCooldownUntil: "2026-05-20T00:01:00.000Z",
        fallbackReason: "deterministic fallback",
        warnings: ["raw warning should not be listed"]
      }
    });

    const before = await sessionDb.listEvents("session-1");
    const result = await runCompressionStatusTool({ homeDir, sessionDb, sessionId: "session-1" });
    const after = await sessionDb.listEvents("session-1");
    const status = metadata(result).compressionStatus;

    expect(after).toEqual(before);
    expect(status.session?.state).toMatchObject({
      compressionCount: 7,
      lastCompressedAt: "2026-05-20T00:00:00.000Z",
      lastCompressedThroughMessageId: "m10",
      lastPromptTokensEstimated: 111,
      lastActualPromptTokens: 99,
      lastCompressionSavingsPct: 42,
      ineffectiveCompressionCount: 1,
      recentSavingsRatios: [0.4, 0.42],
      summaryFailureCooldownUntil: "2026-05-20T00:01:00.000Z",
      latestFallbackReason: "deterministic fallback",
      warningCount: 1
    });
    expect(status.session?.latestEvent).toMatchObject({
      trigger: "manual",
      mode: "deterministic",
      fallbackUsed: true,
      fallbackReason: "deterministic fallback",
      modelUsed: "gpt-4o-mini",
      summaryLengthTokens: 300,
      sourceMessageCount: 10,
      protectedMessageCount: 3,
      droppedMessageCount: 6,
      warningCount: 1
    });
    expect(JSON.stringify(status)).not.toContain("previous summary");
    expect(JSON.stringify(status)).not.toContain("secretsecret");
  });

  it("handles malformed state and redacts bounded latest event failures", async () => {
    const homeDir = await configHome({ model: { provider: "openai", id: "gpt-4o" } });
    const listEvents = vi.fn(async () => [
      {
        kind: "session-compression-state",
        state: {
          compressionCount: "bad",
          previousSummary: "TOKEN=secretsecretsecretsecretsecret",
          warnings: ["warning TOKEN=secretsecretsecretsecretsecret"]
        }
      },
      {
        kind: "session-history-compressed",
        trigger: "auto",
        fallbackReason: "api_key=secretsecretsecretsecretsecret " + "x".repeat(500),
        warnings: ["raw warning TOKEN=secretsecretsecretsecretsecret"],
        failure: {
          code: "provider",
          message: "TOKEN=secretsecretsecretsecretsecret " + "x".repeat(500)
        }
      }
    ] as unknown as SessionEvent[]);

    const result = await runCompressionStatusTool({
      homeDir,
      sessionId: "session-1",
      sessionDb: { listEvents }
    });
    const status = metadata(result).compressionStatus;
    const statusJson = JSON.stringify(status);

    expect(status.session?.state?.compressionCount).toBe(0);
    expect(status.session?.latestEvent?.failure?.message).toContain("TOKEN=[REDACTED]");
    expect(status.session?.latestEvent?.failure?.message.length).toBeLessThan(320);
    expect(status.session?.latestEvent?.fallbackReason).toContain("api_key=[REDACTED]");
    expect(statusJson).not.toContain("secretsecret");
    expect(statusJson).not.toContain("raw warning TOKEN");
  });

  it("does not expose a compression setup tool", () => {
    const tools = createConfigTools({ workspaceRoot: "/tmp/workspace", homeDir: "/tmp/home" });
    expect(tools.map((tool) => tool.name)).toContain("config.compression.status");
    expect(tools.map((tool) => tool.name)).not.toContain("config.compression.setup");
  });
});

async function configHome(config: Record<string, unknown>): Promise<string> {
  const homeDir = await mkdtemp(join(tmpdir(), "estacoda-compression-status-"));
  const configPath = resolveProfileStateHome({ homeDir, profileId: "default" }).configPath;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config), "utf8");
  return homeDir;
}

async function runCompressionStatusTool(input: {
  homeDir: string;
  sessionDb?: { listEvents(sessionId: string): Promise<SessionEvent[]> };
  sessionId?: string;
}) {
  const tools = createConfigTools({
    workspaceRoot: input.homeDir,
    homeDir: input.homeDir,
    profileId: "default",
    sessionDb: input.sessionDb,
    sessionId: input.sessionId
  });
  const tool = tools.find((candidate) => candidate.name === "config.compression.status");
  if (tool === undefined) {
    throw new Error("config.compression.status tool not registered");
  }
  return await tool.run({});
}

function metadata(result: Awaited<ReturnType<typeof runCompressionStatusTool>>): CompressionStatusMetadata {
  return result.metadata as CompressionStatusMetadata;
}
