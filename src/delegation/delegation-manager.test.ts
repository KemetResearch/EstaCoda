import { describe, expect, it, vi } from "vitest";
import type { AgentLoopResponse } from "../runtime/agent-loop.js";
import type { ChildAgentLoopFactory } from "../runtime/agent-loop-factory.js";
import { InMemorySessionDB } from "../session/in-memory-session-db.js";
import { TrajectoryRecorder } from "../trajectory/trajectory-recorder.js";
import { DelegationManager, delegatedPrompt } from "./delegation-manager.js";

describe("DelegationManager", () => {
  it("creates a child session through the factory and sends task text once", async () => {
    const harness = await createHarness();

    const result = await harness.manager.delegate({
      parentSessionId: "parent",
      profileId: "default",
      task: "Summarize this file",
      allowedToolsets: ["research"],
      allowedTools: ["file.read"],
      trustedWorkspace: true
    });

    expect(harness.factory.createChild).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: "parent",
      task: "Summarize this file",
      role: "leaf",
      depth: 1,
      parentVisibleTools: expect.arrayContaining([
        expect.objectContaining({ name: "file.read" })
      ])
    }));
    expect(harness.handleInputs).toHaveLength(1);
    expect(harness.handleInputs[0]?.text).toBe("Summarize this file");
    expect(result).toMatchObject({
      childSessionId: "child",
      status: "completed",
      summary: "child answer"
    });
    expect(result.effectiveAllowedTools).toEqual(["file.read"]);
  });

  it("wraps optional context deterministically without pre-appending duplicate child messages", async () => {
    const harness = await createHarness();

    await harness.manager.delegate({
      parentSessionId: "parent",
      profileId: "default",
      task: "Explain this",
      context: "Only use this context.",
      trustedWorkspace: true
    });

    expect(harness.handleInputs[0]?.text).toBe([
      "Delegated task: Explain this",
      "",
      "Context: Only use this context."
    ].join("\n"));
    await expect(harness.db.listMessages("child")).resolves.toEqual([]);
  });

  it("does not derive status by parsing child prose", async () => {
    const harness = await createHarness({
      response: response({ text: "This says blocked, failed, and denied, but it completed." })
    });

    const result = await harness.manager.delegate({
      parentSessionId: "parent",
      profileId: "default",
      task: "Use prose words",
      trustedWorkspace: true
    });

    expect(result.status).toBe("completed");
  });

  it("returns blocked from structured child denial even with cheerful prose", async () => {
    const harness = await createHarness({
      beforeResponse: async (db) => {
        await db.appendEvent("child", {
          kind: "security-assessed",
          tool: "terminal.run",
          riskClass: "credential-access",
          assessment: {
            decision: "deny",
            mode: "strict",
            reason: "Child runtime is non-interactive.",
            risk: "high"
          }
        });
      },
      response: response({ text: "All good over here." })
    });

    const result = await harness.manager.delegate({
      parentSessionId: "parent",
      profileId: "default",
      task: "Needs a denied tool",
      trustedWorkspace: true
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("blocked");
  });

  it("returns usage metadata from child provider execution", async () => {
    const harness = await createHarness({
      response: response({
        providerExecution: {
          ok: true,
          fallbackUsed: false,
          attempts: [],
          toolCalls: [],
          response: {
            ok: true,
            provider: "local",
            model: "test",
            content: "child answer",
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
              reasoningTokens: 4
            }
          }
        }
      })
    });

    const result = await harness.manager.delegate({
      parentSessionId: "parent",
      profileId: "default",
      task: "Report usage",
      trustedWorkspace: true
    });

    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 4
    });
  });

  it("does not start a child when the parent signal is already aborted", async () => {
    const harness = await createHarness();
    const controller = new AbortController();
    controller.abort();

    const result = await harness.manager.delegate({
      parentSessionId: "parent",
      profileId: "default",
      task: "Cancelled",
      trustedWorkspace: true,
      signal: controller.signal
    });

    expect(harness.factory.createChild).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      childSessionId: "unavailable",
      status: "failed",
      reason: "cancelled"
    });
  });

  it("rejects delegation before child construction when spawn depth is exceeded", async () => {
    const harness = await createHarness({ currentDepth: 1, maxSpawnDepth: 1 });

    const result = await harness.manager.delegate({
      parentSessionId: "parent",
      profileId: "default",
      task: "Too deep",
      role: "orchestrator",
      trustedWorkspace: true
    });

    expect(harness.factory.createChild).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      childSessionId: "unavailable",
      status: "failed",
      reason: "spawn-depth-exceeded",
      role: "orchestrator",
      depth: 2
    });
  });

  it("propagates parent abort signal into the child handle call", async () => {
    const controller = new AbortController();
    const harness = await createHarness({
      beforeResponse: async () => {
        controller.abort();
      }
    });

    const result = await harness.manager.delegate({
      parentSessionId: "parent",
      profileId: "default",
      task: "Cancel during run",
      trustedWorkspace: true,
      signal: controller.signal
    });

    expect(harness.handleInputs[0]?.signal).toBe(controller.signal);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("cancelled");
  });
});

