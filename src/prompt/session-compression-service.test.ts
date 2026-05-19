import { describe, expect, it, vi } from "vitest";
import { normalizeSessionCompressionConfig } from "../config/runtime-config.js";
import type { ProviderResponse, ResolvedAuxiliaryRoute, ResolvedModelRoute } from "../contracts/provider.js";
import type { ReplacementSessionMessage, SessionDB, SessionEvent, SessionMessage } from "../contracts/session.js";
import { InMemorySessionDB } from "../session/in-memory-session-db.js";
import { SessionCompressionLock } from "../session/session-compression-lock.js";
import { SUMMARY_FORMAT_VERSION, SUMMARY_PREFIX } from "./semantic-compressor.js";
import { SessionCompressionService } from "./session-compression-service.js";
import { estimateMessageTokensRough } from "./token-estimator.js";

describe("SessionCompressionService", () => {
  it("compactIfNeeded no-ops below threshold", async () => {
    const { db, sessionId } = await sessionDbWithMessages(8);
    const service = new SessionCompressionService({
      sessionDb: db,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 100_000,
        threshold: 0.95
      })
    });

    const result = await service.compactIfNeeded({ profileId: "profile", sessionId });

    expect(result.didCompress).toBe(false);
    expect(result.diagnostics.reason).toBe("below-threshold");
    expect(await db.listMessages(sessionId)).toHaveLength(8);
  });

  it("compactIfNeeded compresses above threshold and writes state events", async () => {
    const { db, sessionId } = await sessionDbWithMessages(8);
    const service = new SessionCompressionService({
      sessionDb: db,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 1,
        protectLastN: 2,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...auxiliaryHarness("Key Decisions\n- ship it"),
      now: () => new Date("2030-01-02T00:00:00.000Z"),
      id: () => "summary-id"
    });

    const result = await service.compactIfNeeded({ profileId: "profile", sessionId });
    const events = await db.listEvents(sessionId);

    expect(result.didCompress).toBe(true);
    expect(result.userFacingMessage).toContain("Session history compacted");
    const summaryMessage = result.messages.find((message) => message.metadata?.semanticCompression === true);
    expect(summaryMessage).toBeDefined();
    const expectedSummaryTokens = estimateMessageTokensRough({
      role: summaryMessage!.role,
      content: summaryMessage!.content,
      metadata: summaryMessage!.metadata
    });
    const compressedEvent = events.find((event) => event.kind === "session-history-compressed");
    expect(compressedEvent).toEqual(expect.objectContaining({
      kind: "session-history-compressed",
      summaryFormatVersion: SUMMARY_FORMAT_VERSION,
      fallbackUsed: false,
      model: "compression-model",
      protectedFirstN: 1,
      protectedLastN: 2,
      summaryEstimatedTokens: expectedSummaryTokens,
      estimatedSavingsTokens: expect.any(Number),
      source: expect.objectContaining({
        messageCount: expect.any(Number),
        estimatedTokens: expect.any(Number)
      }),
      protectedSpans: expect.any(Array)
    }));
    expect(events).toContainEqual(expect.objectContaining({
      kind: "session-compression-state",
      state: expect.objectContaining({
        status: "compressed",
        lastCompressedAt: "2030-01-02T00:00:00.000Z",
        summaryFormatVersion: SUMMARY_FORMAT_VERSION,
        summaryEstimatedTokens: expectedSummaryTokens,
        fallbackUsed: false
      })
    }));
    expect(expectedSummaryTokens).toBeLessThan(result.diagnostics.postTokens);
  });

  it("compactNow bypasses threshold", async () => {
    const { db, sessionId } = await sessionDbWithMessages(4);
    let observedPrompt = "";
    const harness = auxiliaryHarness("forced summary");
    harness.providerExecutor.complete = vi.fn(async (request?: unknown): Promise<any> => {
      observedPrompt = String((request as { messages?: Array<{ content?: unknown }> }).messages?.[1]?.content ?? "");
      return providerResult("forced summary");
    });
    const service = new SessionCompressionService({
      sessionDb: db,
      config: normalizeSessionCompressionConfig({
        enabled: false,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 100_000,
        threshold: 0.95
      }),
      ...harness
    });

    const result = await service.compactNow({ profileId: "profile", sessionId, focusTopic: "manual focus" });
    const events = await db.listEvents(sessionId);

    expect(result.didCompress).toBe(true);
    expect(result.diagnostics.reason).toBe("forced");
    expect(observedPrompt).toContain("Manual focus topic: manual focus");
    expect(events).toContainEqual(expect.objectContaining({
      kind: "session-history-compressed",
      trigger: "manual"
    }));
  });

  it("hydrates latest state event before compression", async () => {
    const { db, sessionId } = await sessionDbWithMessages(8);
    await db.appendEvent(sessionId, {
      kind: "session-compression-state",
      state: {
        status: "compressed",
        protectedFirstN: 0,
        protectedLastN: 0,
        protectedSpans: [],
        estimatedSavingsTokens: 0,
        fallbackUsed: false,
        warnings: []
      }
    });
    const service = new SessionCompressionService({
      sessionDb: db,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        summaryModelContextLength: 50,
        threshold: 0.10
      })
    });

    const result = await service.compactIfNeeded({ profileId: "profile", sessionId });

    expect(result.didCompress).toBe(false);
    expect(result.diagnostics.reason).toBe("anti-thrashing");
  });

  it("event write failure is non-fatal after message replacement", async () => {
    const base = await sessionDbWithMessages(8);
    const throwingDb = forwardingSessionDb(base.db, {
      appendEvent: async () => {
        throw new Error("event sink down");
      }
    });
    const service = new SessionCompressionService({
      sessionDb: throwingDb,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...auxiliaryHarness("summary")
    });

    const result = await service.compactIfNeeded({ profileId: "profile", sessionId: base.sessionId });

    expect(result.didCompress).toBe(true);
    expect(result.diagnostics.eventWarnings).toEqual([
      "session compression event write failed: event sink down",
      "session compression event write failed: event sink down"
    ]);
    expect((await base.db.listMessages(base.sessionId)).some((message) => message.metadata?.semanticCompression === true)).toBe(true);
  });

  it("releases the lock when message replacement fails", async () => {
    const base = await sessionDbWithMessages(8);
    let failReplace = true;
    const lock = new SessionCompressionLock();
    const replacingDb = forwardingSessionDb(base.db, {
      replaceMessages: async (input) => {
        if (failReplace) {
          failReplace = false;
          throw new Error("replace down");
        }
        return base.db.replaceMessages(input);
      }
    });
    const service = new SessionCompressionService({
      sessionDb: replacingDb,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...auxiliaryHarness("summary"),
      lock
    });

    await expect(service.compactIfNeeded({ profileId: "profile", sessionId: base.sessionId })).rejects.toThrow("replace down");
    await expect(service.compactIfNeeded({ profileId: "profile", sessionId: base.sessionId })).resolves.toMatchObject({
      didCompress: true
    });
  });

  it("returns an immutable shape", async () => {
    const { db, sessionId } = await sessionDbWithMessages(8);
    const service = new SessionCompressionService({
      sessionDb: db,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...auxiliaryHarness("summary")
    });

    const result = await service.compactIfNeeded({ profileId: "profile", sessionId });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.messages)).toBe(true);
    expect(Object.isFrozen(result.messages[0])).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.diagnostics.protectedSpans[0])).toBe(true);
  });

  it("uses the lock, releases on failure, and does not block unrelated sessions", async () => {
    const { db, sessionId } = await sessionDbWithMessages(8, "session-a");
    await appendMessages(db, "session-b", 8);
    const lock = new SessionCompressionLock();
    let releaseProvider!: () => void;
    const providerExecutor = {
      complete: vi.fn(async (): Promise<any> => {
        if (providerExecutor.complete.mock.calls.length === 1) {
          await new Promise<void>((resolve) => {
            releaseProvider = resolve;
          });
        }
        return providerResult("summary");
      })
    };
    const service = new SessionCompressionService({
      sessionDb: db,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      route: auxiliaryRoute(),
      mainRoute: mainRoute(),
      providerExecutor,
      lock
    });

    const first = service.compactIfNeeded({ profileId: "profile", sessionId });
    await waitFor(() => providerExecutor.complete.mock.calls.length === 1);
    const unrelated = await service.compactIfNeeded({ profileId: "profile", sessionId: "session-b" });
    expect(unrelated.didCompress).toBe(true);
    releaseProvider();
    await first;

    const failing = new SessionCompressionService({
      sessionDb: db,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      route: auxiliaryRoute(),
      mainRoute: mainRoute(),
      providerExecutor: {
        complete: vi.fn(async (): Promise<any> => {
          throw new Error("provider boom");
        })
      },
      lock
    });
    await expect(failing.compactNow({ profileId: "profile", sessionId })).resolves.toMatchObject({
      didCompress: true,
      diagnostics: expect.objectContaining({ fallbackUsed: true })
    });
    await expect(service.compactNow({ profileId: "profile", sessionId })).resolves.toMatchObject({ didCompress: true });
  });

  it("returns Hermes-style user-facing message without wiring CLI commands", async () => {
    const { db, sessionId } = await sessionDbWithMessages(8);
    const service = new SessionCompressionService({
      sessionDb: db,
      config: normalizeSessionCompressionConfig({
        enabled: true,
        experimental: true,
        protectFirstN: 0,
        protectLastN: 1,
        summaryModelContextLength: 50,
        threshold: 0.10
      }),
      ...auxiliaryHarness("summary")
    });

    const result = await service.compactIfNeeded({ profileId: "profile", sessionId });

    expect(result.userFacingMessage).toContain("Session history compacted");
    expect(result.messages.find((message) => message.metadata?.semanticCompression === true)?.content).toContain(SUMMARY_PREFIX);
  });
});

