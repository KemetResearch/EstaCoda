import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { MemoryStore } from "../../memory/memory-store.js";
import { MemoryPromotionStore } from "../../memory/memory-promotion-store.js";
import { MemoryInspector } from "../../memory/memory-inspector.js";
import { renderSelective } from "../../memory/selective-renderer.js";
import { assertTrue, assertEqual, assertContains, buildResult } from "../eval-runner.js";

export const memoryDeactivateSuppressesCase: EvalCase = {
  id: "memory-deactivate-suppresses",
  name: "Deactivated memory is suppressed from rendered context",
  description: "After deactivating a memory promotion, it must not appear in selective-rendered context.",
  tags: ["memory", "deactivation", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const memoryStore = new MemoryStore();
    const promotionStore = new MemoryPromotionStore({
      path: "/tmp/estacoda-eval-promotions-deactivate.json"
    });

    // Seed a promotion and its markdown line
    await promotionStore.applyUserPreference({
      id: "pref-deactivate-001",
      content: "Use TypeScript by default.",
      confidence: 0.9,
      occurrences: 3,
      source: "eval-test",
      sourceSessionIds: ["session-a"]
    });
    memoryStore.apply({
      kind: "append",
      file: "USER.md",
      content: "- Use TypeScript by default."
    });

    const inspector = new MemoryInspector({ promotionStore, memoryStore });

    // Before deactivation: should be in context
    const beforeRecords = await promotionStore.list();
    const beforeRender = renderSelective(memoryStore.snapshot(), beforeRecords, {});
    const beforeContains = beforeRender.text.includes("Use TypeScript by default.");

    // Deactivate
    const deactivateResult = await inspector.deactivate("pref-deactivate-001");

    // After deactivation: should be suppressed
    const afterRecords = await promotionStore.list();
    const afterRender = renderSelective(memoryStore.snapshot(), afterRecords, {});
    const afterContains = afterRender.text.includes("Use TypeScript by default.");

    const assertions = [
      assertTrue("before: entry renders", beforeContains),
      assertTrue("deactivation succeeded", deactivateResult.ok),
      assertTrue("after: entry suppressed", !afterContains)
    ];

    return buildResult(
      "memory-deactivate-suppresses",
      "Deactivated memory is suppressed from rendered context",
      assertions,
      Date.now() - startedAt
    );
  }
};
