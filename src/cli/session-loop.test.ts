import { describe, it, expect } from "vitest";
import { runSessionLoop } from "./session-loop.js";
import { InMemorySessionDB } from "../session/in-memory-session-db.js";
import type { Runtime } from "../runtime/create-runtime.js";
import type { AgentLoopResponse } from "../runtime/agent-loop.js";

function createMockRuntime(): Runtime {
  const sessionDb = new InMemorySessionDB();
  return {
    describe: () => "mock runtime",
    getStatus: () => ({
      kind: "status" as const,
      agentName: "EstaCoda",
      model: { provider: "mock", id: "mock-model" },
      securityMode: "open",
      skillCount: 0,
      toolCount: 0,
      mcp: { active: 0, total: 0 },
      taskflowActive: false,
      warnings: [],
    }),
    getModelInfo: () => ({
      kind: "kv" as const,
      title: "Model",
      entries: [
        { key: "provider", value: "mock" },
        { key: "model", value: "mock-model" },
      ],
    }),
    getStartup: () => ({
      kind: "startup" as const,
      agentName: "EstaCoda",
      taglines: [],
      model: { provider: "mock", id: "mock-model" },
      readiness: "ready",
      warnings: [],
    }),
    getStartupReadiness: async () => ({
      workspaceTrust: "trusted",
      workspaceVerification: "verified",
      providerReadiness: "ready",
      versionStatus: "unknown",
      workspaceDirectory: "/tmp",
      securityMode: "open",
      model: { provider: "mock", id: "mock-model" },
      warnings: [],
    }),
    tools: () => [],
    skills: () => [],
    latestResumeNote: async () => undefined,
    inspectMemoryPromotions: async () => [],
    inspectMcpServers: () => [],
    handle: async (): Promise<AgentLoopResponse> => ({
      label: "EstaCoda",
      text: "Mock response",
      matchedSkills: [],
      intent: {
        nativeIntent: "general",
        labels: ["chat"],
        confidence: 1,
        suggestedToolsets: [],
        suggestedSkills: [],
        evidence: [{ kind: "native-intent" as const, detail: "mock" }],
        confirmationRequired: false,
        rationale: "mock",
      },
      securityDecision: "allow",
      toolExecutions: [],
      toolPlans: [],
      skillOutcomes: [],
      artifacts: [],
      context: undefined,
      projectContext: undefined,
      progress: [],
    }),
    trustWorkspace: async () => {},
    isWorkspaceTrusted: async () => true,
    revokeWorkspaceTrust: async () => true,
    dispose: async () => {},
    sessionDb,
    sessionId: "test-session",
  };
}

describe("runSessionLoop — user prompt rail behavior", () => {
  it("renders a user prompt rail for normal non-slash input", async () => {
    const outputChunks: string[] = [];
    const runtime = createMockRuntime();
    let promptIndex = 0;

    await runSessionLoop({
      runtime,
      output: {
        write(chunk: string | Uint8Array): boolean {
          outputChunks.push(String(chunk));
          return true;
        },
      } as NodeJS.WritableStream,
      prompt: Object.assign(
        async () => {
          const values = ["hello", "/exit"];
          return values[promptIndex++] ?? "/exit";
        },
        { close: () => {} }
      ),
      close: () => {},
    });

    const rendered = outputChunks.join("");
    expect(rendered).toContain("> hello");
    expect(rendered).toContain("+----------------------------------------------------------+");
  });

  it("does not render a user prompt rail for slash commands", async () => {
    const outputChunks: string[] = [];
    const runtime = createMockRuntime();
    let promptIndex = 0;

    await runSessionLoop({
      runtime,
      output: {
        write(chunk: string | Uint8Array): boolean {
          outputChunks.push(String(chunk));
          return true;
        },
      } as NodeJS.WritableStream,
      prompt: Object.assign(
        async () => {
          const values = ["/help", "/exit"];
          return values[promptIndex++] ?? "/exit";
        },
        { close: () => {} }
      ),
      close: () => {},
    });

    const rendered = outputChunks.join("");
    expect(rendered).toContain("EstaCoda session commands");
    expect(rendered).not.toContain("\u25b8 /help");
    expect(rendered).not.toContain("> /help");
  });
});
