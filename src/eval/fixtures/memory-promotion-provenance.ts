import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { MemoryPromotionStore } from "../../memory/memory-promotion-store.js";
import { assertTrue, assertEqual, buildResult } from "../eval-runner.js";

export const memoryPromotionProvenanceCase: EvalCase = {
  id: "memory-promotion-provenance",
  name: "Memory promotion carries provenance metadata",
  description: "When a memory is promoted, it must include sourceTrajectoryId, sourceEventId, and createdAt.",
  tags: ["memory", "provenance", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const store = new MemoryPromotionStore({
      path: "/tmp/estacoda-eval-promotions-provenance.json",
      now: () => new Date("2026-05-03T12:00:00Z")
    });

    const applied = await store.applyUserPreference({
      id: "pref-001",
      content: "Prefer concise replies.",
      confidence: 0.85,
      occurrences: 3,
      source: "eval-test",
      sourceSessionIds: ["session-a", "session-b"],
      sourceTrajectoryId: "traj-001",
      sourceEventId: "event-001"
    });

    const record = applied.record;

    const assertions = [
      assertEqual("record id", record.id, "pref-001"),
      assertTrue("has sourceTrajectoryId", record.sourceTrajectoryId === "traj-001"),
      assertTrue("has sourceEventId", record.sourceEventId === "event-001"),
      assertTrue("has createdAt", record.createdAt !== undefined && record.createdAt.length > 0),
      assertEqual("createdAt value", record.createdAt, "2026-05-03T12:00:00.000Z")
    ];

    return buildResult(
      "memory-promotion-provenance",
      "Memory promotion carries provenance metadata",
      assertions,
      Date.now() - startedAt
    );
  }
};
