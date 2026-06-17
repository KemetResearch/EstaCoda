import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCronCommand } from "./cron-command.js";
import { CronStore } from "./cron-store.js";
import { CronExecutionStore } from "./cron-execution-store.js";
import { openDefaultSQLiteDatabase } from "../storage/factory.js";
import { createCronTools } from "../tools/cron-tools.js";
import { ProviderRegistry } from "../providers/provider-registry.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import type { ModelProfile, ProviderAdapter } from "../contracts/provider.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-cron-cmd-test-"));
}

async function setupExecutionStore(homeDir: string): Promise<CronExecutionStore> {
  const dbDir = join(homeDir, ".estacoda");
  await mkdir(dbDir, { recursive: true });
  const dbPath = join(dbDir, "sessions.sqlite");
  const db = openDefaultSQLiteDatabase({ path: dbPath });
  db.exec(`
    create table if not exists cron_executions (
      id text primary key,
      job_id text not null,
      session_id text,
      trajectory_id text,
      scheduled_at text,
      started_at text not null,
      completed_at text,
      status text not null,
      output_summary text,
      delivery_results_json text,
      failure_class text,
      failure_message text,
      created_at text not null
    )
  `);
  return new CronExecutionStore({ db });
}

function fakeRuntimeControls(): { config: LoadedRuntimeConfig; availableToolsets: () => string[] } {
  const model: ModelProfile = {
    provider: "local",
    id: "main-local",
    contextWindowTokens: 128_000,
    supportsTools: true,
    supportsVision: false,
    supportsStructuredOutput: true
  };
  const cronModel: ModelProfile = { ...model, id: "cron-local" };
  const registry = new ProviderRegistry();
  registry.register({
    id: "local",
    name: "Local",
    executable: true,
    health: () => ({ available: true }),
    listModels: () => [model, cronModel],
    complete: async () => ({
      ok: true,
      content: "ok",
      model: "main-local",
      provider: "local"
    })
  } satisfies ProviderAdapter);
  return {
    availableToolsets: () => ["core", "web", "files", "memory"],
    config: ({
      model,
      primaryModelRoute: { provider: "local", id: "main-local", profile: model, authMethod: "none" },
      modelFallbackRoutes: [],
      providerRegistry: registry,
      config: {
        providers: {
          local: { authMethod: "none", models: ["main-local", "cron-local"], enableNetwork: true }
        },
        model: { provider: "local", id: "main-local" }
      }
    } as unknown) as LoadedRuntimeConfig
  };
}

function fakeWorkdirControls(workspaceRoot: string, trusted = true) {
  return {
    defaultWorkspaceRoot: workspaceRoot,
    allowedRoots: [workspaceRoot],
    isWorkspaceTrusted: async () => trusted
  };
}

