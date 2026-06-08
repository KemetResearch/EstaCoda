import { describe, expect, it } from "vitest";
import { FakeWorkflowStore } from "./fake-workflow-store.js";
import { WorkflowEngine } from "./workflow-engine.js";
import { WorkflowLockService } from "./workflow-lock-service.js";
import { beginExplicitWorkflowRun, buildExplicitObjectiveWorkflowPlan, summarizeObjective } from "./workflow-begin.js";
import type { IntentRoute } from "../contracts/intent.js";

describe("workflow explicit begin helpers", () => {
  it("builds a conservative one-step objective plan", () => {
    const plan = buildExplicitObjectiveWorkflowPlan("  refactor   the auth module  ");

    expect(plan).toEqual({
      name: "refactor the auth module",
      description: "refactor the auth module",
      steps: [
        {
          name: "Work on objective",
          description: "Continue the requested work through AgentLoop",
          requiresApproval: false,
          skippable: false,
          maxRetries: 0,
          idempotent: false
        }
      ]
    });
  });

  it("summarizes objectives deterministically without inferring structure", () => {
    expect(summarizeObjective("  short   objective  ")).toBe("short objective");
    expect(summarizeObjective("x".repeat(100))).toBe(`${"x".repeat(77)}...`);
  });

  it("persists explicit workflow provenance on the WorkflowRun metadata", async () => {
    const store = new FakeWorkflowStore();
    const lockService = new WorkflowLockService({ store });
    const engine = new WorkflowEngine({ store, lockService, ownerId: "test" });

    const result = await beginExplicitWorkflowRun({
      engine,
      sessionId: "session-1",
      objective: "refactor auth"
    });

    expect(result.run.status).toBe("running");
    expect(result.run.metadata).toEqual({
      activationReason: "explicit",
      objective: "refactor auth"
    });
    const stored = await store.getWorkflowRun(result.run.id);
    expect(stored?.metadata).toEqual({
      activationReason: "explicit",
      objective: "refactor auth"
    });
  });
});

describe("WorkflowEngine metadata", () => {
  it("copies CreateWorkflowRunInput metadata into created workflow runs", async () => {
    const store = new FakeWorkflowStore();
    const lockService = new WorkflowLockService({ store });
    const engine = new WorkflowEngine({ store, lockService, ownerId: "test" });

    const run = await engine.createWorkflowRun({
      sessionId: "session-1",
      intent: makeIntent(),
      plan: {
        name: "Test",
        description: "Test",
        steps: [{ name: "Step", description: "Step" }]
      },
      metadata: {
        activationReason: "explicit",
        objective: "test objective"
      }
    });

    expect(run.metadata).toEqual({
      activationReason: "explicit",
      objective: "test objective"
    });
  });
});

function makeIntent(): IntentRoute {
  return {
    nativeIntent: "general",
    labels: ["test"],
    confidence: 1,
    suggestedToolsets: [],
    suggestedSkills: [],
    confirmationRequired: false,
    evidence: [],
    rationale: "test"
  };
}
