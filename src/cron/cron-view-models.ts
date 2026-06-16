// v0.95 Cron ViewModel Builders
// Pure factory functions. No formatting, ANSI, terminal-width, or rendering logic.

import type { CronJob } from "./cron-store.js";
import type { CronExecutionRecord } from "./cron-execution-store.js";
import type { ViewModel } from "../contracts/view-model.js";
import {
  buildCommandResultViewModel,
  buildKeyValueBlockViewModel,
  buildListViewModel,
  buildWarningErrorViewModel,
  buildPlainFallbackViewModel,
  kv,
  listItem,
} from "../ui/view-models/builders.js";

// ─────────────────────────────────────────────────────────────
// Cron Help
// ─────────────────────────────────────────────────────────────

export interface CronHelpData {
  readonly commands: readonly { readonly name: string; readonly description: string }[];
}

export function buildCronHelpViewModel(data: CronHelpData): ViewModel {
  const maxWidth = Math.max(...data.commands.map((c) => c.name.length), 6);
  return buildCommandResultViewModel({
    ok: true,
    title: "EstaCoda cron",
    blocks: [
      buildListViewModel({
        items: data.commands.map((cmd) =>
          listItem(`cron ${cmd.name.padEnd(maxWidth)}  ${cmd.description}`)
        ),
      }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────
// Cron List
// ─────────────────────────────────────────────────────────────

export interface CronListData {
  readonly jobs: readonly CronJob[];
}

export function buildCronListViewModel(data: CronListData): ViewModel {
  if (data.jobs.length === 0) {
    return buildCommandResultViewModel({
      ok: true,
      title: "Cron jobs",
      blocks: [
        buildPlainFallbackViewModel({ lines: ["No cron jobs configured."] }),
      ],
    });
  }

  return buildCommandResultViewModel({
    ok: true,
    title: "Cron jobs",
    blocks: data.jobs.map((job) =>
      buildKeyValueBlockViewModel({
        title: `${job.id} [${job.status}] ${job.name}`,
        entries: [
          kv("schedule", job.schedule),
          kv("next", job.nextRunAt ?? "none"),
          ...(job.noAgent === true ? [kv("mode", "no-agent")] : []),
          ...(job.script !== undefined ? [kv("script", job.script)] : []),
          kv("runs", job.runCount),
          ...(job.skills.length > 0 ? [kv("skills", job.skills.join(", "))] : []),
          ...((job.contextFrom?.length ?? 0) > 0 ? [kv("contextFrom", job.contextFrom!.join(", "))] : []),
        ],
      })
    ),
  });
}

// ─────────────────────────────────────────────────────────────
// Cron Job Detail (show)
// ─────────────────────────────────────────────────────────────

export interface CronJobDetailData {
  readonly job: CronJob;
  readonly executions: readonly CronExecutionRecord[];
}

export function buildCronJobDetailViewModel(data: CronJobDetailData): ViewModel {
  const job = data.job;
  const executions = data.executions;

  const jobBlock = buildKeyValueBlockViewModel({
    title: `Cron job: ${job.id}`,
    entries: [
      kv("Name", job.name),
      kv("Status", job.status),
      kv("Schedule", job.schedule),
      kv("Next run", job.nextRunAt ?? "none"),
      kv("Last run", job.lastRunAt ?? "never"),
      kv("Runs", job.runCount),
      ...(job.script !== undefined ? [kv("Script", job.script)] : []),
      ...(job.noAgent === true ? [kv("Mode", "no-agent")] : []),
      kv("Delivery", job.delivery),
      ...(job.skills.length > 0 ? [kv("Skills", job.skills.join(", "))] : []),
      ...((job.contextFrom?.length ?? 0) > 0 ? [kv("Context from", job.contextFrom!.join(", "))] : []),
    ],
  });

  const executionItems = executions.map((ex) => {
    const duration = ex.completedAt !== undefined
      ? ` (${Math.round((new Date(ex.completedAt).getTime() - new Date(ex.startedAt).getTime()) / 1000)}s)`
      : "";
    let label = `${ex.id} [${ex.status}] ${ex.startedAt}${duration}`;
    const details: string[] = [];
    if (ex.failureClass !== undefined) {
      details.push(`failure: ${ex.failureClass} — ${ex.failureMessage ?? ""}`);
    }
    if (ex.deliveryResults.size > 0) {
      const targets = Array.from(ex.deliveryResults.entries())
        .map(([target, result]) => `${target}:${result.success ? "ok" : "fail"}`)
        .join(", ");
      details.push(`delivery: ${targets}`);
    }
    if (details.length > 0) {
      label += `\n  ${details.join("\n  ")}`;
    }
    return listItem(label);
  });

  const executionBlock = buildListViewModel({
    title: `Recent executions (${executions.length} shown)`,
    items: executionItems.length > 0 ? executionItems : [listItem("No execution history recorded.")],
  });

  return buildCommandResultViewModel({
    ok: true,
    title: "Cron job detail",
    blocks: [jobBlock, executionBlock],
  });
}

// ─────────────────────────────────────────────────────────────
// Cron Execution History
// ─────────────────────────────────────────────────────────────

export interface CronExecutionHistoryData {
  readonly executions: readonly CronExecutionRecord[];
  readonly jobId?: string;
}

export function buildCronExecutionHistoryViewModel(data: CronExecutionHistoryData): ViewModel {
  if (data.executions.length === 0) {
    return buildCommandResultViewModel({
      ok: true,
      title: data.jobId === undefined ? "Cron execution history" : `Execution history for ${data.jobId}`,
      blocks: [
        buildPlainFallbackViewModel({
          lines: [
            data.jobId === undefined
              ? "No cron execution history."
              : `No execution history for job ${data.jobId}.`,
          ],
        }),
      ],
    });
  }

  const items = data.executions.map((ex) => {
    const duration = ex.completedAt !== undefined
      ? ` (${Math.round((new Date(ex.completedAt).getTime() - new Date(ex.startedAt).getTime()) / 1000)}s)`
      : "";
    let label = `${ex.id} [${ex.status}] ${ex.startedAt}${duration}`;
    const details: string[] = [];
    if (ex.failureClass !== undefined) {
      details.push(`failure: ${ex.failureClass} — ${ex.failureMessage ?? ""}`);
    }
    if (ex.deliveryResults.size > 0) {
      const targets = Array.from(ex.deliveryResults.entries())
        .map(([target, result]) => `${target}:${result.success ? "ok" : "fail"}`)
        .join(", ");
      details.push(`delivery: ${targets}`);
    }
    if (details.length > 0) {
      label += `\n  ${details.join("\n  ")}`;
    }
    return listItem(label);
  });

  return buildCommandResultViewModel({
    ok: true,
    title: data.jobId === undefined ? "Cron execution history" : `Execution history for ${data.jobId}`,
    blocks: [buildListViewModel({ items })],
  });
}

// ─────────────────────────────────────────────────────────────
// Cron Action (pause / resume / run / remove / created)
// ─────────────────────────────────────────────────────────────

export interface CronActionData {
  readonly action: string;
  readonly job: CronJob;
}

export function buildCronActionViewModel(data: CronActionData): ViewModel {
  return buildCommandResultViewModel({
    ok: true,
    title: `${data.action} cron job`,
    blocks: [
      buildPlainFallbackViewModel({
        lines: [`${data.action} cron job ${data.job.id}: ${data.job.name}`],
      }),
    ],
  });
}

export interface CronCreatedData {
  readonly job: CronJob;
}

export function buildCronCreatedViewModel(data: CronCreatedData): ViewModel {
  const job = data.job;
  return buildCommandResultViewModel({
    ok: true,
    title: "Created cron job",
    blocks: [
      buildKeyValueBlockViewModel({
        entries: [
          kv("ID", job.id),
          kv("Name", job.name),
          kv("Schedule", job.schedule),
          kv("Next run", job.nextRunAt ?? "none"),
          ...(job.noAgent === true ? [kv("Mode", "no-agent")] : []),
          ...(job.script !== undefined ? [kv("Script", job.script)] : []),
          ...((job.contextFrom?.length ?? 0) > 0 ? [kv("Context from", job.contextFrom!.join(", "))] : []),
          kv("Delivery", job.delivery),
        ],
      }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────
// Cron Not Found / Error
// ─────────────────────────────────────────────────────────────

export interface CronNotFoundData {
  readonly id: string;
}

export function buildCronNotFoundViewModel(data: CronNotFoundData): ViewModel {
  return buildCommandResultViewModel({
    ok: false,
    title: "Cron job not found",
    blocks: [
      buildWarningErrorViewModel({
        severity: "error",
        title: "Not found",
        message: `Cron job not found: ${data.id}`,
      }),
    ],
  });
}

export interface CronUsageErrorData {
  readonly message: string;
}

export function buildCronUsageErrorViewModel(data: CronUsageErrorData): ViewModel {
  return buildCommandResultViewModel({
    ok: false,
    title: "Usage error",
    blocks: [
      buildWarningErrorViewModel({
        severity: "warn",
        title: "Usage",
        message: data.message,
      }),
    ],
  });
}

export interface CronUnknownCommandData {
  readonly command: string;
}

export function buildCronUnknownCommandViewModel(data: CronUnknownCommandData): ViewModel {
  return buildCommandResultViewModel({
    ok: false,
    title: "Unknown command",
    blocks: [
      buildWarningErrorViewModel({
        severity: "error",
        title: "Unknown",
        message: `Unknown cron command: ${data.command}`,
      }),
    ],
  });
}
