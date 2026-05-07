import { CronStore, type CronJob } from "./cron-store.js";
import type { CronExecutionStore } from "./cron-execution-store.js";
import { renderCronJobs } from "./cron-tools.js";
import { commandRegistry } from "../cli/command-registry.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import type { ViewModel } from "../contracts/view-model.js";
import {
  buildCronHelpViewModel,
  buildCronListViewModel,
  buildCronJobDetailViewModel,
  buildCronExecutionHistoryViewModel,
  buildCronActionViewModel,
  buildCronCreatedViewModel,
  buildCronNotFoundViewModel,
  buildCronUsageErrorViewModel,
  buildCronUnknownCommandViewModel,
} from "./cron-view-models.js";

export type CronRenderer = (viewModel: ViewModel) => string;

export async function runCronCommand(
  input: {
    args: string[];
    store: CronStore;
    executionStore?: CronExecutionStore;
    tick?: () => Promise<string>;
    origin?: CronJob["origin"];
    defaultDelivery?: string;
  },
  renderer: CronRenderer = renderPlain
): Promise<{ ok: boolean; output: string }> {
  const [command, ...rest] = input.args;
  const resolved = command !== undefined ? commandRegistry.resolveSubcommand("cron", command) : undefined;
  const canonical = resolved?.name ?? command;

  if (command === undefined || canonical === "help") {
    const cronCommands = commandRegistry.list({ scope: "both", parent: "cron" });
    const viewModel = buildCronHelpViewModel({ commands: cronCommands });
    return { ok: true, output: renderer(viewModel) };
  }

  if (canonical === "add") {
    const parsed = parseCronAddArgs(rest);
    if (parsed.schedule === undefined || parsed.prompt === undefined) {
      const viewModel = buildCronUsageErrorViewModel({
        message: "Usage: cron add <schedule> \"<prompt>\" [--name name] [--skill skill]\n   or: cron add --schedule <schedule> --command \"<prompt>\" [--name name] [--skill skill]",
      });
      return { ok: false, output: renderer(viewModel) };
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
    const viewModel = buildCronCreatedViewModel({ job });
    return { ok: true, output: renderer(viewModel) };
  }

  if (canonical === "list") {
    const jobs = await input.store.list();
    const viewModel = buildCronListViewModel({ jobs });
    return { ok: true, output: renderer(viewModel) };
  }

  if (canonical === "show") {
    const id = rest[0];
    if (id === undefined) {
      const viewModel = buildCronUsageErrorViewModel({ message: "Usage: cron show <job-id>" });
      return { ok: false, output: renderer(viewModel) };
    }
    const job = await input.store.get(id);
    if (job === undefined) {
      const viewModel = buildCronNotFoundViewModel({ id });
      return { ok: false, output: renderer(viewModel) };
    }
    const executions = input.executionStore !== undefined
      ? await input.executionStore.list({ jobId: id, limit: 5 })
      : [];
    const viewModel = buildCronJobDetailViewModel({ job, executions });
    return { ok: true, output: renderer(viewModel) };
  }

  if (canonical === "history") {
    const limit = parseHistoryLimit(rest);
    const jobId = rest.find((arg) => !arg.startsWith("--"));
    const executions = input.executionStore !== undefined
      ? await input.executionStore.list({ jobId, limit })
      : [];
    const viewModel = buildCronExecutionHistoryViewModel({ executions, jobId });
    return { ok: true, output: renderer(viewModel) };
  }

  if (canonical === "tick") {
    return { ok: true, output: input.tick === undefined ? "Cron tick requires a runtime." : await input.tick() };
  }

  const id = rest[0];
  if (id === undefined) {
    const viewModel = buildCronUsageErrorViewModel({ message: `Usage: cron ${command} <job-id>` });
    return { ok: false, output: renderer(viewModel) };
  }

  if (canonical === "edit") {
    const existing = await input.store.get(id);
    if (existing === undefined) {
      const viewModel = buildCronNotFoundViewModel({ id });
      return { ok: false, output: renderer(viewModel) };
    }
    const patch = parseCronEditArgs(rest.slice(1), existing.skills);
    const job = await input.store.update(id, patch);
    return job === undefined
      ? { ok: false, output: renderer(buildCronNotFoundViewModel({ id })) }
      : { ok: true, output: renderer(buildCronActionViewModel({ action: "Updated", job })) };
  }

  if (canonical === "pause") return renderMaybe("Paused", await input.store.pause(id), id, renderer);
  if (canonical === "resume") return renderMaybe("Resumed", await input.store.resume(id), id, renderer);
  if (canonical === "run") return renderMaybe("Queued", await input.store.requestRun(id), id, renderer);
  if (canonical === "remove") {
    const removed = await input.store.remove(id);
    return removed
      ? { ok: true, output: renderer(buildCronActionViewModel({ action: "Removed", job: { id, name: id } as CronJob })) }
      : { ok: false, output: renderer(buildCronNotFoundViewModel({ id })) };
  }

  const viewModel = buildCronUnknownCommandViewModel({ command: command ?? "" });
  return { ok: false, output: renderer(viewModel) };
}

function parseCronAddArgs(args: string[]): {
  schedule?: string;
  prompt?: string;
  name?: string;
  script?: string;
  scriptArgs?: string[];
  scriptTimeoutMs?: number;
  skills: string[];
  delivery?: string;
  repeat?: number;
} {
  const positional: string[] = [];
  const parsed: ReturnType<typeof parseCronAddArgs> = { skills: [], scriptArgs: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--name") {
      parsed.name = next;
      index += 1;
    } else if (arg === "--schedule") {
      parsed.schedule = next;
      index += 1;
    } else if (arg === "--command") {
      parsed.prompt = next;
      index += 1;
    } else if (arg === "--skill") {
      if (next !== undefined) parsed.skills.push(next);
      index += 1;
    } else if (arg === "--delivery") {
      parsed.delivery = next;
      index += 1;
    } else if (arg === "--script") {
      parsed.script = next;
      index += 1;
    } else if (arg === "--script-arg") {
      if (next !== undefined) parsed.scriptArgs?.push(next);
      index += 1;
    } else if (arg === "--script-timeout-ms") {
      parsed.scriptTimeoutMs = next === undefined ? undefined : Number(next);
      index += 1;
    } else if (arg === "--repeat") {
      parsed.repeat = next === undefined ? undefined : Number(next);
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  if (positional[0]?.toLowerCase() === "every" && positional[1] !== undefined) {
    parsed.schedule = parsed.schedule ?? `${positional[0]} ${positional[1]}`;
    parsed.prompt = parsed.prompt ?? (positional.slice(2).join(" ").trim() || undefined);
  } else {
    parsed.schedule = parsed.schedule ?? positional[0];
    parsed.prompt = parsed.prompt ?? (positional.slice(1).join(" ").trim() || undefined);
  }
  return parsed;
}

function parseCronEditArgs(args: string[], currentSkills: string[]): {
  schedule?: string;
  prompt?: string;
  name?: string;
  script?: string;
  scriptArgs?: string[];
  scriptTimeoutMs?: number;
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
    } else if (arg === "--script") {
      parsed.script = next;
      index += 1;
    } else if (arg === "--script-arg") {
      parsed.scriptArgs = [...(parsed.scriptArgs ?? []), next].filter((value): value is string => value !== undefined);
      index += 1;
    } else if (arg === "--clear-script-args") {
      parsed.scriptArgs = [];
    } else if (arg === "--script-timeout-ms") {
      parsed.scriptTimeoutMs = next === undefined ? undefined : Number(next);
      index += 1;
    } else if (arg === "--clear-script") {
      parsed.script = undefined;
      parsed.scriptArgs = [];
      parsed.scriptTimeoutMs = undefined;
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

function renderMaybe(
  prefix: string,
  job: CronJob | undefined,
  id: string,
  renderer: CronRenderer
): { ok: boolean; output: string } {
  return job === undefined
    ? { ok: false, output: renderer(buildCronNotFoundViewModel({ id })) }
    : { ok: true, output: renderer(buildCronActionViewModel({ action: prefix, job })) };
}

function parseHistoryLimit(args: string[]): number {
  const index = args.indexOf("--limit");
  if (index === -1 || args[index + 1] === undefined) return 20;
  const parsed = Number(args[index + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}