describe("runCronCommand", () => {
  let tmpDir: string;
  let store: CronStore;
  let executionStore: CronExecutionStore;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    store = new CronStore({ homeDir: tmpDir });
    executionStore = await setupExecutionStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("adds a job with flag syntax", async () => {
    const result = await runCronCommand({
      args: ["add", "--name", "x", "--schedule", "*/5 * * * *", "--command", "echo test"],
      store,
      executionStore
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Created cron job");
    expect(result.output).toContain("x");
    expect(result.output).toContain("*/5 * * * *");
  });

  it("adds and edits no-agent and contextFrom fields", async () => {
    const upstream = await store.create({ name: "upstream", schedule: "1h", prompt: "collect" });
    const result = await runCronCommand({
      args: [
        "add",
        "--name", "watchdog",
        "--schedule", "1h",
        "--command", "check",
        "--script", "watch.sh",
        "--no-agent",
        "--context-from", upstream.id
      ],
      store,
      executionStore
    });

    expect(result.ok).toBe(true);
    const [job] = (await store.list()).filter((entry) => entry.name === "watchdog");
    expect(job?.noAgent).toBe(true);
    expect(job?.contextFrom).toEqual([upstream.id]);

    const edit = await runCronCommand({
      args: ["edit", job!.id, "--agent", "--clear-context-from"],
      store,
      executionStore
    });
    expect(edit.ok).toBe(true);
    const updated = await store.get(job!.id);
    expect(updated?.noAgent).toBeUndefined();
    expect(updated?.contextFrom).toEqual([]);
  });

  it("edits basic fields without runtime-control validation", async () => {
    const job = await store.create({ name: "plain", schedule: "1h", prompt: "check" });

    const edit = await runCronCommand({
      args: ["edit", job.id, "--name", "renamed", "--prompt", "updated"],
      store,
      executionStore
    });

    expect(edit.ok).toBe(true);
    const updated = await store.get(job.id);
    expect(updated?.name).toBe("renamed");
    expect(updated?.prompt).toBe("updated");
  });

  it("adds edits and clears modelOverride and enabledToolsets", async () => {
    const runtimeControls = fakeRuntimeControls();
    const result = await runCronCommand({
      args: [
        "add",
        "--name", "controlled",
        "--schedule", "1h",
        "--command", "check",
        "--model", "cron-local",
        "--toolset", "web",
        "--toolset", "files"
      ],
      store,
      executionStore,
      runtimeControls
    });

    expect(result.ok).toBe(true);
    const [job] = (await store.list()).filter((entry) => entry.name === "controlled");
    expect(job?.modelOverride).toEqual({ provider: "local", model: "cron-local" });
    expect(job?.enabledToolsets).toEqual(["web", "files"]);

    const edit = await runCronCommand({
      args: ["edit", job!.id, "--clear-model", "--clear-toolsets"],
      store,
      executionStore,
      runtimeControls
    });
    expect(edit.ok).toBe(true);
    const updated = await store.get(job!.id);
    expect(updated?.modelOverride).toBeUndefined();
    expect(updated?.enabledToolsets).toEqual([]);
  });

  it("adds edits and clears workdir after workspace validation", async () => {
    const workdir = join(tmpDir, "workspace");
    const otherWorkdir = join(workdir, "reports");
    await mkdir(otherWorkdir, { recursive: true });
    const otherWorkdirReal = await realpath(otherWorkdir);
    const result = await runCronCommand({
      args: ["add", "--name", "workdir", "--schedule", "1h", "--command", "check", "--workdir", otherWorkdir],
      store,
      executionStore,
      workdirControls: fakeWorkdirControls(workdir)
    });

    expect(result.ok).toBe(true);
    const [job] = (await store.list()).filter((entry) => entry.name === "workdir");
    expect(job?.workdir).toBe(otherWorkdirReal);

    const edit = await runCronCommand({
      args: ["edit", job!.id, "--clear-workdir"],
      store,
      executionStore,
      workdirControls: fakeWorkdirControls(workdir)
    });
    expect(edit.ok).toBe(true);
    const updated = await store.get(job!.id);
    expect(updated?.workdir).toBeUndefined();
  });

  it("rejects invalid workdir before persistence", async () => {
    const workspaceRoot = join(tmpDir, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const result = await runCronCommand({
      args: ["add", "--schedule", "1h", "--command", "check", "--workdir", "relative"],
      store,
      executionStore,
      workdirControls: fakeWorkdirControls(workspaceRoot)
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Cron workdir must be an absolute path");
    expect(await store.list()).toHaveLength(0);
  });

  it("rejects invalid model and forbidden or unknown toolsets before persistence", async () => {
    const runtimeControls = fakeRuntimeControls();
    const invalidModel = await runCronCommand({
      args: ["add", "--schedule", "1h", "--command", "check", "--provider", "missing-provider", "--model", "missing"],
      store,
      executionStore,
      runtimeControls
    });
    expect(invalidModel.ok).toBe(false);
    expect(invalidModel.output).toContain("Invalid cron model override");

    const forbidden = await runCronCommand({
      args: ["add", "--schedule", "1h", "--command", "check", "--toolset", "cron"],
      store,
      executionStore,
      runtimeControls
    });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.output).toContain("cannot enable the cron toolset");

    const unknown = await runCronCommand({
      args: ["add", "--schedule", "1h", "--command", "check", "--toolset", "unknown"],
      store,
      executionStore,
      runtimeControls
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.output).toContain("Unknown cron toolset: unknown");

    const staleHardCodedToolset = await runCronCommand({
      args: ["add", "--schedule", "1h", "--command", "check", "--toolset", "dangerous"],
      store,
      executionStore,
      runtimeControls
    });
    expect(staleHardCodedToolset.ok).toBe(false);
    expect(staleHardCodedToolset.output).toContain("Unknown cron toolset: dangerous");
    expect(await store.list()).toHaveLength(0);
  });

  it("rejects unknown contextFrom ids before persistence", async () => {
    const result = await runCronCommand({
      args: ["add", "--schedule", "1h", "--command", "check", "--context-from", "missing"],
      store,
      executionStore
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Unknown contextFrom job id: missing");
    expect(await store.list()).toHaveLength(0);
  });

  it("rejects no-agent CLI jobs without scripts", async () => {
    const result = await runCronCommand({
      args: ["add", "--schedule", "1h", "--command", "check", "--no-agent"],
      store,
      executionStore
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("no-agent cron jobs require --script");
  });

  it("shows usage when flag syntax is missing required args", async () => {
    const result = await runCronCommand({ args: ["add", "--schedule", "*/5 * * * *"], store, executionStore });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("cron add --schedule");
  });

  it("keeps cronjob create requiring prompt and schedule in agent mode", async () => {
    const [tool] = createCronTools({ store });
    expect(tool).toBeDefined();

    await expect(tool!.run({ action: "create", prompt: "hello" })).resolves.toMatchObject({
      ok: false,
      content: "cronjob create requires prompt and schedule."
    });
    await expect(tool!.run({ action: "create", schedule: "1h" })).resolves.toMatchObject({
      ok: false,
      content: "cronjob create requires prompt and schedule."
    });
  });

  it("cronjob tool round-trips noAgent, skills, contextFrom, model, enabled toolsets, and workdir", async () => {
    const workdir = join(tmpDir, "tool-workdir");
    await mkdir(workdir, { recursive: true });
    const workdirReal = await realpath(workdir);
    const [tool] = createCronTools({
      store,
      runtimeControls: fakeRuntimeControls(),
      workdirControls: fakeWorkdirControls(tmpDir)
    });
    const upstream = await store.create({ name: "upstream", schedule: "1h", prompt: "collect" });

    const created = await tool!.run({
      action: "create",
      prompt: "check",
      schedule: "1h",
      script: "watch.sh",
      no_agent: true,
      skills: ["watch"],
      context_from: [upstream.id],
      model: { model: "cron-local" },
      enabled_toolsets: ["web"],
      workdir
    });

    expect(created.ok).toBe(true);
    const [job] = (await store.list()).filter((entry) => entry.prompt === "check");
    expect(job?.noAgent).toBe(true);
    expect(job?.skills).toEqual(["watch"]);
    expect(job?.contextFrom).toEqual([upstream.id]);
    expect(job?.modelOverride).toEqual({ provider: "local", model: "cron-local" });
    expect(job?.enabledToolsets).toEqual(["web"]);
    expect(job?.workdir).toBe(workdirReal);
  });

  it("delegates cron tick to the supplied tick callback", async () => {
    const result = await runCronCommand({
      args: ["tick"],
      store,
      executionStore,
      tick: async () => "Cron tick complete. No due jobs."
    });

    expect(result).toEqual({
      ok: true,
      output: "Cron tick complete. No due jobs."
    });
  });

  it("lists jobs", async () => {
    await store.create({ schedule: "1h", prompt: "test" });
    const result = await runCronCommand({ args: ["list"], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("test");
  });

  it("shows job detail with executions", async () => {
    const job = await store.create({ schedule: "1h", prompt: "test" });
    const record = await executionStore.create({ jobId: job.id });
    await executionStore.complete(record.id, { status: "success" });

    const result = await runCronCommand({ args: ["show", job.id], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain(job.id);
    expect(result.output).toContain("Recent executions");
    expect(result.output).toContain("success");
  });

  it("returns error for missing job in show", async () => {
    const result = await runCronCommand({ args: ["show", "missing-id"], store, executionStore });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not found");
  });

  it("shows execution history", async () => {
    const job = await store.create({ schedule: "1h", prompt: "test" });
    const record = await executionStore.create({ jobId: job.id });
    await executionStore.complete(record.id, { status: "failed", failureClass: "timeout" });

    const result = await runCronCommand({ args: ["history", job.id], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("failed");
    expect(result.output).toContain("timeout");
  });

  it("shows all history when no job id given", async () => {
    const job = await store.create({ schedule: "1h", prompt: "test" });
    const record = await executionStore.create({ jobId: job.id });
    await executionStore.complete(record.id, { status: "success" });

    const result = await runCronCommand({ args: ["history"], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("success");
  });

  it("pauses a job", async () => {
    const job = await store.create({ schedule: "1h", prompt: "test" });
    const result = await runCronCommand({ args: ["pause", job.id], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Paused");

    const updated = await store.get(job.id);
    expect(updated?.status).toBe("paused");
  });

  it("resumes a job", async () => {
    const job = await store.create({ schedule: "1h", prompt: "test" });
    await store.pause(job.id);
    const result = await runCronCommand({ args: ["resume", job.id], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Resumed");

    const updated = await store.get(job.id);
    expect(updated?.status).toBe("active");
  });

  it("requests a run", async () => {
    const job = await store.create({ schedule: "1h", prompt: "test" });
    const result = await runCronCommand({ args: ["run", job.id], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Queued");

    const updated = await store.get(job.id);
    expect(updated?.runRequested).toBe(true);
  });

  it("removes a job", async () => {
    const job = await store.create({ schedule: "1h", prompt: "test" });
    const result = await runCronCommand({ args: ["remove", job.id], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Removed");

    const missing = await store.get(job.id);
    expect(missing).toBeUndefined();
  });

  it("returns error for missing job in pause", async () => {
    const result = await runCronCommand({ args: ["pause", "missing-id"], store, executionStore });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not found");
  });

  it("returns help when no args given", async () => {
    const result = await runCronCommand({ args: [], store, executionStore });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("cron add");
    expect(result.output).toContain("cron list");
    expect(result.output).toContain("cron show");
    expect(result.output).toContain("cron history");
    expect(result.output).toContain("cron pause");
    expect(result.output).toContain("cron resume");
    expect(result.output).toContain("cron run");
    expect(result.output).toContain("cron remove");
  });

  it("does not crash on show/history with a fresh execution store (auto-creates schema)", async () => {
    const freshDbDir = join(tmpDir, ".estacoda-fresh");
    await mkdir(freshDbDir, { recursive: true });
    const freshDbPath = join(freshDbDir, "sessions.sqlite");
    const freshDb = openDefaultSQLiteDatabase({ path: freshDbPath });
    const freshExecutionStore = new CronExecutionStore({ db: freshDb });
    const job = await store.create({ schedule: "1h", prompt: "test" });
    const resultShow = await runCronCommand({ args: ["show", job.id], store, executionStore: freshExecutionStore });
    expect(resultShow.ok).toBe(true);
    expect(resultShow.output).toContain(job.id);
    const resultHistory = await runCronCommand({ args: ["history", job.id], store, executionStore: freshExecutionStore });
    expect(resultHistory.ok).toBe(true);
    freshDb.close();
  });
});
