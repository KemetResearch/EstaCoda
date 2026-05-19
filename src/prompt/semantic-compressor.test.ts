import { describe, expect, it, vi } from "vitest";
import { normalizeSessionCompressionConfig } from "../config/runtime-config.js";
import type { ProviderResponse, ResolvedAuxiliaryRoute, ResolvedModelRoute } from "../contracts/provider.js";
import type { SessionMessage } from "../contracts/session.js";
import {
  CONTENT_HEAD,
  CONTENT_MAX,
  CONTENT_TAIL,
  SemanticCompressor,
  SUMMARY_FORMAT_VERSION,
  SUMMARY_PREFIX,
  normalizeSummaryPrefix,
  serializeMessagesForSummary,
  TOOL_ARGS_MAX,
  TOOL_ARGS_HEAD
} from "./semantic-compressor.js";

describe("SemanticCompressor", () => {
  it("bypasses compression when disabled and respects threshold when enabled", async () => {
    const disabled = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({ enabled: true })
    });
    const messages = fixtureMessages(10);

    expect(disabled.shouldCompress({ messages, profileId: "p", sessionId: "s" })).toMatchObject({
      shouldCompress: false,
      reason: "disabled"
    });

    const enabled = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 100,
        threshold: 0.50
      })
    });

    expect(enabled.shouldCompress({ messages: fixtureMessages(1), profileId: "p", sessionId: "s" }).shouldCompress).toBe(false);
    expect(enabled.shouldCompress({ messages, profileId: "p", sessionId: "s" }).shouldCompress).toBe(true);
  });

  it("preserves protected head, tail, active tool pairs, explicit constraints, and latest user message", async () => {
    const compressor = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 2,
        protectLastN: 2,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...auxiliaryHarness("Key Decisions\n- summarized safely")
    });
    const messages = [
      message("head-user", "user", "first head"),
      message("head-agent", "agent", "second head"),
      message("old-1", "user", "old body one"),
      message("constraint", "user", "must keep this explicit constraint", { explicitConstraint: true }),
      message("tool-call", "agent", "calling tool", { tool_call_id: "call-1", tool_call_name: "file.read", activeToolCall: true }),
      message("tool-result", "tool", "tool result", { tool_call_id: "call-1", tool_call_name: "file.read", activeToolResult: true }),
      message("old-2", "agent", "old body two"),
      message("tail-agent", "agent", "recent answer"),
      message("latest-user", "user", "latest user request")
    ];

    const result = await compressor.compress({ messages, profileId: "profile", sessionId: "session" });

    expect(result.didCompress).toBe(true);
    expect(result.messages.map((entry) => entry.id)).toContain("head-user");
    expect(result.messages.map((entry) => entry.id)).toContain("head-agent");
    expect(result.messages.map((entry) => entry.id)).toContain("constraint");
    expect(result.messages.map((entry) => entry.id)).toContain("tool-call");
    expect(result.messages.map((entry) => entry.id)).toContain("tool-result");
    expect(result.messages.at(-1)?.id).toBe("latest-user");
    expect(result.messages.some((entry) => entry.metadata?.semanticCompression === true)).toBe(true);
    expect(result.diagnostics.protectedSpans.length).toBeGreaterThan(0);
    expect(result.diagnostics.protectedCategories).toEqual(expect.arrayContaining([
      "current_user_request",
      "active_tool_call",
      "active_tool_result",
      "explicit_constraint",
      "recent_turn"
    ]));
  });

  it("uses Hermes-style per-message and tool-argument truncation before summarization", () => {
    const longContent = "a".repeat(CONTENT_MAX + 200);
    const longToolArgs = { payload: "b".repeat(TOOL_ARGS_MAX + 200) };
    const serialized = serializeMessagesForSummary([
      message("tool-1", "tool", longContent, {
        provider_native_tool_call: longToolArgs
      })
    ]);

    expect(serialized.text).toContain("a".repeat(CONTENT_HEAD));
    expect(serialized.text).toContain("a".repeat(CONTENT_TAIL));
    expect(serialized.text).toContain(`[truncated ${longContent.length - CONTENT_HEAD - CONTENT_TAIL} chars]`);
    expect(serialized.text).toContain("b".repeat(1_000));
    expect(serialized.text).toContain(`[truncated ${JSON.stringify(longToolArgs).length - TOOL_ARGS_HEAD} chars]`);
    expect(serialized.text).toContain("provider_native_tool_call");
    expect(serialized.prunedToolResults).toBe(1);
  });

  it("summarizes old tool results instead of preserving them as live history", async () => {
    const compressor = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...auxiliaryHarness("old tool work summarized")
    });
    const messages = [
      message("old-tool-call", "agent", "calling tool", { tool_call_id: "call-old", tool_call_name: "shell.run" }),
      message("old-tool-result", "tool", "x".repeat(CONTENT_MAX + 20), { tool_call_id: "call-old", tool_call_name: "shell.run" }),
      ...fixtureMessages(5)
    ];

    const result = await compressor.compress({ messages, profileId: "profile", sessionId: "session" });

    expect(result.didCompress).toBe(true);
    expect(result.messages.map((entry) => entry.id)).not.toContain("old-tool-call");
    expect(result.messages.map((entry) => entry.id)).not.toContain("old-tool-result");
    expect(result.diagnostics.prunedToolResults).toBe(1);
    expect(result.diagnostics.warnings).toEqual(expect.arrayContaining([
      "tool result old-tool-result was truncated before summarization"
    ]));
  });

  it("redacts summarizer input and generated summary output", async () => {
    let observedTranscript = "";
    const outputSecret = "sk-live-secret1234567890abcdef";
    const harness = auxiliaryHarness(`Use token ${outputSecret} in output`);
    harness.providerExecutor.complete = vi.fn(async (request?: unknown): Promise<any> => {
      observedTranscript = String((request as { messages?: Array<{ content?: unknown }> }).messages?.[1]?.content ?? "");
      return providerResult(`Use token ${outputSecret} in output`);
    });
    const compressor = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...harness
    });

    const result = await compressor.compress({
      messages: fixtureMessages(6, "OPENAI_API_KEY=sk-input-secret"),
      profileId: "profile",
      sessionId: "session"
    });

    expect(observedTranscript).not.toContain("sk-input-secret");
    expect(observedTranscript).toContain("[REDACTED]");
    expect(result.messages.find((entry) => entry.metadata?.semanticCompression === true)?.content).not.toContain(outputSecret);
    expect(result.messages.find((entry) => entry.metadata?.semanticCompression === true)?.content).toContain("[REDACTED]");
  });

  it("normalizes summary prefixes without duplicating current or legacy prefixes", () => {
    const current = normalizeSummaryPrefix(`${SUMMARY_PREFIX}\n\nBody`);
    const legacy = normalizeSummaryPrefix("[CONTEXT SUMMARY]\nlegacy body");

    expect(current.match(/\[CONTEXT COMPACTION/g)).toHaveLength(1);
    expect(legacy.match(/\[CONTEXT COMPACTION/g)).toHaveLength(1);
    expect(current).toContain("Body");
    expect(legacy).toContain("legacy body");
  });

  it("includes previous summary for iterative summary updates", async () => {
    let observedPrompt = "";
    const harness = auxiliaryHarness("updated summary");
    harness.providerExecutor.complete = vi.fn(async (request?: unknown): Promise<any> => {
      observedPrompt = String((request as { messages?: Array<{ content?: unknown }> }).messages?.[1]?.content ?? "");
      return providerResult("updated summary");
    });
    const compressor = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...harness
    });
    const messages = [
      message("summary-prev", "system", normalizeSummaryPrefix("previous important summary"), {
        semanticCompression: true,
        summaryFormatVersion: SUMMARY_FORMAT_VERSION
      }),
      ...fixtureMessages(8)
    ];

    await compressor.compress({
      messages,
      profileId: "profile",
      sessionId: "session",
      previousState: {
        status: "compressed",
        protectedFirstN: 0,
        protectedLastN: 0,
        protectedSpans: [],
        summaryMessageId: "summary-prev",
        fallbackUsed: false,
        warnings: []
      }
    });

    expect(observedPrompt).toContain("Previous summary:");
    expect(observedPrompt).toContain("previous important summary");
  });

  it("uses auxiliary summarization success and records fallback/main route diagnostics", async () => {
    const harness = auxiliaryHarness("provider summary");
    const compressor = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...harness
    });

    const result = await compressor.compress({ messages: fixtureMessages(6), profileId: "profile", sessionId: "session" });

    expect(result.diagnostics.fallbackUsed).toBe(false);
    expect(result.diagnostics.model).toBe("compression-model");
    expect(result.diagnostics.scopeKey).toBe("profile:session");
    expect(harness.providerExecutor.complete).toHaveBeenCalled();
  });

  it("falls back deterministically when auxiliary or main fallback summarization fails", async () => {
    const failing = auxiliaryHarness("provider failed", false);
    const compressor = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...failing
    });

    const result = await compressor.compress({ messages: fixtureMessages(6), profileId: "profile", sessionId: "session" });

    expect(result.diagnostics.fallbackUsed).toBe(true);
    expect(result.diagnostics.fallbackReason).toBe("failed");
    expect(result.messages.find((entry) => entry.metadata?.semanticCompression === true)?.content).toContain(SUMMARY_PREFIX);
  });

  it("skips after ineffective recent compression to avoid thrashing", async () => {
    const compressor = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      })
    });

    const result = await compressor.compress({
      messages: fixtureMessages(8),
      profileId: "profile",
      sessionId: "session",
      previousState: {
        status: "compressed",
        protectedFirstN: 0,
        protectedLastN: 0,
        protectedSpans: [],
        estimatedSavingsTokens: 0,
        fallbackUsed: false,
        warnings: []
      }
    });

    expect(result.didCompress).toBe(false);
    expect(result.diagnostics.reason).toBe("anti-thrashing");
    expect(result.diagnostics.warnings).toContain("recent compression was ineffective; skipped to avoid thrashing");
  });

  it("uses image-aware token estimates", () => {
    const compressor = new SemanticCompressor({
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 2_000,
        threshold: 0.50
      })
    });
    const withoutImage = compressor.shouldCompress({
      messages: [
        message("m1", "user", "short"),
        message("m2", "agent", "short"),
        message("m3", "user", "latest")
      ],
      profileId: "profile",
      sessionId: "session"
    });
    const withImage = compressor.shouldCompress({
      messages: [
        message("m1", "user", "short", { imageCount: 1 }),
        message("m2", "agent", "short"),
        message("m3", "user", "latest")
      ],
      profileId: "profile",
      sessionId: "session"
    });

    expect(withImage.preTokens).toBeGreaterThan(withoutImage.preTokens);
    expect(withImage.shouldCompress).toBe(true);
  });
});

