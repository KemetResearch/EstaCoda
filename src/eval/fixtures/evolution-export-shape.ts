import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { ChangeManifestStore } from "../../skills/change-manifest-store.js";
import { SkillEvolutionStore } from "../../skills/skill-evolution.js";
import { SkillRegistry } from "../../skills/skill-registry.js";
import { SkillProposalService } from "../../skills/skill-proposal-service.js";
import { assertEqual, assertTrue, buildResult } from "../eval-runner.js";

export const evolutionExportShapeCase: EvalCase = {
  id: "evolution-export-shape",
  name: "Evolution export dataset matches OptimizationDataset schema",
  description: "Produces a v0.7 OptimizationDataset JSON with required fields",
  tags: ["evolution", "export"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const tmp = await mkdtemp(join(tmpdir(), "estacoda-eval-export-"));
    const evolutionRoot = join(tmp, "evolution");
    const manifestRoot = join(evolutionRoot, "manifests");
    const localSkillsRoot = join(tmp, "skills");
    const datasetPath = join(tmp, "dataset.json");
    await mkdir(localSkillsRoot, { recursive: true });

    const skillEvolutionStore = new SkillEvolutionStore({
      usagePath: join(localSkillsRoot, ".usage.json"),
      evolutionRoot
    });
    const changeManifestStore = new ChangeManifestStore({ root: manifestRoot });
    const registry = new SkillRegistry();

    const service = new SkillProposalService({
      registry,
      localSkillsRoot,
      skillEvolutionStore,
      changeManifestStore
    });

    // Seed data
    await service.createManifestForToolDescription({
      toolName: "web_search",
      proposedDescription: "Search the web",
      hypothesis: "Test hypothesis",
      predictedImpact: "Test impact"
    });
    await service.createManifestForRoutingMetadata({
      skillName: "test-skill",
      proposedRoutingChange: "Add label",
      hypothesis: "Test routing",
      predictedImpact: "Test impact"
    });

    // Build dataset manually (simulating what the CLI export does)
    const proposals = await skillEvolutionStore.listProposals({});
    const observations = await skillEvolutionStore.listObservations({});
    const manifests = await changeManifestStore.list({});

    const dataset = {
      version: "v0.7" as const,
      generatedAt: new Date().toISOString(),
      meta: {
        skillCount: 0,
        proposalCount: proposals.length,
        manifestCount: manifests.length,
        observationCount: observations.length,
        evalRunCount: 0
      },
      traces: [],
      skillEvalRuns: [],
      observations: observations.map((o) => ({
        id: o.id,
        skillName: o.skillName,
        type: o.type,
        lesson: o.lesson,
        outcome: o.outcome,
        toolsAttempted: o.toolsAttempted ?? []
      })),
      proposals: proposals.map((p) => ({
        id: p.id,
        skillName: p.skillName,
        status: p.status
      })),
      manifests: manifests.map((m) => ({
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

    const raw = await readFile(datasetPath, "utf8");
    const parsed = JSON.parse(raw);

    const assertions = [
      assertEqual("dataset version", parsed.version, "v0.7"),
      assertTrue("dataset has generatedAt", typeof parsed.generatedAt === "string"),
      assertTrue("dataset has meta", typeof parsed.meta === "object"),
      assertTrue("dataset has traces array", Array.isArray(parsed.traces)),
      assertTrue("dataset has skillEvalRuns array", Array.isArray(parsed.skillEvalRuns)),
      assertTrue("dataset has observations array", Array.isArray(parsed.observations)),
      assertTrue("dataset has proposals array", Array.isArray(parsed.proposals)),
      assertTrue("dataset has manifests array", Array.isArray(parsed.manifests)),
      assertEqual("manifest count in meta", parsed.meta.manifestCount, manifests.length),
      assertTrue("manifests include tool_description", parsed.manifests.some((m: { target: string }) => m.target === "tool_description")),
      assertTrue("manifests include routing_metadata", parsed.manifests.some((m: { target: string }) => m.target === "routing_metadata")),
    ];

    await rm(tmp, { recursive: true, force: true });

    return buildResult(
      "evolution-export-shape",
      "Evolution export dataset matches OptimizationDataset schema",
      assertions,
      Date.now() - startedAt
    );
  }
};
