import type { CompiledSkillPlaybook, CompiledSkillPlaybookStep } from "../contracts/skill.js";
import type { WorkflowPlan, WorkflowPlanStep } from "./types.js";

export function convertSkillPlaybookToWorkflowPlan(playbook: CompiledSkillPlaybook): WorkflowPlan {
  return {
    name: `${playbook.skill} playbook`,
    description: `Workflow plan converted from skill playbook: ${playbook.skill}`,
    metadata: {
      source: "skill-playbook",
      skill: playbook.skill,
      ...(playbook.warnings === undefined || playbook.warnings.length === 0 ? {} : { warnings: [...playbook.warnings] })
    },
    steps: playbook.steps.map(convertStep)
  };
}

function convertStep(step: CompiledSkillPlaybookStep): WorkflowPlanStep {
  return {
    name: step.id,
    description: step.description,
    requiresApproval: false,
    skippable: false,
    maxRetries: 0,
    idempotent: false,
    metadata: {
      sourceStepId: step.id,
      preferredToolsets: [...step.preferredToolsets],
      successCriteria: [...step.successCriteria]
    }
  };
}
