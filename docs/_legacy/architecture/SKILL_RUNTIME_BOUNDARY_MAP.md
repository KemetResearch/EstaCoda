# Skill Runtime Boundary Map

## Purpose
Explicitly map skill metadata, instructions, resources, workflow planning, deterministic tools, provider-backed execution, telemetry, mutation behavior, and trust boundaries in the v0.3 codebase.

## Scope
All skill-related code: `src/skills/*`, `src/contracts/skill.ts`, `skills/official/*/`, and skill interactions in `src/runtime/agent-loop.ts`.

## Source Files Inspected
- `src/skills/skill-loader.ts`
- `src/skills/skill-registry.ts`
- `src/skills/skill-tools.ts`
- `src/skills/skill-evolution.ts`
- `src/skills/skill-learning.ts`
- `src/skills/skill-curator-status.ts`
- `src/skills/skill-bundled-sync.ts`
- `src/skills/skill-mutation-policy.ts`
- `src/skills/skill-workflow-planner.ts`
- `src/skills/skill-usage-telemetry.ts`
- `src/skills/skill-lifecycle.ts`
- `src/skills/skill-path-safety.ts`
- `src/skills/skill-visibility.ts`
- `src/contracts/skill.ts`
- `skills/official/*/SKILL.md`
- `src/runtime/agent-loop.ts` (skill-related sections)

## Skill Type Distinctions

### 1. Skill Metadata
- **What:** Name, description, routing patterns, toolsets, version, source kind, lifecycle state.
- **Where:** `SkillDefinition` type + parsed from `SKILL.md` frontmatter.
- **Owner:** `skill-loader.ts` + `skill-registry.ts`
- **Trust Boundary:** Metadata is parsed from markdown. Path safety enforced by `skill-path-safety.ts`.
- **Evidence:** `SkillDefinition` type, `parseSkillDefinition()` in `skill-loader.ts`.

### 2. Skill Instructions
- **What:** Markdown body of `SKILL.md` — the actual instructions given to the agent.
- **Where:** `SkillDefinition.instructions` (string)
- **Owner:** `skill-loader.ts`
- **Trust Boundary:** Instructions are loaded from filesystem. Size limited by `MAX_SKILL_MD_CHARS` (20,000). Byte guard by `MAX_SKILL_MD_BYTES` (128KB).
- **Evidence:** `skill-limits.ts` defines size guards. `skill-loader.ts` enforces them.

### 3. Skill Resources
- **What:** References, templates, scripts, assets attached to a skill.
- **Where:** `SkillResourceEntry[]` in `SkillDefinition`
- **Owner:** `skill-loader.ts`
- **Trust Boundary:** Resource paths validated by `skill-path-safety.ts`. Max 100 files, 128KB each, depth 6.
- **Evidence:** `SkillResourceKind`, `SkillResourceEntry` types.

### 4. Skill Workflow Planning
- **What:** Compile skill workflow steps into an executable plan.
- **Where:** `skill-workflow-planner.ts`
- **Owner:** Skill layer
- **Trust Boundary:** Plans are advisory by default (`workflowMode: advisory`). Not enforced by runtime.
- **Evidence:** `compileSkillWorkflowPlan()`, `SkillWorkflowPlan`, `SkillWorkflowStep`.

### 5. Deterministic Skill Tools
- **What:** Tools that skills can call deterministically (not via LLM).
- **Where:** `skill-tools.ts`
- **Owner:** Skill layer
- **Trust Boundary:** Tools go through `ToolExecutor` with risk checks.
- **Evidence:** `createSkillTools()` returns `SkillToolSet` with `skillLoad`, `skillList`, `skillObserve`, etc.

### 6. Provider-Backed Skill Execution
- **What:** Skills that require LLM provider execution (most skills).
- **Where:** AgentLoop handles provider calls for matched skills.
- **Owner:** Runtime (AgentLoop)
- **Trust Boundary:** Skills do not call providers directly. Runtime mediates all provider access.
- **Evidence:** AgentLoop injects skill instructions into prompt assembly.

### 7. Skill Usage Telemetry
- **What:** Route matches, selections, confidence scores, usage counts.
- **Where:** `skill-usage-telemetry.ts`
- **Owner:** Skill layer
- **Trust Boundary:** Telemetry is local-only. No external transmission.
- **Evidence:** `SkillRouteTelemetry`, `createSkillRouteTelemetry()`, `hashSkillRoutePrompt()`.

### 8. Skill Mutation / Proposal Behavior
- **What:** Propose, review, approve, reject, and promote skill patches.
- **Where:** `skill-evolution.ts` + `skill-curator-status.ts`
- **Owner:** Skill layer
- **Trust Boundary:** Bundled skills are synced but not mutated in-place. Local working copies used. External skills are read-only.
- **Evidence:** `SkillEvolutionStore`, `SkillPatchProposal`, `SkillPatchStatus`. `skill-mutation-policy.ts` defines mutation rules.

## Skill Trust Boundaries

### Bundled Skills
- **Location:** `skills/official/` in repo
- **Behavior:** Copied to `~/.estacoda/skills/` on startup. Origin tracked in `.bundled_manifest.json`.
- **Mutability:** Local working copy can be patched. Original bundled copy is preserved.
- **Trust Level:** High — shipped with product.

### Local Skills
- **Location:** `~/.estacoda/skills/`
- **Behavior:** Primary writable skill root.
- **Mutability:** Full mutation allowed.
- **Trust Level:** Medium — user-created or evolved.

### External Skills
- **Location:** External directories (read-only)
- **Behavior:** Loaded but not mutated. Patches create local copies that shadow external versions.
- **Mutability:** Read-only.
- **Trust Level:** Low — third-party. User should review before enabling.

## Skill Subsystem Coupling

- **AgentLoop → SkillRegistry:** Direct. AgentLoop uses registry to look up matched skills.
- **AgentLoop → SkillWorkflowPlanner:** Direct. AgentLoop compiles workflow plans.
- **AgentLoop → SkillTools:** Direct. AgentLoop makes skill tools available to provider.
- **AgentLoop → SkillLearningManager:** Direct. AgentLoop records skill outcomes.
- **AgentLoop → SkillEvolutionStore:** Direct. AgentLoop may trigger evolution.
- **SkillTools → ToolExecutor:** Direct. Skill tools delegate to tool executor.
- **SkillLoader → SkillRegistry:** Direct. Loader populates registry.
- **SkillEvolutionStore → SkillRegistry:** Direct. Evolution modifies registry entries.
- **SkillBundledSync → SkillLoader:** Direct. Sync uses loader to parse bundled skills.

## Evidence Status
- ✅ Skill source kinds (bundled/local/external) are clearly defined.
- ✅ Skill mutation policy exists.
- ✅ Bundled sync with manifest tracking exists.
- ✅ Size and path safety guards exist.
- ✅ Telemetry exists.
- ❌ No capability manifest (broader than skill manifest).
- ❌ No formal change manifest for evolution proposals.
- ❌ Skill evals are missing.

## Open Questions
1. Should external skills have a stricter sandbox than local skills?
2. How are skill resource scripts executed? (Are they sandboxed?)
3. What is the lifecycle of a rejected skill patch? (Is it archived?)
4. Should skill instructions be signed or have content hashes?

## Recommended Follow-Up Areas
- Build capability manifest schema for v0.10.
- Build formal change manifest for evolution proposals for v0.7.
- Add skill evals for v0.7.
- Clarify skill resource script sandboxing.
