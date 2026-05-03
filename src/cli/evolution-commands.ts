import { join } from "node:path";
import { homedir } from "node:os";
import { writeFile } from "node:fs/promises";
import type { CliCommandResult, CliOptions } from "./cli.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { loadSkillsFromDirectory } from "../skills/skill-loader.js";
import { SkillEvolutionStore } from "../skills/skill-evolution.js";
import { ChangeManifestStore } from "../skills/change-manifest-store.js";
import type { OptimizationDataset } from "../evolution/export-format.js";

function resolveHome(options: CliOptions): string {
  return options.homeDir ?? process.env.HOME ?? homedir();
}

async function openStores(options: CliOptions) {
  const home = resolveHome(options);
  const localSkillsRoot = join(home, ".estacoda", "skills");
  const registry = new SkillRegistry();
  const loaded = await loadSkillsFromDirectory(localSkillsRoot, {
    sourceKind: "local",
    sourceRoot: localSkillsRoot
  }).catch(() => ({ skills: [], errors: [] }));
  for (const skill of loaded.skills) {
    registry.register(skill);
  }
  const skillEvolutionStore = new SkillEvolutionStore({
    usagePath: join(localSkillsRoot, ".usage.json"),
    evolutionRoot: join(localSkillsRoot, ".evolution")
  });
  const changeManifestStore = new ChangeManifestStore({
    root: join(localSkillsRoot, ".evolution", "manifests")
  });
  return { registry, skillEvolutionStore, changeManifestStore };
}

export async function evolutionCommand(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const [subcommand, ...restArgs] = args;

  switch (subcommand) {
    case "export":
      return evolutionExport(options, restArgs);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return {
        handled: true,
        exitCode: 0,
        output: evolutionHelp()
      };
    default:
      return {
        handled: true,
        exitCode: 1,
        output: `Unknown evolution subcommand: ${subcommand}\n\n${evolutionHelp()}`
      };
  }
}

function evolutionHelp(): string {
  return [
    "EstaCoda evolution commands",
    "  estacoda evolution export --dataset <path>  Export optimization dataset as JSON",
    "  estacoda evolution export --dataset <path> --since <iso-date>",
    "  estacoda evolution export --dataset <path> --skill <name>"
  ].join("\n");
}

async function evolutionExport(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const datasetPath = valueAfter(args, "--dataset");
  const sinceRaw = valueAfter(args, "--since");
  const skillName = valueAfter(args, "--skill");

  if (datasetPath === undefined) {
    return {
      handled: true,
      exitCode: 1,
      output: "Usage: estacoda evolution export --dataset <path> [--since <iso-date>] [--skill <name>]"
    };
  }

  const since = sinceRaw !== undefined ? new Date(sinceRaw) : undefined;
  if (sinceRaw !== undefined && Number.isNaN(since?.getTime())) {
    return {
      handled: true,
      exitCode: 1,
      output: `Invalid --since date: ${sinceRaw}`
    };
  }

  const { skillEvolutionStore, changeManifestStore } = await openStores(options);

    const proposals = await skillEvolutionStore.listProposals({});
    const observations = await skillEvolutionStore.listObservations({});
    const evalRuns = await skillEvolutionStore.listEvalRuns();
    const manifests = await changeManifestStore.list({});

    const filteredProposals = skillName !== undefined
      ? proposals.filter((p) => p.skillName === skillName)
      : proposals;
    const filteredObservations = skillName !== undefined
      ? observations.filter((o) => o.skillName === skillName)
      : observations;
    const filteredManifests = skillName !== undefined
      ? manifests.filter((m) => m.filesChanged.some((f) => f.includes(skillName)))
      : manifests;

    const sinceTime = since?.getTime() ?? 0;

    const dataset: OptimizationDataset = {
      version: "v0.7",
      generatedAt: new Date().toISOString(),
      meta: {
        skillCount: new Set([
          ...filteredProposals.map((p) => p.skillName),
          ...filteredObservations.map((o) => o.skillName)
        ]).size,
        proposalCount: filteredProposals.length,
        manifestCount: filteredManifests.length,
        observationCount: filteredObservations.length,
        evalRunCount: evalRuns.length
      },
      traces: [], // Traces require SQLiteSessionDB access; deferred to future iteration
      skillEvalRuns: evalRuns.map((r: import("../skills/skill-evolution.js").SkillEvalRunRecord) => ({
        skillName: r.skillName,
        evalId: r.evalId,
        score: r.score,
        passed: r.passed,
        details: r.details ?? {}
      })),
      observations: filteredObservations
        .filter((o) => new Date(o.timestamp).getTime() >= sinceTime)
        .map((o) => ({
          id: o.id,
          skillName: o.skillName,
          type: o.type,
          lesson: o.lesson,
          outcome: o.outcome,
          toolsAttempted: o.toolsAttempted ?? []
        })),
      proposals: filteredProposals
        .filter((p) => new Date(p.createdAt).getTime() >= sinceTime)
        .map((p) => ({
          id: p.id,
          skillName: p.skillName,
          status: p.status
        })),
      manifests: filteredManifests
        .filter((m) => new Date(m.createdAt).getTime() >= sinceTime)
        .map((m) => ({
          id: m.id,
          target: m.target,
          status: m.status,
          hypothesis: m.hypothesis,
          predictedImpact: m.predictedImpact,
          riskLevel: m.riskLevel,
          filesChanged: m.filesChanged,
          evidenceTraces: m.evidence.traces,
          constraintGates: m.constraintGates,
          rollbackPlan: m.rollbackPlan,
          createdAt: m.createdAt
        }))
    };

  await writeFile(datasetPath, JSON.stringify(dataset, null, 2), "utf8");

  return {
    handled: true,
    exitCode: 0,
    output: [
      `Exported optimization dataset to ${datasetPath}`,
      `  Proposals: ${dataset.meta.proposalCount}`,
      `  Manifests: ${dataset.meta.manifestCount}`,
      `  Observations: ${dataset.meta.observationCount}`,
      `  Eval runs: ${dataset.meta.evalRunCount}`
    ].join("\n")
  };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}
