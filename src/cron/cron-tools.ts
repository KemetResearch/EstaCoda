import type { RegisteredTool } from "../contracts/tool.js";
import { CronStore } from "./cron-store.js";

type CronjobToolInput = {
  action?: "create" | "list" | "update" | "pause" | "resume" | "run" | "remove";
  job_id?: string;
  jobId?: string;
  prompt?: string;
  schedule?: string;
  name?: string;
  skill?: string;
  skills?: string[];
  delivery?: string;
  repeat?: number;
};

export function createCronTools(options: { store: CronStore }): RegisteredTool[] {
  return [{
    name: "cronjob",
    description: "Create and manage scheduled EstaCoda tasks.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "update", "pause", "resume", "run", "remove"] },
        job_id: { type: "string" },
        prompt: { type: "string" },
        schedule: { type: "string" },
        name: { type: "string" },
        skill: { type: "string" },
        skills: { type: "array", items: { type: "string" } },
        delivery: { type: "string" },
        repeat: { type: "number" }
      },
      required: ["action"]
    },
    riskClass: "shared-state-mutation",
    toolsets: ["core", "cron"],
    progressLabel: "updating cron jobs",
    maxResultSizeChars: 4000,
    isAvailable: () => true,
    run: async (input: CronjobToolInput) => {
      const action = input.action ?? "list";
      const id = input.job_id ?? input.jobId;

      if (action === "create") {
        if (input.prompt === undefined || input.schedule === undefined) {
          return { ok: false, content: "cronjob create requires prompt and schedule." };
        }
        const job = await options.store.create({
          prompt: input.prompt,
          schedule: input.schedule,
          name: input.name,
          skills: normalizeSkills(input),
          delivery: input.delivery ?? "local",
          repeat: input.repeat
        });
        return { ok: true, content: `Created cron job ${job.id}: ${job.name}\nNext run: ${job.nextRunAt ?? "none"}` };
      }

      if (action === "list") {
        return { ok: true, content: renderCronJobs(await options.store.list()) };
      }

      if (id === undefined) {
        return { ok: false, content: `cronjob ${action} requires job_id.` };
      }

      if (action === "update") {
        const job = await options.store.update(id, {
          prompt: input.prompt,
          schedule: input.schedule,
          name: input.name,
          skills: input.skills ?? (input.skill === undefined ? undefined : [input.skill]),
          delivery: input.delivery,
          repeat: input.repeat
        });
        return job === undefined
          ? { ok: false, content: `Cron job not found: ${id}` }
          : { ok: true, content: `Updated cron job ${job.id}: ${job.name}` };
      }

      if (action === "pause") return renderMaybeJob("Paused", await options.store.pause(id), id);
      if (action === "resume") return renderMaybeJob("Resumed", await options.store.resume(id), id);
      if (action === "run") return renderMaybeJob("Queued", await options.store.requestRun(id), id);
      if (action === "remove") {
        const removed = await options.store.remove(id);
        return removed
          ? { ok: true, content: `Removed cron job ${id}.` }
          : { ok: false, content: `Cron job not found: ${id}` };
      }

      return { ok: false, content: `Unknown cron action: ${action}` };
    }
  }];
}

export function renderCronJobs(jobs: Awaited<ReturnType<CronStore["list"]>>): string {
  if (jobs.length === 0) {
    return "No cron jobs configured.";
  }
  return [
    "Cron jobs",
    ...jobs.map((job) => [
      `${job.id} [${job.status}] ${job.name}`,
      `  schedule: ${job.schedule}`,
      `  next: ${job.nextRunAt ?? "none"}`,
      `  runs: ${job.runCount}`,
      job.skills.length === 0 ? undefined : `  skills: ${job.skills.join(", ")}`
    ].filter((line) => line !== undefined).join("\n"))
  ].join("\n");
}

function normalizeSkills(input: CronjobToolInput): string[] {
  return input.skills ?? (input.skill === undefined ? [] : [input.skill]);
}

function renderMaybeJob(prefix: string, job: Awaited<ReturnType<CronStore["get"]>>, id: string) {
  return job === undefined
    ? { ok: false, content: `Cron job not found: ${id}` }
    : { ok: true, content: `${prefix} cron job ${job.id}: ${job.name}` };
}