async function sessionDbWithMessages(count: number, sessionId = "session-a") {
  const db = new InMemorySessionDB({ now: () => new Date("2030-01-01T00:00:00.000Z") });
  await db.createSession({ id: sessionId, profileId: "profile" });
  await appendMessages(db, sessionId, count);
  return { db, sessionId };
}

async function appendMessages(db: InMemorySessionDB, sessionId: string, count: number): Promise<void> {
  if ((await db.getSession(sessionId)) === undefined) {
    await db.createSession({ id: sessionId, profileId: "profile" });
  }
  for (let index = 0; index < count; index += 1) {
    await db.appendMessage({
      id: `${sessionId}-m${index}`,
      sessionId,
      role: index % 2 === 0 ? "user" : "agent",
      content: `message ${index} ${"x".repeat(120)}`
    });
  }
}

function forwardingSessionDb(db: InMemorySessionDB, overrides: Partial<SessionDB>): SessionDB {
  return {
    createSession: overrides.createSession ?? db.createSession.bind(db),
    getSession: overrides.getSession ?? db.getSession.bind(db),
    listSessions: overrides.listSessions ?? db.listSessions.bind(db),
    appendMessage: overrides.appendMessage ?? db.appendMessage.bind(db),
    replaceMessages: overrides.replaceMessages ?? db.replaceMessages.bind(db),
    appendEvent: overrides.appendEvent ?? db.appendEvent.bind(db),
    listMessages: overrides.listMessages ?? db.listMessages.bind(db),
    listEvents: overrides.listEvents ?? db.listEvents.bind(db),
    search: overrides.search ?? db.search.bind(db),
    saveFailure: overrides.saveFailure ?? db.saveFailure.bind(db)
  };
}

function auxiliaryHarness(content: string, ok = true) {
  return {
    route: auxiliaryRoute(),
    mainRoute: mainRoute(),
    providerExecutor: {
      complete: vi.fn(async (): Promise<any> => providerResult(content, ok))
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
