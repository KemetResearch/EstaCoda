import { describe, expect, it } from "vitest";
import type { Runtime } from "../runtime/create-runtime.js";
import { runOneShotPrompt } from "./one-shot.js";

describe("one-shot prompt", () => {
  it("uses shared tool display labels for provider calls and final tool summaries", async () => {
    const runtime = {
      tools: () => [],
      handle: async (input: {
        onEvent?: (event: { kind: "provider-tool-call"; provider: string; model: string; name: string }) => void;
      }) => {
        input.onEvent?.({
          kind: "provider-tool-call",
          provider: "test",
          model: "test-model",
          name: "terminal.run",
        });
        return {
          label: "assistant",
          text: "done",
          toolExecutions: [
            {
              tool: { name: "terminal.run" },
              decision: "allow",
              riskClass: "destructive-local",
            },
          ],
          progress: [],
        };
      },
    } as unknown as Runtime;

    const result = await runOneShotPrompt({ runtime, argv: ["hello"] });

    expect(result.output).toContain("provider requested Run Command");
    expect(result.output).toContain("tools: Run Command");
    expect(result.output).not.toContain("provider requested terminal.run");
    expect(result.output).not.toContain("tools: terminal.run");
  });
});
