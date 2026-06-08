import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workflowCommand } from "./workflow-commands.js";
import { createSQLiteSessionDB } from "../session/session-setup.js";
import { SQLiteWorkflowStore } from "../workflow/sqlite-workflow-store.js";

describe("workflowCommand begin", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "estacoda-workflow-command-test-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("requires an explicit session ID when no runtime session is available", async () => {
    const result = await workflowCommand(cliOptions(tempHome), ["begin", "refactor", "auth"]);

    expect(result).toMatchObject({
      handled: true,
      exitCode: 1
    });
    expect(result.output).toContain("Usage: estacoda workflow begin --session <sessionId> <objective>");
    expect(result.output).toContain("requires an explicit session ID");
  });

  it("creates and starts a workflow run for an explicit session without claiming activation", async () => {
    const sessionDb = await createSQLiteSessionDB({ homeDir: tempHome });
    await sessionDb.createSession({ id: "session-1", profileId: "default" });
    sessionDb.close();

    const result = await workflowCommand(cliOptions(tempHome), [
      "begin",
      "--session",
      "session-1",
      "refactor",
      "the",
      "auth",
      "module"
    ]);

    expect(result).toMatchObject({
      handled: true,
      exitCode: 0
    });
    expect(result.output).toContain("Created workflow: ");
    expect(result.output).toContain("Started workflow: ");
    expect(result.output).toContain("Not activated. Use /workflow activate ");
    expect(result.output).not.toContain("Activated workflow:");

    const readDb = await createSQLiteSessionDB({ homeDir: tempHome });
    const store = new SQLiteWorkflowStore({ db: readDb.db });
    const runs = await store.listWorkflowRuns("session-1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      sessionId: "session-1",
      status: "running",
      metadata: {
        activationReason: "explicit",
        objective: "refactor the auth module"
      }
    });
    const steps = await store.listWorkflowSteps(runs[0].id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      name: "Work on objective",
      description: "Continue the requested work through AgentLoop",
      status: "running",
      maxRetries: 0,
      idempotent: false
    });
    readDb.close();
  });

  it("rejects a session ID outside the active profile", async () => {
    const sessionDb = await createSQLiteSessionDB({ homeDir: tempHome });
    await sessionDb.createSession({ id: "session-2", profileId: "other" });
    sessionDb.close();

    const result = await workflowCommand(cliOptions(tempHome), [
      "begin",
      "--session",
      "session-2",
      "refactor",
      "auth"
    ]);

    expect(result).toMatchObject({
      handled: true,
      exitCode: 1
    });
    expect(result.output).toBe("Session not found in active profile: session-2");
  });
});

function cliOptions(homeDir: string) {
  return {
    argv: [],
    workspaceRoot: homeDir,
    homeDir
  };
}
