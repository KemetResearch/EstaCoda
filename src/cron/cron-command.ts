import { CronStore, type CronJob } from "./cron-store.js";
import { renderCronJobs } from "./cron-tools.js";

export async function runCronCommand(input: {
  args: string[];
  store: CronStore;
  tick?: () => Promise<string>;
  origin?: CronJob["origin"];
  defaultDelivery?: string;
}): Promise<{ ok: boolean; output: string }> {
  const [command, ...rest] = input.args;

  if (command === undefined || command === "help") {
    return {
      ok: true,
      output: [
        "EstaCoda cron",
        "  cron add <schedule> \"<prompt>\" [--name name] [--skill skill] [--delivery local]",
        "  cron edit <job-id> [--schedule expr] [--prompt text] [--skill skill] [--add-skill skill] [--remove-skill skill] [--clear-skills]",
        "  cron list",
        "  cron pause <job-id>",
        "  cron resume <job-id>",
        "  cron run <job-id>",
        "  cron remove <job-id>",
        "  cron tick"
      ].join("\n")
    };
  }

  if (command === "add" || command === "create") {
    const parsed = parseCronAddArgs(rest);
    if (parsed.schedule === undefined || parsed.prompt === undefined) {
      return { ok: false, output: "Usage: cron add <schedule> \"<prompt>\" [--name name] [--skill skill]" };
    }
    if (parsed.delivery === undefined) {
      parsed.delivery = input.defaultDelivery;
    }
    const job = await input.store.create({
      ...parsed,
      schedule: parsed.schedule,
      prompt: parsed.prompt,
      origin: input.origin
    });
    return { ok: true, output: renderCreated(job) };
  }

  if (command === "list" || command === "status") {
    return { ok: true, output: renderCronJobs(await input.store.list()) };
  }

  if (command === "tick") {
    return { ok: true, output: input.tick === undefined ? "Cron tick requires a runtime." : await input.tick() };
  }

  const id = rest[0];
  if (id === undefined) {
    return { ok: false, output: `Usage: cron ${command} <job-id>` };
  }

  if (command === "edit" || command === "update") {
    const existing = await input.store.get(id);
    if (existing === undefined) {
      return { ok: false, output: `Cron job not found: ${id}` };
    }
    const patch = parseCronEditArgs(rest.slice(1), existing.skills);
    const job = await input.store.update(id, patch);
    return job === undefined
      ? { ok: false, output: `Cron job not found: ${id}` }
      : { ok: true, output: `Updated cron job ${job.id}: ${job.name}` };
  }

  if (command === "pause") return renderMaybe("Paused", await input.store.pause(id), id);
  if (command === "resume") return renderMaybe("Resumed", await input.store.resume(id), id);
  if (command === "run") return renderMaybe("Queued", await input.store.requestRun(id), id);
  if (command === "remove" || command === "delete") {
    const removed = await input.store.remove(id);
    return removed
      ? { ok: true, output: `Removed cron job ${id}.` }
      : { ok: false, output: `Cron job not found: ${id}` };
  }

  return { ok: false, output: `Unknown cron command: ${command}` };
}

function parseCronAddArgs(args: string[]): {
  schedule?: string;
  prompt?: string;
  name?: string;
  skills: string[];
  delivery?: string;
  repeat?: number;
} {
  const positional: string[] = [];
  const parsed: ReturnType<typeof parseCronAddArgs> = { skills: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--name") {
      parsed.name = next;
      index += 1;
    } else if (arg === "--skill") {
      if (next !== undefined) parsed.skills.push(next);
      index += 1;
    } else if (arg === "--delivery") {
      parsed.delivery = next;
      index += 1;
    } else if (arg === "--repeat") {
      parsed.repeat = next === undefined ? undefined : Number(next);
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  if (positional[0]?.toLowerCase() === "every" && positional[1] !== undefined) {
    parsed.schedule = `${positional[0]} ${positional[1]}`;
    parsed.prompt = positional.slice(2).join(" ").trim() || undefined;
  } else {
    parsed.schedule = positional[0];
    parsed.prompt = positional.slice(1).join(" ").trim() || undefined;
  }
  return parsed;
}

function parseCronEditArgs(args: string[], currentSkills: string[]): {
  schedule?: string;
  prompt?: string;
  name?: string;
  skills?: string[];
  delivery?: string;
  repeat?: number;
} {
  const parsed: ReturnType<typeof parseCronEditArgs> = {};
  let skills = [...currentSkills];
  let replaceSkills = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--schedule") {
      parsed.schedule = next;
      index += 1;
    } else if (arg === "--prompt") {
      parsed.prompt = next;
      index += 1;
    } else if (arg === "--name") {
      parsed.name = next;
      index += 1;
    } else if (arg === "--delivery") {
      parsed.delivery = next;
      index += 1;
    } else if (arg === "--repeat") {
      parsed.repeat = next === undefined ? undefined : Number(next);
      index += 1;
    } else if (arg === "--skill") {
      if (!replaceSkills) {
        skills = [];
        replaceSkills = true;
      }
      if (next !== undefined) skills.push(next);
      index += 1;
    } else if (arg === "--add-skill") {
      if (next !== undefined && !skills.includes(next)) skills.push(next);
      index += 1;
    } else if (arg === "--remove-skill") {
      if (next !== undefined) skills = skills.filter((skill) => skill !== next);
      index += 1;
    } else if (arg === "--clear-skills") {
      skills = [];
      replaceSkills = true;
    }
  }

  if (replaceSkills || skills.join("\0") !== currentSkills.join("\0")) {
    parsed.skills = skills;
  }

  return parsed;
}

function renderCreated(job: CronJob): string {
  return [
    `Created cron job ${job.id}: ${job.name}`,
    `Schedule: ${job.schedule}`,
    `Next run: ${job.nextRunAt ?? "none"}`,
    `Delivery: ${job.delivery}`
  ].join("\n");
}

function renderMaybe(prefix: string, job: CronJob | undefined, id: string): { ok: boolean; output: string } {
  return job === undefined
    ? { ok: false, output: `Cron job not found: ${id}` }
    : { ok: true, output: `${prefix} cron job ${job.id}: ${job.name}` };
}
