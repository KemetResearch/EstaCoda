import { spawn } from "node:child_process";
import { mkdir, open, realpath, rm } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { ChannelSessionKey } from "../contracts/channel.js";
import type { Runtime } from "../runtime/create-runtime.js";
import type { CronJob } from "./cron-store.js";
import { CronStore } from "./cron-store.js";

export type CronRunResult = {
  job: CronJob;
  ok: boolean;
  output: string;
  delivered: boolean;
};

export type CronRunner = {
  runJob(job: CronJob): Promise<CronRunResult>;
};

type CronScriptResult = {
  ok: boolean;
  summary: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
};

export async function tickCron(input: {
  store: CronStore;
  runner: CronRunner;
  now?: Date;
  lockPath?: string;
}): Promise<CronRunResult[]> {
  return withCronTickLock(input.lockPath ?? defaultLockPath(input.store), async () => {
    const due = await input.store.due(input.now);
    const results: CronRunResult[] = [];

    for (const job of due) {
      const result = await input.runner.runJob(job);
      await input.store.markRunResult(job.id, {
        ok: result.ok,
        output: result.output
      });
      results.push(result);
    }

    return results;
  });
}

export function createRuntimeCronRunner(input: {
  runtimeFactory: (job: CronJob) => Promise<Runtime>;
  deliver?: (job: CronJob, content: string) => Promise<boolean>;
  wrapResponse?: boolean;
  disposeRuntime?: boolean;
  workspaceRoot?: string;
}): CronRunner {
  return {
    async runJob(job) {
      const scriptResult = job.script === undefined
        ? undefined
        : await runCronScript(job, input.workspaceRoot);

      if (scriptResult !== undefined && !scriptResult.ok) {
        const content = formatCronOutput(job, `Cron script failed: ${scriptResult.summary}\n\n${renderScriptResult(scriptResult)}`, input.wrapResponse ?? true);
        const delivered = await input.deliver?.(job, content) ?? false;
        return {
          job,
          ok: false,
          output: content,
          delivered
        };
      }

      const runtime = await input.runtimeFactory(job);
      try {
        const response = await runtime.handle({
          text: buildCronPrompt(job, scriptResult),
          channel: "cli",
          trustedWorkspace: true
        });
        const content = formatCronOutput(job, response.text, input.wrapResponse ?? true);
        const silent = response.text.trimStart().startsWith("[SILENT]");
        const delivered = !silent && (await input.deliver?.(job, content) ?? false);
        return {
          job,
          ok: true,
          output: content,
          delivered
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const content = formatCronOutput(job, `Cron job failed: ${message}`, input.wrapResponse ?? true);
        const delivered = await input.deliver?.(job, content) ?? false;
        return {
          job,
          ok: false,
          output: content,
          delivered
        };
      } finally {
        if (input.disposeRuntime !== false) {
          await runtime.dispose();
        }
      }
    }
  };
}

export function buildCronPrompt(job: CronJob, scriptResult?: CronScriptResult): string {
  return [
    "Scheduled task execution.",
    "The task prompt must be treated as self-contained; do not ask clarifying questions.",
    job.skills.length === 0 ? undefined : `Attached skills: ${job.skills.join(", ")}`,
    scriptResult === undefined ? undefined : renderScriptResult(scriptResult),
    "",
    job.prompt
  ].filter((line) => line !== undefined).join("\n");
}

export function formatCronOutput(job: CronJob, output: string, wrap: boolean): string {
  if (!wrap) return output;
  return [
    `Cronjob Response: ${job.name}`,
    "-------------",
    output,
    "",
    "Note: The agent cannot see this message, and therefore cannot respond to it."
  ].join("\n");
}

export function originFromSessionKey(sessionKey: ChannelSessionKey, channel: string): CronJob["origin"] {
  return {
    channel,
    chatId: sessionKey.chatId,
    userId: sessionKey.userId,
    threadId: sessionKey.threadId
  };
}

async function withCronTickLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await mkdirSafe(dirname(path));
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "EEXIST") {
      return [] as unknown as T;
    }
    throw error;
  }

  try {
    await handle.writeFile(new Date().toISOString(), "utf8");
    return await fn();
  } finally {
    await handle.close();
    await rm(path, { force: true });
  }
}

