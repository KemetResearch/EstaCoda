import { describe, expect, it, vi } from "vitest";
import type { MemoryPromotionRecord } from "../contracts/memory.js";
import type { SessionRecallResult } from "../session/session-recall-service.js";
import { SESSION_RECALL_UNTRUSTED_NOTICE } from "../session/session-recall-service.js";
import { MemoryPromptContextBuilder } from "./memory-prompt-context-builder.js";
import { MemoryRecallOrchestrator } from "./memory-recall-orchestrator.js";
import { MemoryStore } from "./memory-store.js";

describe("MemoryRecallOrchestrator", () => {
  it("makes deterministic local-memory and omitted-recall decisions for the same inputs", async () => {
    const first = await orchestratorFixture().orchestrator.prepareForTurn({
      text: "Please implement the parser change."
    });
    const second = await orchestratorFixture().orchestrator.prepareForTurn({
      text: "Please implement the parser change."
    });

    expect(first).toEqual(second);
    expect(first.context.diagnostics.recallDecisions).toEqual([
      expect.objectContaining({
        included: false,
        reason: "no explicit recall trigger",
        scopesConsidered: ["user-global", "project", "session"],
        sourceSessions: []
      })
    ]);
  });

  it("always includes safety memory and keeps learned memory exact-once", async () => {
    const store = new MemoryStore();
    store.write("SOUL.md", "identity guardrails");
    store.write("USER.md", "- Prefers concise replies.\n- Prefers concise replies.");
    store.write("MEMORY.md", "- Project uses pnpm.");

    const result = await orchestratorFixture({ store }).orchestrator.prepareForTurn({
      text: "Build the feature."
    });

    expect(result.context.safetyMemory.map((block) => block.source)).toEqual(["SOUL.md"]);
    expect(result.context.frozenCompactMemory.map((block) => block.source)).toEqual(["USER.md", "MEMORY.md"]);
    expect(result.context.frozenCompactMemory.find((block) => block.source === "USER.md")?.content).toBe("- Prefers concise replies.");
    expect(result.context.diagnostics.duplicateEntriesRemoved).toBe(1);
  });

  it("suppresses inactive promoted memory and reports pressure diagnostics", async () => {
    const store = new MemoryStore({
      budgets: [
        { kind: "USER.md", maxChars: 16 },
        { kind: "MEMORY.md", maxChars: 100 }
      ]
    });
    store.write("USER.md", "- stale\n- active");
    const promotionStore = {
      list: async () => [
        promotionRecord("pref-1", "user-preference", "stale", false)
      ]
    };

    const result = await orchestratorFixture({ store, promotionStore }).orchestrator.prepareForTurn({
      text: "Continue."
    });

    const user = result.context.frozenCompactMemory.find((block) => block.source === "USER.md");
    expect(user?.content).toBe("- active");
    expect(result.context.diagnostics.suppressedEntries).toBe(1);
    expect(result.context.diagnostics.budgetPressure).toContainEqual(expect.objectContaining({
      kind: "USER.md",
      state: "critical"
    }));
  });

  it("includes bounded untrusted session recall only for explicit recall signals", async () => {
    const recall = vi.fn(async (): Promise<SessionRecallResult> => recallResult("sess-1"));
    const recorder = {
      recordSessionRecallDecision: vi.fn(async () => [])
    };
    const { orchestrator } = orchestratorFixture({
      sessionRecallService: { recall },
      recorder
    });

    const ordinary = await orchestrator.prepareForTurn({ text: "Implement the parser." });
    const recalled = await orchestrator.prepareForTurn({ text: "What did we decide about parser errors?" });

    expect(recall).toHaveBeenCalledTimes(1);
    expect(ordinary.context.sessionRecall).toBeUndefined();
    expect(ordinary.context.diagnostics.recallDecisions?.[0]).toMatchObject({
      included: false,
      reason: "no explicit recall trigger"
    });
    expect(recalled.context.sessionRecall).toHaveLength(1);
    expect(recalled.context.sessionRecall?.[0]?.trusted).toBe(false);
    expect(recalled.context.sessionRecall?.[0]?.content).toContain(SESSION_RECALL_UNTRUSTED_NOTICE);
    expect(recalled.context.diagnostics.recallTriggered).toBe(true);
    expect(recalled.context.diagnostics.recallDecisions?.[0]).toMatchObject({
      included: true,
      reason: "explicit decision recall phrase",
      sourceSessions: ["sess-1"]
    });
    expect(recalled.context.diagnostics.includedBlocks).toContainEqual(expect.objectContaining({
      kind: "session-recall",
      source: "session:sess-1",
      entryIds: ["sess-1"]
    }));
    expect(recorder.recordSessionRecallDecision).toHaveBeenLastCalledWith(expect.objectContaining({
      triggered: true,
      sourceSessionIds: ["sess-1"]
    }));
  });

  it("records deterministic omitted-recall diagnostics when the recall service is unavailable", async () => {
    const recorder = {
      recordSessionRecallDecision: vi.fn(async () => ["session recall decision event failed"])
    };
    const { orchestrator } = orchestratorFixture({ recorder });

    const result = await orchestrator.prepareForTurn({
      text: "Continue from the rollout notes."
    });

    expect(result.context.sessionRecall).toBeUndefined();
    expect(result.context.diagnostics.warnings).toContain("session recall decision event failed");
    expect(result.context.diagnostics.recallDecisions).toEqual([
      expect.objectContaining({
        included: false,
        reason: "session recall service unavailable",
        warnings: ["session recall decision event failed"]
      })
    ]);
  });
});

function orchestratorFixture(input: {
  store?: MemoryStore;
  promotionStore?: { list(): Promise<MemoryPromotionRecord[]> };
  sessionRecallService?: { recall(query: string): Promise<SessionRecallResult> };
  recorder?: {
    recordSessionRecallDecision(input: {
      triggered: boolean;
      reason: string;
      query?: string;
      sourceSessionIds: string[];
      warningCount: number;
    }): Promise<string[]>;
  };
} = {}) {
  const store = input.store ?? new MemoryStore();
  if (input.store === undefined) {
    store.write("USER.md", "- Prefers concise replies.");
    store.write("MEMORY.md", "- Project uses pnpm.");
    store.write("SOUL.md", "identity guardrails");
  }
  return {
    orchestrator: new MemoryRecallOrchestrator({
      builder: new MemoryPromptContextBuilder({
        store,
        promotionStore: input.promotionStore
      }),
      sessionRecallService: input.sessionRecallService,
      recorder: input.recorder
    })
  };
}

function recallResult(sessionId: string): SessionRecallResult {
  return {
    query: "What did we decide about parser errors?",
    blocks: [
      {
        sessionId,
        sourceSessionIds: [sessionId],
        summary: "Source session sess-1: Keep parser errors structured.",
        hitMessageIds: ["msg-1"],
        usedFallback: false,
        untrustedNotice: SESSION_RECALL_UNTRUSTED_NOTICE
      }
    ],
    diagnostics: {
      rawHitCount: 1,
      groupedSessionCount: 1,
      returnedSessionCount: 1,
      fallbackCount: 0,
      warnings: []
    }
  };
}

function promotionRecord(
  id: string,
  kind: MemoryPromotionRecord["kind"],
  content: string,
  active: boolean
): MemoryPromotionRecord {
  return {
    id,
    kind,
    content,
    active,
    confidence: 0.9,
    occurrences: 1,
    source: "test",
    sourceSessionIds: [],
    updatedAt: "2026-05-19T00:00:00.000Z"
  };
}
