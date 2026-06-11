import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../contracts/runtime-event.js";
import { createDelegationProgressRelay } from "./progress-relay.js";

describe("createDelegationProgressRelay", () => {
  it("forwards selected child events with subagent identity", async () => {
    const events: RuntimeEvent[] = [];
    const relay = createDelegationProgressRelay({
      metadata: metadata(),
      parentOnEvent: (event) => {
        events.push(event);
      }
    });

    await relay({ kind: "tool-start", tool: "file.read", targetSummary: "secret path" });
    await relay({ kind: "provider-result", provider: "local", model: "test", ok: true, fallback: false, willFallback: false });

    expect(events).toEqual([
      {
        kind: "delegation-progress",
        ...metadata(),
        childEvent: {
          kind: "tool-start",
          tool: "file.read"
        }
      },
      {
        kind: "delegation-progress",
        ...metadata(),
        childEvent: {
          kind: "provider-result",
          provider: "local",
          model: "test",
          ok: true,
          fallback: false,
          willFallback: false,
          errorClass: undefined,
          finishReason: undefined,
          incompleteReason: undefined
        }
      }
    ]);
  });

  it("does not relay raw prompts, provider tokens, or provider tool-call arguments", async () => {
    const events: RuntimeEvent[] = [];
    const relay = createDelegationProgressRelay({
      metadata: metadata(),
      parentOnEvent: (event) => {
        events.push(event);
      }
    });

    await relay({ kind: "agent-start", sessionId: "child", input: "full prompt api_key=secret" });
    await relay({ kind: "provider-token", provider: "local", model: "test", text: "raw-token" });
    await relay({ kind: "provider-tool-call", provider: "local", model: "test", argumentsText: "{\"token\":\"secret\"}" });

    expect(JSON.stringify(events)).not.toContain("api_key=secret");
    expect(JSON.stringify(events)).not.toContain("raw-token");
    expect(JSON.stringify(events)).not.toContain("argumentsText");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "delegation-progress",
      childEvent: {
        kind: "agent-start",
        sessionId: "child"
      }
    });
  });

  it("throttles repeated noisy events", async () => {
    let now = 1_000;
    const events: RuntimeEvent[] = [];
    const relay = createDelegationProgressRelay({
      metadata: metadata(),
      throttleMs: 500,
      now: () => now,
      parentOnEvent: (event) => {
        events.push(event);
      }
    });

    await relay({ kind: "tool-start", tool: "file.read" });
    now += 100;
    await relay({ kind: "tool-start", tool: "file.read" });
    now += 500;
    await relay({ kind: "tool-start", tool: "file.read" });

    expect(events).toHaveLength(2);
  });
});

function metadata() {
  return {
    subagentId: "child",
    childSessionId: "child",
    parentSessionId: "parent",
    role: "leaf" as const,
    depth: 1,
    taskIndex: 2,
    batchId: "batch"
  };
}
