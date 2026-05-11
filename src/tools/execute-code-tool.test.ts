import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createExecuteCodeTool } from "./execute-code-tool.js";
import type { SessionDB } from "../contracts/session.js";
import type { ToolExecutor } from "./tool-executor.js";
import type { TrajectoryRecorder } from "../trajectory/trajectory-recorder.js";

describe("execute_code environment isolation", () => {
  beforeAll(() => {
    process.env.ESTACODA_SECRET_PROBE = "leaked-secret";
    process.env.OPENAI_API_KEY = "sk-openai-test";
    process.env.ANTHROPIC_API_KEY = "sk-anthropic-test";
    process.env.KIMI_API_KEY = "sk-kimi-test";
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test";
    process.env.DATABASE_URL = "postgres://localhost/db";
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.NPM_TOKEN = "npm_test";
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  });

  afterAll(() => {
    delete process.env.ESTACODA_SECRET_PROBE;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_TOKEN;
    delete process.env.NPM_TOKEN;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  async function runPython(code: string, input?: Record<string, unknown>) {
    const tool = createExecuteCodeTool({
      workspaceRoot: "/tmp",
      toolExecutor: {
        executeTool: async () => undefined
      } as unknown as ToolExecutor,
      sessionDb: {
        createSession: async () => ({ id: "test", profileId: "test", createdAt: new Date() }),
        getSession: async () => undefined,
        listSessions: async () => [],
        appendMessage: async () => ({ id: "1", role: "user", content: "", createdAt: new Date() }),
        appendEvent: async () => {},
        listMessages: async () => [],
        listEvents: async () => [],
        search: async () => []
      } as unknown as SessionDB,
      trajectoryRecorder: {} as unknown as TrajectoryRecorder,
      sessionId: "test-session",
      trustedWorkspace: async () => true,
      allowedTools: []
    });

    return await tool.run({ code, input });
  }

  it("blocks ESTACODA_SECRET_PROBE from subprocess", async () => {
    const result = await runPython(`
import os
print("PROBE=" + os.environ.get("ESTACODA_SECRET_PROBE", "MISSING"))
`);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("PROBE=MISSING");
    expect(result.content).not.toContain("leaked-secret");
  });

  it("blocks API keys and tokens from subprocess", async () => {
    const result = await runPython(`
import os
keys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "KIMI_API_KEY",
    "DEEPSEEK_API_KEY",
    "DATABASE_URL",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY"
]
found = [k for k in keys if os.environ.get(k)]
print("FOUND=" + ",".join(found))
`);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("FOUND=");
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "KIMI_API_KEY",
      "DEEPSEEK_API_KEY",
      "DATABASE_URL",
      "GITHUB_TOKEN",
      "NPM_TOKEN",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY"
    ]) {
      expect(result.content).not.toContain(key);
    }
  });

  it("preserves ESTACODA_INPUT_JSON in subprocess", async () => {
    const result = await runPython(`
import os
print("INPUT=" + os.environ.get("ESTACODA_INPUT_JSON", "MISSING"))
`, { greeting: "hello" });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("INPUT=");
    expect(result.content).not.toContain("INPUT=MISSING");
    expect(result.content).toContain("greeting");
  });

  it("preserves ESTACODA_ALLOWED_TOOLS_JSON in subprocess", async () => {
    const result = await runPython(`
import os
print("TOOLS=" + os.environ.get("ESTACODA_ALLOWED_TOOLS_JSON", "MISSING"))
`);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("TOOLS=");
    expect(result.content).not.toContain("TOOLS=MISSING");
    expect(result.content).toContain("[]");
  });

  it("isolates HOME and does not leak real user HOME", async () => {
    const realHome = process.env.HOME ?? "";
    const result = await runPython(`
import os
print("HOME=" + os.environ.get("HOME", "MISSING"))
`);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("HOME=");
    expect(result.content).not.toContain("HOME=MISSING");
    if (realHome.length > 0) {
      expect(result.content).not.toContain("HOME=" + realHome);
    }
  });

  it("preserves PATH, TMP, and LANG where available", async () => {
    const hasTmp = !!(process.env.TMPDIR || process.env.TMP || process.env.TEMP);
    const hasLang = !!(process.env.LANG || process.env.LC_ALL);

    const result = await runPython(`
import os
print("PATH=" + ("yes" if "PATH" in os.environ else "no"))
print("TMP=" + ("yes" if any(k in os.environ for k in ["TMPDIR", "TMP", "TEMP"]) else "no"))
print("LANG=" + ("yes" if any(k in os.environ for k in ["LANG", "LC_ALL"]) else "no"))
`);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("PATH=yes");
    expect(result.content).toContain(hasTmp ? "TMP=yes" : "TMP=no");
    expect(result.content).toContain(hasLang ? "LANG=yes" : "LANG=no");
  });
});
