import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import type { ToolDefinition, ToolResult } from "../../contracts/tool.js";
import { ToolExecutor } from "../../tools/tool-executor.js";
import { ToolRegistry } from "../../tools/tool-registry.js";
import { InMemorySessionDB } from "../../session/in-memory-session-db.js";
import { TrajectoryRecorder } from "../../trajectory/trajectory-recorder.js";
import { createSecurityPolicyForMode } from "../../security/security-policy-factory.js";
import { assertEqual, assertTrue, buildResult } from "../eval-runner.js";

export const toolSecurityBlockCase: EvalCase = {
  id: "tool-security-block",
  name: "Dangerous command is blocked by security policy",
  description: "A terminal.run tool with rm -rf is denied under strict security policy.",
  tags: ["security", "tool", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const registry = new ToolRegistry();
    registry.register(createDangerousTool());

    const sessionDb = new InMemorySessionDB({ id: () => "eval-session", now: () => new Date() });
    await sessionDb.createSession({ id: "eval-session", profileId: "eval" });
    const trajectory = new TrajectoryRecorder({
      profileId: "eval",
      sessionId: "eval-session",
      modelId: "eval-model",
      id: () => "eval-traj",
      now: () => new Date()
    });
    const policy = createSecurityPolicyForMode("strict");
    const executor = new ToolExecutor({
      registry,
      securityPolicy: policy,
      sessionDb,
      trajectoryRecorder: trajectory
    });

    const record = await executor.executeTool({
      tool: "terminal.run",
      input: { command: "rm -rf /" },
      trustedWorkspace: false,
      sessionId: "eval-session"
    });

    const assertions = [
      assertTrue("record exists", record !== undefined),
      assertEqual("decision is deny", record?.decision, "deny"),
      assertTrue("risk class is elevated", (record?.riskClass ?? "read-only-local") !== "read-only-local"),
      assertEqual("no result on blocked tool", record?.result, undefined)
    ];

    return buildResult(
      "tool-security-block",
      "Dangerous command is blocked by security policy",
      assertions,
      Date.now() - startedAt
    );
  }
};

function createDangerousTool(): ToolDefinition & { run: (input: Record<string, unknown>) => Promise<ToolResult>; isAvailable: () => boolean } {
  return {
    name: "terminal.run",
    description: "Run a terminal command",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" }
      },
      required: ["command"]
    },
    riskClass: "destructive-local",
    toolsets: ["terminal"],
    progressLabel: "running command",
    maxResultSizeChars: 2000,
    isAvailable: () => true,
    run: async () => ({ ok: true, content: "executed" })
  };
}
