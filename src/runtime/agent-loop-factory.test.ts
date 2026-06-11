import { describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../contracts/session.js";
import { InMemorySessionDB } from "../session/in-memory-session-db.js";
import { TrajectoryRecorder } from "../trajectory/trajectory-recorder.js";
import type { BuiltAgentLoopSession } from "./agent-loop-builder.js";
import {
  CHILD_APPROVAL_MODE,
  CHILD_DELEGATION_CONFIG_VERSION,
  DefaultChildAgentLoopFactory,
  createChildFailClosedSecurityPolicy
} from "./agent-loop-factory.js";

describe("DefaultChildAgentLoopFactory", () => {
  it("creates a child session with delegated metadata and suppressed runtime features", async () => {
    const db = new InMemorySessionDB();
    const built = fakeBuiltSession();
    const builder = fakeBuilder(built);
    const factory = new DefaultChildAgentLoopFactory({
      builder: builder as never,
      sessionDb: db,
      trajectoryRecorderFactory: ({ profileId, sessionId }) => new TrajectoryRecorder({ profileId, sessionId, modelId: "model" }),
      responseLabel: "EstaCoda",
      workspaceRoot: "/workspace",
      id: () => "child-1"
    });

    const child = await factory.createChild({
      parentSessionId: "parent-1",
      profileId: "default",
      task: "Inspect the thing",
      context: "Extra context",
      allowedToolsets: ["research"],
      allowedTools: ["file.search"],
      trustedWorkspace: true
    });

    const session = await db.getSession("child-1");
    expect(child.childSessionId).toBe("child-1");
    expect(session).toMatchObject({
      id: "child-1",
      parentSessionId: "parent-1",
      metadata: {
        kind: "delegated-child",
        parentSessionId: "parent-1",
        role: "leaf",
        depth: 1,
        allowedToolsets: ["research"],
        allowedTools: ["file.search"],
        delegationConfigVersion: CHILD_DELEGATION_CONFIG_VERSION,
        approvalMode: CHILD_APPROVAL_MODE,
        workspaceRoot: "/workspace"
      }
    } satisfies Partial<SessionRecord>);
    expect(session?.metadata?.suppressedRuntimeFeatures).toEqual(expect.arrayContaining([
      "memoryRecall",
      "skillLearning",
      "sessionCompression",
      "workflowAdapter",
      "projectContext"
    ]));
  });

  it("builds a runnable child loop without parent recall, compression, learning, or full project context", async () => {
    const db = new InMemorySessionDB();
    const built = fakeBuiltSession();
    const builder = fakeBuilder(built);
    const factory = new DefaultChildAgentLoopFactory({
      builder: builder as never,
      sessionDb: db,
      trajectoryRecorderFactory: ({ profileId, sessionId }) => new TrajectoryRecorder({ profileId, sessionId, modelId: "model" }),
      responseLabel: "EstaCoda",
      workspaceRoot: "/workspace",
      id: () => "child-1"
    });

    const child = await factory.createChild({
      parentSessionId: "parent-1",
      profileId: "default",
      task: "Run child",
      trustedWorkspace: true
    });
    const response = await child.handle({ text: "hello", channel: "cli" });
    const buildInput = builder.buildSession.mock.calls[0]?.[0] as {
      memoryRecall?: string;
      sessionCompression?: string;
      skillLearningManager?: unknown;
      agentEvolutionPolicy?: unknown;
      projectContext?: unknown;
    } | undefined;

    expect(response.text).toBe("child answer");
    expect(buildInput?.memoryRecall).toBe("disabled");
    expect(buildInput?.sessionCompression).toBe("disabled");
    expect(buildInput?.skillLearningManager).toBeUndefined();
    expect(buildInput?.agentEvolutionPolicy).toBeUndefined();
    expect(buildInput?.projectContext).toEqual({ workspaceRoot: "/workspace", files: [], warnings: [] });
  });

  it("uses a non-interactive fail-closed child approval policy", async () => {
    const policy = createChildFailClosedSecurityPolicy();

    await expect(policy.assess?.({
      riskClass: "credential-access",
      description: "read secret",
      context: { trustedWorkspace: true }
    })).resolves.toMatchObject({
      decision: "deny",
      reason: expect.stringContaining("non-interactive")
    });

    await expect(policy.assess?.({
      riskClass: "read-only-local",
      description: "read file",
      context: { trustedWorkspace: true }
    })).resolves.toMatchObject({
      decision: "allow"
    });
  });
});

function fakeBuilder(built: BuiltAgentLoopSession) {
  return {
    buildSession: vi.fn(async (_input: unknown) => built),
    cleanupSession: vi.fn(async () => undefined)
  };
}

function fakeBuiltSession(): BuiltAgentLoopSession {
  return {
    agentLoop: {
      handle: vi.fn(async () => ({
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
        progress: []
      }))
    },
    sessionRuntimeContext: { currentSessionId: () => "child-1" },
    toolRegistry: {},
    toolExecutor: {},
    toolCallPlanner: {},
    runRecorder: {},
    toolPlanRunner: {},
    providerTurnLoop: {},
    skillPlaybookRunner: {},
    nativeToolExecutor: {},
    runtimeRouter: {},
    intentRouter: {},
    sessionSkillRegistry: {},
    sessionSkillCatalog: [],
    providerTools: [],
    providerRoutes: {},
    delegationManager: {},
    sessionRecallService: {},
    memoryFileCompactionService: {}
  } as never;
}