function fixtureMessages(count: number, extra = ""): SessionMessage[] {
  return Array.from({ length: count }, (_value, index) =>
    message(`m${index}`, index % 2 === 0 ? "user" : "agent", `message ${index} ${"x".repeat(120)} ${extra}`));
}

function message(
  id: string,
  role: SessionMessage["role"],
  content: string,
  metadata?: Record<string, unknown>
): SessionMessage {
  return {
    id,
    sessionId: "session",
    role,
    content,
    createdAt: `2030-01-01T00:00:${id.replace(/\D/gu, "").padStart(2, "0") || "00"}.000Z`,
    metadata
  };
}

function auxiliaryHarness(content: string, ok = true) {
  return {
    route: auxiliaryRoute(),
    mainRoute: mainRoute(),
    providerExecutor: {
      complete: vi.fn(async (_request?: unknown): Promise<any> => providerResult(content, ok))
    }
  };
}

function providerResult(content: string, ok = true) {
  const response: ProviderResponse = {
    ok,
    content,
    model: "compression-model",
    provider: "test-provider"
  };
  return {
    ok,
    response,
    fallbackUsed: false,
    attempts: [{ provider: "test-provider", model: "compression-model", ok, content }],
    toolCalls: []
  };
}

function auxiliaryRoute(): ResolvedAuxiliaryRoute {
  return {
    task: "compression",
    route: mainRoute("compression-model"),
    source: "explicit",
    fallbackToMain: true,
    diagnostics: []
  };
}

function mainRoute(id = "main-model"): ResolvedModelRoute {
  return {
    provider: "test-provider",
    id,
    profile: {
      id,
      provider: "test-provider",
      contextWindowTokens: 128_000,
      supportsTools: false,
      supportsVision: false,
      supportsStructuredOutput: true
    }
  };
}
