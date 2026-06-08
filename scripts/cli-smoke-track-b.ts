import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliCommand } from "../src/cli/cli.js";
import { SkillRegistry } from "../src/skills/skill-registry.js";
import { loadSkillsFromDirectory } from "../src/skills/skill-loader.js";
import { SkillEvolutionStore } from "../src/skills/skill-evolution.js";
import { ChangeManifestStore } from "../src/skills/change-manifest-store.js";
import { SkillProposalService } from "../src/skills/skill-proposal-service.js";
import { defaultProfileId, resolveProfileStateHome } from "../src/config/profile-home.js";

const tmp = mkdtempSync(join(tmpdir(), "estacoda-cli-smoke-"));
const profilePaths = resolveProfileStateHome({ homeDir: tmp, profileId: defaultProfileId() });
const localSkillsRoot = profilePaths.skillsPath;
const skillDir = join(localSkillsRoot, "test-skill");
mkdirSync(skillDir, { recursive: true });

writeFileSync(
  join(skillDir, "SKILL.md"),
  `---
{"name":"test-skill","version":"1.0.0","description":"CLI smoke skill","category":"test","requiredToolsets":["core"],"playbook":[{"id":"step1","description":"Do nothing"}],"evaluations":[]}
---
# Test Skill
No instructions.
`,
  "utf8"
);

const registry = new SkillRegistry();
const loaded = await loadSkillsFromDirectory(localSkillsRoot, {
  sourceKind: "local",
  sourceRoot: localSkillsRoot
});
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

const service = new SkillProposalService({
  registry,
  localSkillsRoot,
  skillEvolutionStore,
  changeManifestStore
});

async function run(argv: string[]): Promise<{ exitCode: number; output: string }> {
  const result = await runCliCommand({
    argv,
    workspaceRoot: tmp,
    homeDir: tmp
  });
  return { exitCode: result.exitCode, output: result.output };
}

const results: string[] = [];
let allPassed = true;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    results.push(`[PASS] ${name}`);
  } else {
    results.push(`[FAIL] ${name}${detail ? " - " + detail : ""}`);
    allPassed = false;
  }
}

// Seed data using the service directly
const observation = await skillEvolutionStore.appendObservation({
  skillName: "test-skill",
  type: "note",
  lesson: "Test observation",
  candidateImprovement: "Add more detail"
});

await service.createManifestFromObservation({
  skillName: "test-skill",
  lesson: "Test observation",
  candidateImprovement: "Add more detail",
  observationId: observation.id
});

const proposalPatch = await skillEvolutionStore.proposePatch({
  skillName: "test-skill",
  reason: "Test proposal",
  patch: { type: "text_patch", oldString: "No instructions.", newString: "Some instructions.", replaceAll: false }
});

await service.createManifestFromProposal({
  skillName: "test-skill",
  reason: "Test proposal",
  patch: { type: "text_patch", oldString: "No instructions.", newString: "Some instructions.", replaceAll: false }
});

// CLI: curator status
const curator = await run(["curator", "status"]);
assert("curator status returns 0", curator.exitCode === 0, curator.output);
assert("curator status shows proposals", curator.output.includes("Proposals:"), curator.output);
assert("curator status shows manifests", curator.output.includes("Manifests:"), curator.output);

// CLI: proposal list
const proposalList = await run(["proposal", "list"]);
assert("proposal list returns 0", proposalList.exitCode === 0, proposalList.output);
assert("proposal list shows test-skill", proposalList.output.includes("test-skill"), proposalList.output);

// CLI: proposal list with status filter
const proposedList = await run(["proposal", "list", "--status", "proposed"]);
assert("proposal list --status proposed returns 0", proposedList.exitCode === 0, proposedList.output);

// CLI: proposal inspect
const inspect = await run(["proposal", "inspect", proposalPatch.id]);
assert("proposal inspect returns 0", inspect.exitCode === 0, inspect.output);
assert("proposal inspect includes review", inspect.output.includes("review"), inspect.output);

// CLI: proposal approve
const approve = await run(["proposal", "approve", proposalPatch.id]);
assert("proposal approve returns 0", approve.exitCode === 0, approve.output);

const afterApprove = await skillEvolutionStore.findProposal(proposalPatch.id);
assert("proposal has approvedAt after approve", afterApprove?.approvedAt !== undefined);

// CLI: manifest list
const manifestList = await run(["manifest", "list"]);
assert("manifest list returns 0", manifestList.exitCode === 0, manifestList.output);

// CLI: manifest list with status filter
const manifestListProposed = await run(["manifest", "list", "--status", "proposed"]);
assert("manifest list --status proposed returns 0", manifestListProposed.exitCode === 0, manifestListProposed.output);

// CLI: manifest inspect
const manifests = await changeManifestStore.list();
const manifestId = manifests[0]?.id ?? "";
assert("manifest exists in store", manifestId.length > 0);

const manifestInspect = await run(["manifest", "inspect", manifestId]);
assert("manifest inspect returns 0", manifestInspect.exitCode === 0, manifestInspect.output);
assert("manifest inspect shows target", manifestInspect.output.includes("\"target\""), manifestInspect.output);

// CLI: proposal promote (low-risk text patch should pass eval gate)
const promote = await run(["proposal", "promote", proposalPatch.id]);
assert("proposal promote returns 0", promote.exitCode === 0, promote.output);

const afterPromote = await skillEvolutionStore.findProposal(proposalPatch.id);
assert("proposal status is promoted after promote", afterPromote?.status === "promoted");

// CLI: proposal reject (create a new one to reject)
const proposal2 = await skillEvolutionStore.proposePatch({
  skillName: "test-skill",
  reason: "Test reject",
  patch: { type: "text_patch", oldString: "Some instructions.", newString: "Rejected instructions.", replaceAll: false }
});

const reject = await run(["proposal", "reject", proposal2.id]);
assert("proposal reject returns 0", reject.exitCode === 0, reject.output);

const afterReject = await skillEvolutionStore.findProposal(proposal2.id);
assert("proposal status is rejected after reject", afterReject?.status === "rejected");

// Manifest sync is tested in eval fixtures; here we just verify manifests exist
const manifestsAfterPromote = await changeManifestStore.list();
assert("manifests exist after operations", manifestsAfterPromote.length > 0);

// CLI: help commands
const proposalHelp = await run(["proposal", "help"]);
assert("proposal help returns 0", proposalHelp.exitCode === 0, proposalHelp.output);

const manifestHelp = await run(["manifest", "help"]);
assert("manifest help returns 0", manifestHelp.exitCode === 0, manifestHelp.output);

const curatorHelp = await run(["curator", "help"]);
assert("curator help returns 0", curatorHelp.exitCode === 0, curatorHelp.output);

// Cleanup
rmSync(tmp, { recursive: true, force: true });

results.push("");
results.push(allPassed ? "All CLI smoke tests passed." : `${results.filter((r) => r.startsWith("[FAIL]")).length} CLI smoke test(s) failed.`);
console.log(results.join("\n"));
process.exit(allPassed ? 0 : 1);