describe("delegatedPrompt", () => {
  it("keeps the legacy single-task prompt shape when context is absent", () => {
    expect(delegatedPrompt("Do one thing", undefined)).toBe("Do one thing");
  });
});

async function createHarness(input: {
  response?: AgentLoopResponse;
  beforeResponse?: (db: InMemorySessionDB) => Promise<void>;
  currentDepth?: number;
  maxSpawnDepth?: number;
} = {}) {
  const db = new InMemorySessionDB({ id: deterministicId() });
  await db.createSession({ id: "parent", profileId: "default" });
  const handleInputs: Array<{ text: string; signal?: AbortSignal }> = [];
  const factory: ChildAgentLoopFactory = {
    createChild: vi.fn(async () => {
      await db.createSession({
        id: "child",
        profileId: "default",
        parentSessionId: "parent",
        metadata: { kind: "delegated-child" }
      });
      return {
        childSessionId: "child",
        childSession: (await db.getSession("child"))!,
        sessionRuntimeContext: { currentSessionId: () => "child" } as never,
        builtSession: {} as never,
        agentLoop: {} as never,
        suppressedRuntimeFeatures: [],
        enabledRuntimeFeatures: [],
        approvalMode: "non-interactive-fail-closed" as const,
        toolAccess: {
          effectiveAllowedToolsets: ["files"],
          effectiveAllowedTools: ["file.read"],
          strippedTools: [],
          blockedTools: [],
          rejectedRequestedTools: [],
          rejectedRequestedToolsets: []
        },
        handle: vi.fn(async (handleInput) => {
          handleInputs.push({ text: handleInput.text, signal: handleInput.signal });
          await input.beforeResponse?.(db);
          return input.response ?? response();
        }),
        cleanup: vi.fn(async () => undefined)
      };
    })
  };
  return {
    db,
    handleInputs,
    factory,
    manager: new DelegationManager({
      sessionDb: db,
      childFactory: factory,
      trajectoryRecorder: new TrajectoryRecorder({ profileId: "default", sessionId: "parent", modelId: "test" }),
      currentDepth: input.currentDepth,
      delegationConfig: input.maxSpawnDepth === undefined ? undefined : {
        maxSpawnDepth: input.maxSpawnDepth,
        maxConcurrentChildren: 3,
        maxDelegateCallsPerTurn: 3,
        maxBatchTasks: 10,
        childTimeoutSeconds: 600,
        heartbeatSeconds: 30,
        heartbeatStaleCyclesIdle: 3,
        heartbeatStaleCyclesInTool: 6,
        recoverJsonStringTasks: true,
        diagnostics: { enabled: true, includePromptPreview: false },
        defaultAllowedRiskClasses: ["read-only-local", "read-only-network"],
        defaultExcludedToolsets: ["browser", "media", "mcp"],
        defaultAllowedToolsets: [],
        blockedToolNames: ["delegate_task"],
        blockedToolPrefixes: [],
        childRuntime: {
          memoryRecall: "disabled",
          skillLearning: "disabled",
          sessionCompression: "disabled",
          projectContext: "bounded"
        }
      },
      parentVisibleTools: () => [{
        name: "file.read",
        description: "read",
        inputSchema: { type: "object" },
        riskClass: "read-only-local",
        toolsets: ["files"],
        progressLabel: "read",
        maxResultSizeChars: 1000
      }]
    })
  };
}

function response(overrides: Partial<AgentLoopResponse> = {}): AgentLoopResponse {
  return {
    label: "EstaCoda",
    text: "child answer",
    matchedSkills: [],
    intent: {
      nativeIntent: "general",
      labels: ["general"],
      confidence: 1,
      suggestedToolsets: [],
      suggestedSkills: [],
      confirmationRequired: false,
      rationale: "test",
      evidence: []
    },
    securityDecision: "allow",
    toolExecutions: [],
    toolPlans: [],
    skillOutcomes: [],
    artifacts: [],
    context: undefined,
    projectContext: undefined,
    progress: [],
    ...overrides
  };
}

function deterministicId() {
  let id = 0;
  return () => `id-${++id}`;
}
