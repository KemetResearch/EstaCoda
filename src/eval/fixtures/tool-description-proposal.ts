import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { ChangeManifestStore } from "../../skills/change-manifest-store.js";
import { SkillEvolutionStore } from "../../skills/skill-evolution.js";
import { SkillRegistry } from "../../skills/skill-registry.js";
import { SkillProposalService } from "../../skills/skill-proposal-service.js";
import { assertEqual, assertTrue, buildResult } from "../eval-runner.js";

export const toolDescriptionProposalCase: EvalCase = {
  id: "tool-description-proposal",
  name: "Tool description proposal manifest can be created and inspected",
  description: "SkillProposalService.createManifestForToolDescription stores a manifest with target tool_description",
  tags: ["tools", "evolution", "manifest"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const tmp = await mkdtemp(join(tmpdir(), "estacoda-eval-tool-desc-"));
    const evolutionRoot = join(tmp, "evolution");
    const manifestRoot = join(evolutionRoot, "manifests");
    const localSkillsRoot = join(tmp, "skills");
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

    const result = await service.createManifestForToolDescription({
      toolName: "web_search",
      proposedDescription: "Search the web for current information",
      hypothesis: "Current description is too vague; specify 'current information'",
      predictedImpact: "Improved tool-call accuracy for time-sensitive queries",
      evidenceTraceIds: ["trace_abc123"]
    });

    const manifests = await changeManifestStore.list({ target: "tool_description" });
    const manifest = manifests[0];

    const assertions = [
      assertTrue("manifest created", result !== undefined),
      assertEqual("manifest target is tool_description", manifest?.target, "tool_description"),
      assertEqual("manifest hypothesis", manifest?.hypothesis, "Current description is too vague; specify 'current information'"),
      assertEqual("manifest predictedImpact", manifest?.predictedImpact, "Improved tool-call accuracy for time-sensitive queries"),
      assertEqual("manifest riskLevel", manifest?.riskLevel, "low"),
      assertTrue("manifest has evidence trace", manifest?.evidence?.traces?.includes("trace_abc123") ?? false),
      assertTrue("manifest has rollbackPlan", manifest?.rollbackPlan?.includes("Revert") ?? false),
      assertEqual("manifest status", manifest?.status, "proposed")
    ];

    return buildResult(
      "tool-description-proposal",
      "Tool description proposal manifest can be created and inspected",
      assertions,
      Date.now() - startedAt
    );
  }
};