async function mkdirSafe(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function defaultLockPath(store: CronStore): string {
  return join(dirname(store.path), ".tick.lock");
}

async function runCronScript(job: CronJob, workspaceRoot: string | undefined): Promise<CronScriptResult> {
  if (workspaceRoot === undefined || workspaceRoot.trim().length === 0) {
    return failedScript("script-backed cron jobs require a workspace root");
  }

  const rawScript = job.script;
  if (rawScript === undefined || rawScript.trim().length === 0) {
    return failedScript("script path is empty");
  }

  try {
    const workspaceReal = await realpath(workspaceRoot);
    const scriptCandidate = isAbsolute(rawScript) ? rawScript : resolve(workspaceReal, rawScript);
    const scriptReal = await realpath(scriptCandidate);
    const relativePath = relative(workspaceReal, scriptReal);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return failedScript("script path must stay inside the active workspace");
    }

    const invocation = scriptInvocation(scriptReal);
    if (invocation === undefined) {
      return failedScript("script extension is not supported; use .sh, .bash, .zsh, .py, .js, .mjs, or .ts");
    }

    return await spawnCronScript({
      command: invocation.command,
      args: [...invocation.args, ...(job.scriptArgs ?? [])],
      cwd: workspaceReal,
      timeoutMs: boundedTimeout(job.scriptTimeoutMs)
    });
  } catch (error) {
    return failedScript(error instanceof Error ? error.message : String(error));
  }
}

function scriptInvocation(scriptPath: string): { command: string; args: string[] } | undefined {
  const extension = extname(scriptPath).toLowerCase();
  if (extension === ".sh" || extension === ".bash") return { command: "bash", args: [scriptPath] };
  if (extension === ".zsh") return { command: "zsh", args: [scriptPath] };
  if (extension === ".py") return { command: "python3", args: [scriptPath] };
  if (extension === ".js" || extension === ".mjs") return { command: "node", args: [scriptPath] };
  if (extension === ".ts") return { command: process.execPath, args: [scriptPath] };
  return undefined;
}

function spawnCronScript(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<CronScriptResult> {
  return new Promise((resolveScript) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      shell: false,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveScript({
        ok: false,
        summary: error.message,
        stdout,
        stderr
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolveScript({
          ok: false,
          summary: `script timed out after ${input.timeoutMs}ms`,
          stdout,
          stderr
        });
        return;
      }
      resolveScript({
        ok: code === 0,
        summary: code === 0 ? "script completed successfully" : `script exited with code ${code ?? "unknown"}`,
        stdout,
        stderr,
        exitCode: code ?? undefined
      });
    });
  });
}

function failedScript(summary: string): CronScriptResult {
  return {
    ok: false,
    summary,
    stdout: "",
    stderr: ""
  };
}

function renderScriptResult(result: CronScriptResult): string {
  return [
    "Cron script result:",
    `status: ${result.ok ? "succeeded" : "failed"}`,
    `summary: ${result.summary}`,
    result.exitCode === undefined ? undefined : `exit code: ${result.exitCode}`,
    "stdout:",
    result.stdout.trim().length === 0 ? "(empty)" : result.stdout.trim(),
    "stderr:",
    result.stderr.trim().length === 0 ? "(empty)" : result.stderr.trim()
  ].filter((line) => line !== undefined).join("\n");
}

function appendBounded(current: string, chunk: string): string {
  const maxChars = 8_000;
  const next = `${current}${chunk}`;
  return next.length <= maxChars ? next : `${next.slice(0, maxChars)}\n[truncated]`;
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 30_000;
  return Math.max(1_000, Math.min(120_000, Math.floor(value)));
}
