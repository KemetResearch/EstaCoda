import type { LoadedSkill, SkillDefinition } from "../contracts/skill.js";
import type { SkillEvolutionStore } from "./skill-evolution.js";

export type SkillMutationAction = "patch" | "edit" | "delete" | "write-file" | "remove-file" | "promote";

export async function assertSkillMutable(options: {
  skill: LoadedSkill | SkillDefinition;
  action: SkillMutationAction;
  store?: SkillEvolutionStore;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const usage = await options.store?.getUsage(options.skill.name);

  if (usage?.pinned === true) {
    return {
      ok: false,
      reason: `Skill ${options.skill.name} is pinned and cannot be changed by skill.${options.action}.`
    };
  }

  return { ok: true };
}

