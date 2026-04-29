import { mkdir, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
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
}): CronRunner {
  return {
    async runJob(job) {
      const runtime = await input.runtimeFactory(job);
      try {
        const response = await runtime.handle({
          text: buildCronPrompt(job),
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

export function buildCronPrompt(job: CronJob): string {
  return [
    "Scheduled task execution.",
    "The task prompt must be treated as self-contained; do not ask clarifying questions.",
    job.skills.length === 0 ? undefined : `Attached skills: ${job.skills.join(", ")}`,
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
