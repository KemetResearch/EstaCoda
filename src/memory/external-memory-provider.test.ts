import { describe, expect, it } from "vitest";
import type { ExternalMemoryProvider } from "../contracts/memory.js";
import {
  collectExternalMemoryRecall,
  externalMemoryProviderStatuses,
  EXTERNAL_RECALL_UNTRUSTED_NOTICE,
  mirrorMemoryWriteToExternalProviders
} from "./external-memory-provider.js";

describe("external memory provider hooks", () => {
  it("keeps recall disabled until config explicitly enables it", async () => {
    let called = false;
    const provider: ExternalMemoryProvider = {
      id: "fake",
      prefetch: () => {
        called = true;
        return [];
      }
    };

    const result = await collectExternalMemoryRecall({
      query: "last time",
      providers: [provider],
      config: {
        enabled: false,
        timeoutMs: 750,
        maxResults: 3,
        maxChars: 200,
        mirrorWrites: false
      },
      context: { profileId: "default" }
    });

    expect(called).toBe(false);
    expect(result).toEqual({ blocks: [], sourceProviders: [], warnings: [] });
  });

  it("bounds and labels external recall as untrusted", async () => {
    const provider: ExternalMemoryProvider = {
      id: "fake",
      prefetch: () => [
        { id: "one", source: "remote", content: "first remote fact ".repeat(30) },
        { id: "two", source: "remote", content: "second remote fact" }
      ]
    };

    const result = await collectExternalMemoryRecall({
      query: "last time",
      providers: [provider],
      config: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 1,
        maxChars: 60,
        mirrorWrites: false
      },
      context: { profileId: "default" }
    });

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      kind: "external-recall",
      trusted: false,
      scope: "external",
      source: "external:fake:remote"
    });
    expect(result.blocks[0]?.content).toContain(EXTERNAL_RECALL_UNTRUSTED_NOTICE);
    expect(result.blocks[0]?.content).toContain("[truncated]");
  });

  it("redacts credentials from provider status diagnostics", async () => {
    const provider: ExternalMemoryProvider = {
      id: "fake",
      status: () => ({
        id: "fake",
        enabled: true,
        healthy: true,
        diagnostics: {
          apiKey: "sk-secretsecretsecretsecretsecret",
          bearer: "Bearer secretsecretsecretsecretsecret"
        }
      })
    };

    const statuses = await externalMemoryProviderStatuses([provider], 750);

    expect(statuses).toEqual([
      expect.objectContaining({
        diagnostics: {
          apiKey: "[REDACTED]",
          bearer: "[REDACTED]"
        }
      })
    ]);
  });

  it("redacts secret-like text from external recall blocks", async () => {
    const provider: ExternalMemoryProvider = {
      id: "fake",
      prefetch: () => [
        { id: "one", source: "remote", content: "tool output OPENAI_API_KEY=sk-secretsecretsecretsecretsecret" }
      ]
    };

    const result = await collectExternalMemoryRecall({
      query: "last time",
      providers: [provider],
      config: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 1,
        maxChars: 500,
        mirrorWrites: false
      },
      context: { profileId: "default" }
    });

    expect(result.blocks[0]?.content).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(result.blocks[0]?.content).not.toContain("sk-secret");
  });

  it("isolates mirror write failures from local memory callers", async () => {
    const provider: ExternalMemoryProvider = {
      id: "fake",
      mirrorMemoryWrite: () => {
        throw new Error("TOKEN=secretsecretsecretsecretsecret");
      }
    };

    const result = await mirrorMemoryWriteToExternalProviders({
      providers: [provider],
      config: {
        enabled: true,
        timeoutMs: 750,
        maxResults: 3,
        maxChars: 200,
        mirrorWrites: true
      },
      entry: {
        profileId: "default",
        source: "memory.curate",
        operation: {
          kind: "append",
          file: "USER.md",
          content: "- Durable local memory"
        }
      }
    });

    expect(result.warnings).toEqual([
      "external memory provider fake mirror write failed: TOKEN=[REDACTED]"
    ]);
  });
});
