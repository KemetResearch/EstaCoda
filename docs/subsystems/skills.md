---
title: "Skills"
description: "Skill system: loading, registry, execution, evolution, and learning."
---

# Skills

The skill system is the most mature subsystem in EstaCoda. It provides procedural knowledge to the agent through Markdown-first documents that are progressively disclosed.

## Files

| File | Lines | Role |
|------|-------|------|
| `src/skills/skill-loader.ts` | 916 | Load skills from official, personal, project, and external roots |
| `src/skills/skill-registry.ts` | ~180 | Hold loaded skills, filter visibility |
| `src/skills/skill-tools.ts` | 2,292 | Agent-facing skill CRUD tools |
| `src/skills/skill-evolution.ts` | ~290 | Propose, review, approve, reject, promote patches |
| `src/skills/skill-learning.ts` | ~240 | Observe workflows and create project skills |
| `src/skills/skill-workflow-planner.ts` | ~140 | Compile skill workflow plans |
| `src/skills/skill-usage-telemetry.ts` | ~120 | Usage tracking and route telemetry |
| `src/skills/skill-bundled-sync.ts` | ~100 | Sync bundled official skills |
| `src/skills/skill-visibility.ts` | ~80 | Runtime visibility filtering |
| `src/skills/skill-mutation-policy.ts` | ~160 | Promotion gates and trust checks |
| `src/skills/skill-curator-status.ts` | ~100 | Curator status and proposal listing |

## Skill Sources

| Source | Directory | Mutability | Evidence |
|--------|-----------|------------|----------|
| `official` | Bundled in repo | Read-only (local working copies for evolution) | `smoke-tested` |
| `personal` | `~/.estacoda/skills/` | Mutable | `smoke-tested` |
| `project` | `<workspace>/.estacoda/skills/` | Mutable | `smoke-tested` |
| `external` | Configured `externalSkillRoots` | Read-only | `smoke-tested` |

## Execution Model

**Provider-backed:** By default, skill instructions are injected into the system prompt and the provider executes the workflow. `implemented but not live-proven`

**Deterministic fallback:** If no provider is available, a deterministic path executes the workflow steps directly. `smoke-tested`

**Resources:** `references/`, `templates/`, `scripts/`, and compatible `assets/` are indexed and loaded on demand. `smoke-tested`

## Visibility

- Visibility is **session-stable**. Once a session starts, the visible skill catalog does not change.
- Filtered by runtime conditions (provider capability, trust level, etc.).
- Refreshed on `/reset` or new session.

## Operations

The agent can perform these operations via `skill-tools.ts`:

| Operation | Evidence |
|-----------|----------|
| `list` | `smoke-tested` |
| `view` | `smoke-tested` |
| `inspect` | `smoke-tested` |
| `create` | `smoke-tested` |
| `patch` | `smoke-tested` |
| `edit` | `smoke-tested` |
| `delete` | `smoke-tested` |
| `write_file` | `smoke-tested` |
| `remove_file` | `smoke-tested` |
| `import` | `smoke-tested` |
| `export` | `smoke-tested` |

## Evolution

Skill evolution allows the system to improve skills based on usage and failure evidence.

**Current capabilities:**

| Capability | Status |
|------------|--------|
| Usage telemetry (`skill-usage-telemetry.ts`) | `smoke-tested` |
| Propose patches (`skill-evolution.ts`) | `smoke-tested` |
| Review proposals | `smoke-tested` |
| Approve/reject/promote | `smoke-tested` |
| Promotion gates (untrusted-source blocking) | `smoke-tested` |
| Eval deltas in promotion records | `smoke-tested` |
| Rollback tool | `smoke-tested` |

**Limitations:**

- Skill evals are metadata/workflow-scoring only. No real task fixture execution yet.
- Tool-description improvement proposals are not supported.
- Routing-metadata improvement proposals are not supported.
- Autonomous workflow learning creates new project skills but does not intelligently patch existing ones.

## Learning

`SkillLearningManager` observes workflow execution and creates project skills when `skills.autonomy` is enabled.

| Mode | Behavior |
|------|----------|
| `none` | No workflow learning |
| `suggest` | Records candidates after repeated success; does not write files |
| `proactive` | Auto-creates project skills after repeated successful bounded local workflows |
| `autonomous` | Auto-creates after first successful bounded local workflow |

## Contracts

Key types in `src/contracts/skill.ts`:

- `SkillDefinition`
- `LoadedSkill`
- `SkillCatalogEntry`
- `SkillWorkflowPlan`
- `SkillWorkflowPlanStep`
- `SkillOutcome`
