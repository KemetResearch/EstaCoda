import { describe, expect, it, vi } from "vitest";
import type { IntentRoute } from "../contracts/intent.js";
import type { ModelProfile } from "../contracts/provider.js";
import type { SecurityPolicy } from "../contracts/security.js";
import type { SkillDefinition } from "../contracts/skill.js";
import type { ToolDefinition } from "../contracts/tool.js";
import type { ToolExecutionRecord } from "../tools/tool-executor.js";
import { InMemorySessionDB } from "../session/in-memory-session-db.js";
import { TrajectoryRecorder } from "../trajectory/trajectory-recorder.js";
import { RunRecorder } from "./run-recorder.js";
import { AgentLoop } from "./agent-loop.js";
import type { NativeToolExecutor } from "./native-tool-executor.js";
import type { ProviderTurnLoop } from "./provider-turn-loop.js";
import type { RuntimeRouter } from "./runtime-router.js";
import type { SkillWorkflowExecutor } from "./skill-workflow-executor.js";
import type { ToolPlanRunner } from "./tool-plan-runner.js";

const model: ModelProfile = {
  id: "test-model",
  provider: "test-provider",
  contextWindowTokens: 128_000,
  supportsTools: true,
  supportsVision: false,
  supportsStructuredOutput: true
};

const selectedSkill: SkillDefinition = {
  name: "test-skill",
  description: "Test skill",
  version: "0.1.0",
  whenToUse: ["testing"],
  requiredToolsets: ["files"],
  workflow: [
    {
      id: "read",
      description: "Read something",
      toolsets: ["files"]
    }
  ],
  permissionExpectations: ["auto-read"],
  examples: [],
  evaluations: []
};

const intent: IntentRoute = {
  labels: ["test-skill"],
  confidence: 1,
  nativeIntent: "general",
  evidence: [],
  suggestedToolsets: ["files"],
  suggestedSkills: [selectedSkill],
  confirmationRequired: false,
  rationale: "test route"
};

const tool: ToolDefinition = {
  name: "files.read",
  description: "Read file",
  inputSchema: {},
  riskClass: "read-only-local",
  toolsets: ["files"],
  progressLabel: "reading",
  maxResultSizeChars: 1000
};

const execution: ToolExecutionRecord = {
  tool,
  decision: "allow",
  riskClass: "read-only-local",
  result: {
    ok: true,
    content: "read result"
  }
};

const securityPolicy: SecurityPolicy = {
  decide: () => "allow"
};

async function createAgentLoop(input: {
  canRunProvider: boolean;
  executeSkillWorkflow: ReturnType<typeof vi.fn>;
}) {
  const sessionDb = new InMemorySessionDB();
  const sessionId = `agent-loop-test-${Date.now()}-${Math.random()}`;
  await sessionDb.createSession({ id: sessionId, profileId: "default", title: "test" });
  const trajectoryRecorder = new TrajectoryRecorder({
    profileId: "default",
    sessionId,
    modelId: model.id
  });
  const runRecorder = new RunRecorder({
    sessionDb,
    sessionId,
    trajectoryRecorder,
    profileId: "default"
  });

  const runtimeRouter = {
    route: vi.fn(() => ({
      intent,
      selectedSkill,
      selectedSkillInstructions: undefined,
      selectedSkillResources: undefined,
      selectedSkillSetup: undefined,
      attachments: undefined
    }))
  } as unknown as RuntimeRouter;

  const providerTurnLoop = {
    canRunProvider: vi.fn(() => input.canRunProvider),
    run: vi.fn(async () => ({
      providerExecution: undefined,
      toolExecutions: [],
      iterations: 0
    }))
  } as unknown as ProviderTurnLoop;

  const skillWorkflowExecutor = {
    executeSkillWorkflow: input.executeSkillWorkflow
  } as unknown as SkillWorkflowExecutor;

  const nativeToolExecutor = {
    executeDeterministicNativeTools: vi.fn(async () => ({
      executions: [],
      plans: []
    }))
  } as unknown as NativeToolExecutor;

  const loop = new AgentLoop({
    runRecorder,
    runtimeRouter,
    toolPlanRunner: {} as unknown as ToolPlanRunner,
    providerTurnLoop,
    skillWorkflowExecutor,
    nativeToolExecutor,
    responseLabel: "Test",
    intentRouter: {} as any,
    securityPolicy,
    trajectoryRecorder,
    sessionDb,
    sessionId,
    profileId: "default",
    toolExecutor: {} as any,
    model,
    providerTools: []
  });

  return {
    loop,
    providerTurnLoop,
    executeSkillWorkflow: input.executeSkillWorkflow
  };
}

describe("AgentLoop provider availability gating", () => {
  it("runs deterministic skill workflow when ProviderTurnLoop cannot run provider", async () => {
    const executeSkillWorkflow = vi.fn(async () => [execution]);
    const { loop, providerTurnLoop } = await createAgentLoop({
      canRunProvider: false,
      executeSkillWorkflow
    });

    const response = await loop.handle({
      text: "use the test skill",
      channel: "cli",
      trustedWorkspace: true
    });

    expect(providerTurnLoop.canRunProvider).toHaveBeenCalledTimes(1);
    expect(executeSkillWorkflow).toHaveBeenCalledTimes(1);
    expect(response.toolExecutions).toHaveLength(1);
    expect(response.toolExecutions[0]?.tool.name).toBe("files.read");
  });

  it("skips deterministic skill workflow when ProviderTurnLoop can run provider", async () => {
    const executeSkillWorkflow = vi.fn(async () => [execution]);
    const { loop, providerTurnLoop } = await createAgentLoop({
      canRunProvider: true,
      executeSkillWorkflow
    });

    const response = await loop.handle({
      text: "use the test skill",
      channel: "cli",
      trustedWorkspace: true
    });

    expect(providerTurnLoop.canRunProvider).toHaveBeenCalledTimes(1);
    expect(executeSkillWorkflow).not.toHaveBeenCalled();
    expect(response.toolExecutions).toHaveLength(0);
  });
});
