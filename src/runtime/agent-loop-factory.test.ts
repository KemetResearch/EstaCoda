import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DELEGATION_CONFIG } from "../config/delegation-defaults.js";
import type { SessionRecord } from "../contracts/session.js";
import type { ToolDefinition, ToolRiskClass, ToolsetName } from "../contracts/tool.js";
import { InMemorySessionDB } from "../session/in-memory-session-db.js";
import { ToolRegistry } from "../tools/tool-registry.js";
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
      trustedWorkspace: true,
      parentVisibleTools: readOnlyParentTools()
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
        effectiveAllowedTools: ["file.search"],
        strippedTools: expect.arrayContaining([
          expect.objectContaining({ name: "terminal.run" })
        ]),
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
      trustedWorkspace: true,
      parentVisibleTools: readOnlyParentTools()
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

  it("strips delegate_task from leaf child registries", async () => {
    const db = new InMemorySessionDB();
    const built = fakeBuiltSession();
    const tools = parentToolsWithDelegate();
    const builder = fakeBuilder(built, tools);
    const factory = new DefaultChildAgentLoopFactory({
      builder: builder as never,
      sessionDb: db,
      trajectoryRecorderFactory: ({ profileId, sessionId }) => new TrajectoryRecorder({ profileId, sessionId, modelId: "model" }),
      responseLabel: "EstaCoda",
      workspaceRoot: "/workspace",
      delegationConfig: { ...DEFAULT_DELEGATION_CONFIG, maxSpawnDepth: 3 },
      id: () => "child-1"
    });

    const child = await factory.createChild({
      parentSessionId: "parent-1",
      profileId: "default",
      task: "Leaf child",
      trustedWorkspace: true,
      role: "leaf",
      depth: 1,
      parentVisibleTools: tools
    });

    expect(child.builtSession.toolRegistry.get("delegate_task")).toBeUndefined();
    expect(child.toolAccess.blockedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "delegate_task", reasons: expect.arrayContaining(["leaf-delegation-disabled"]) })
    ]));
  });

  it("keeps delegate_task for orchestrators below max spawn depth", async () => {
    const db = new InMemorySessionDB();
    const built = fakeBuiltSession();
    const tools = parentToolsWithDelegate();
    const builder = fakeBuilder(built, tools);
    const factory = new DefaultChildAgentLoopFactory({
      builder: builder as never,
      sessionDb: db,
      trajectoryRecorderFactory: ({ profileId, sessionId }) => new TrajectoryRecorder({ profileId, sessionId, modelId: "model" }),
      responseLabel: "EstaCoda",
      workspaceRoot: "/workspace",
      delegationConfig: { ...DEFAULT_DELEGATION_CONFIG, maxSpawnDepth: 3 },
      id: () => "child-1"
    });

    const child = await factory.createChild({
      parentSessionId: "parent-1",
      profileId: "default",
      task: "Orchestrator child",
      trustedWorkspace: true,
      role: "orchestrator",
      depth: 1,
      parentVisibleTools: tools
    });

    expect(child.builtSession.toolRegistry.get("delegate_task")).toBeDefined();
    expect(child.toolAccess.effectiveAllowedTools).toContain("delegate_task");
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

function fakeBuilder(built: BuiltAgentLoopSession, tools: readonly ToolDefinition[] = readOnlyParentTools()) {
  return {
    buildSession: vi.fn(async (input: {
      toolRegistryFilter?: BuiltAgentLoopSession["toolFilterResult"] extends never ? never : (filterInput: {
        registry: ToolRegistry;
        availableTools: ReturnType<ToolRegistry["list"]>;
      }) => unknown;
    }) => {
      const registry = new ToolRegistry();
      for (const tool of tools) {
        registry.register({
          ...tool,
          isAvailable: () => true,
          run: async () => ({ ok: true, content: "" })
        });
      }
      input.toolRegistryFilter?.({
        registry,
        availableTools: registry.list()
      });
      return {
        ...built,
        toolRegistry: registry
      };
    }),
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

function readOnlyParentTools() {
  return [
    tool("file.search", "read-only-local", ["files", "research"]),
    tool("web.search", "read-only-network", ["web", "research"]),
    tool("terminal.run", "workspace-write", ["shell-write", "coding"])
  ];
}

function parentToolsWithDelegate() {
  return [
    ...readOnlyParentTools(),
    tool("delegate_task", "shared-state-mutation", ["core", "research", "coding"])
  ] as const;
}

function tool(name: string, riskClass: ToolRiskClass, toolsets: ToolsetName[]) {
  return {
    name,
    description: name,
    inputSchema: { type: "object" },
    riskClass,
    toolsets,
    progressLabel: name,
    maxResultSizeChars: 1000
  };
}
