import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../contracts/tool.js";
import { stableToolCallId, ToolCallPlanner } from "./tool-call-planner.js";
import { ToolRegistry } from "./tool-registry.js";

const testTool: ToolDefinition = {
  name: "test.tool",
  description: "Test tool",
  inputSchema: {},
  riskClass: "read-only-local",
  toolsets: ["test"],
  progressLabel: "testing",
  maxResultSizeChars: 1000
};

describe("stableToolCallId", () => {
  it("generates deterministic IDs from provider tool-call deltas", () => {
    const delta = {
      index: 0,
      name: "test.tool",
      argumentsText: "{\"path\":\"src/index.ts\"}"
    };

    expect(stableToolCallId(delta)).toBe(stableToolCallId(delta));
    expect(stableToolCallId(delta)).toMatch(/^tool-call-[a-f0-9]{16}$/u);
  });

  it("uses the same generated ID as ToolCallPlanner for missing provider IDs", () => {
    const registry = new ToolRegistry();
    registry.register({
      ...testTool,
      isAvailable: () => true,
      run: async () => ({ ok: true, content: "ok" })
    });
    const planner = new ToolCallPlanner({ registry });
    const delta = {
      index: 1,
      name: "test.tool",
      argumentsText: "{\"query\":\"docs\"}"
    };

    expect(planner.planFromProviderDelta(delta).id).toBe(stableToolCallId(delta));
  });
});
