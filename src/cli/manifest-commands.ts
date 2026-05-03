import { join } from "node:path";
import { homedir } from "node:os";
import type { CliCommandResult, CliOptions } from "./cli.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { loadSkillsFromDirectory } from "../skills/skill-loader.js";
import { SkillEvolutionStore } from "../skills/skill-evolution.js";
import { ChangeManifestStore } from "../skills/change-manifest-store.js";
import { SkillProposalService } from "../skills/skill-proposal-service.js";

function resolveHome(options: CliOptions): string {
  return options.homeDir ?? process.env.HOME ?? homedir();
}

async function openManifestService(options: CliOptions): Promise<SkillProposalService> {
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
  return new SkillProposalService({
    registry,
    localSkillsRoot,
    skillEvolutionStore,
    changeManifestStore
  });
}

export async function manifestCommand(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const [subcommand, ...restArgs] = args;

  const service = await openManifestService(options);

  switch (subcommand) {
    case "list":
      return manifestList(service, restArgs);
    case "inspect":
      return manifestInspect(service, restArgs);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return {
        handled: true,
        exitCode: 0,
        output: manifestHelp()
      };
    default:
      return {
        handled: true,
        exitCode: 1,
        output: `Unknown manifest subcommand: ${subcommand}\n\n${manifestHelp()}`
      };
  }
}

function manifestHelp(): string {
  return [
    "EstaCoda manifest commands",
    "  estacoda manifest list                 List all evolution change manifests",
    "  estacoda manifest list --status <s>    Filter by status",
    "  estacoda manifest inspect <id>         Show manifest details"
  ].join("\n");
}

async function manifestList(service: SkillProposalService, args: string[]): Promise<CliCommandResult> {
  const status = valueAfter(args, "--status");
  const manifests = await service.listManifests(status === undefined ? undefined : { status: status as import("../contracts/evolution.js").EvolutionChangeManifest["status"] });

  if (manifests.length === 0) {
    return {
      handled: true,
      exitCode: 0,
      output: "No manifests found."
    };
  }

  const lines = manifests.map((m) => {
    return `${m.id}  ${m.status.padEnd(10)}  ${m.target.padEnd(12)}  ${m.riskLevel}`;
  });

  return {
    handled: true,
    exitCode: 0,
    output: ["id                        status      target       risk", ...lines].join("\n")
  };
}

async function manifestInspect(service: SkillProposalService, args: string[]): Promise<CliCommandResult> {
  const id = args[0];
  if (id === undefined) {
    return {
      handled: true,
      exitCode: 1,
      output: "Usage: estacoda manifest inspect <manifest-id>"
    };
  }

  const manifest = await service.findManifest(id);
  if (manifest === undefined) {
    return {
      handled: true,
      exitCode: 1,
      output: `Manifest not found: ${id}`
    };
  }

  return {
    handled: true,
    exitCode: 0,
    output: JSON.stringify(manifest, null, 2)
  };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}
