import { describe, expect, it, vi } from "vitest";
import { createDelegationTools } from "./delegation-tools.js";

describe("createDelegationTools", () => {
  it("preserves the existing delegate_task schema shape", () => {
    const [tool] = createDelegationTools({
      manager: { delegate: vi.fn() } as never,
      parentSessionId: "parent",
      profileId: "default",
      trustedWorkspace: () => true
    });

    expect(tool?.name).toBe("delegate_task");
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        context: { type: "string" },
        allowedToolsets: {
          type: "array",
          items: { type: "string" }
        },
        allowedTools: {
          type: "array",
          items: { type: "string" }
        },
        role: {
          type: "string",
          enum: ["leaf", "orchestrator"]
        }
      }
    });
  });

  it("passes tool execution AbortSignal and event sink into DelegationManager.delegate", async () => {
    const delegate = vi.fn(async () => ({
      childSessionId: "child",
      status: "completed",
      task: "Do work",
      summary: "done",
      role: "leaf",
      depth: 1,
      allowedToolsets: [],
      allowedTools: [],
      effectiveAllowedToolsets: [],
      effectiveAllowedTools: [],
      strippedTools: [],
      blockedTools: [],
      rejectedRequestedTools: [],
      rejectedRequestedToolsets: [],
      toolExecutions: []
    }));
    const [tool] = createDelegationTools({
      manager: { delegate } as never,
      parentSessionId: () => "parent",
      profileId: "default",
      trustedWorkspace: async () => true
    });
    const controller = new AbortController();
    const onEvent = vi.fn();

    const result = await tool!.run({ task: "Do work" }, { signal: controller.signal, onEvent });

    expect(result.ok).toBe(true);
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: "parent",
      profileId: "default",
      task: "Do work",
      role: "leaf",
      trustedWorkspace: true,
      signal: controller.signal,
      onEvent
    }));
  });

  it("keeps task required for single-task mode", async () => {
    const [tool] = createDelegationTools({
      manager: { delegate: vi.fn() } as never,
      parentSessionId: "parent",
      profileId: "default",
      trustedWorkspace: () => true
    });

    const result = await tool!.run({ task: "   " });

    expect(result).toMatchObject({
      ok: false,
      content: "delegate_task requires a non-empty task."
    });
  });
});
