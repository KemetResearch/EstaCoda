import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { MemoryStore } from "../../memory/memory-store.js";
import { MemoryPromotionStore } from "../../memory/memory-promotion-store.js";
import { renderSelective } from "../../memory/selective-renderer.js";
import { assertTrue, assertEqual, buildResult } from "../eval-runner.js";

export const memorySelectiveRendersCase: EvalCase = {
  id: "memory-selective-renders",
  name: "Selective renderer returns relevant entries and respects fallback rules",
  description:
    "With query, returns matching entries only. With no-match query, returns N most recent fallback entries. Never full dump when query is provided.",
  tags: ["memory", "rendering", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const memoryStore = new MemoryStore();
    const promotionStore = new MemoryPromotionStore({
      path: "/tmp/estacoda-eval-promotions-selective.json"
    });

    // Seed 10 entries
    const entries = [
      "Prefer concise replies.",
      "Use TypeScript by default.",
      "Default to dark mode.",
      "Always use bun.",
      "Run checks with eslint.",
      "Project uses React.",
      "Tests are stored under tests/.",
      "Prefer async/await.",
      "Use strict TypeScript.",
      "Deploy to staging first."
    ];

    for (let index = 0; index < entries.length; index++) {
      const content = entries[index];
      await promotionStore.applyUserPreference({
        id: `pref-selective-${index}`,
        content,
        confidence: 0.8,
        occurrences: 2,
        source: "eval-test",
        sourceSessionIds: ["session-a"]
      });
      memoryStore.apply({
        kind: "append",
        file: "USER.md",
        content: `- ${content}`
      });
    }

    const records = await promotionStore.list();

    // Query that matches exactly one entry
    const matchedRender = renderSelective(memoryStore.snapshot(), records, { query: "TypeScript" });
    const matchedLines = matchedRender.text.split("\n").filter((line) => line.trim().startsWith("- "));

    // Query that matches nothing
    const noMatchRender = renderSelective(memoryStore.snapshot(), records, { query: "zzzzzzzzz" });
    const noMatchLines = noMatchRender.text.split("\n").filter((line) => line.trim().startsWith("- "));

    // No query = full render
    const fullRender = renderSelective(memoryStore.snapshot(), records, {});
    const fullLines = fullRender.text.split("\n").filter((line) => line.trim().startsWith("- "));

    const assertions = [
      assertEqual("matched query returns only relevant entries", matchedLines.length, 2), // "Use TypeScript by default." and "Use strict TypeScript."
      assertTrue("matched render mode is selective", matchedRender.renderMode === "selective"),
      assertEqual("no-match fallback returns 3 entries", noMatchLines.length, 3),
      assertTrue("no-match fallback is most recent", noMatchLines.some((line) => line.includes("Deploy to staging first."))),
      assertEqual("full render returns all entries", fullLines.length, 10),
      assertTrue("full render mode is full", fullRender.renderMode === "full"),
      assertTrue("no query never dumps everything on no-match", noMatchLines.length < 10)
    ];

    return buildResult(
      "memory-selective-renders",
      "Selective renderer returns relevant entries and respects fallback rules",
      assertions,
      Date.now() - startedAt
    );
  }
};
