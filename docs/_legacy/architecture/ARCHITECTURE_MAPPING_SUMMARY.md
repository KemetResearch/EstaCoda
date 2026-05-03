# Architecture Mapping Summary

## Task
Ingest the full EstaCoda repo and map the architecture as it stands post-v0.3.

## Date
2026-05-02

## Files Created or Modified

1. `docs/architecture/CURRENT_DEPENDENCY_GRAPH.md` (133 lines)
2. `docs/architecture/dependency-graph.mmd` (188 lines)
3. `docs/architecture/CURRENT_RUNTIME_KNOWLEDGE_GRAPH.md` (155 lines)
4. `docs/architecture/runtime-knowledge-graph.mmd` (182 lines)
5. `docs/architecture/CURRENT_ARCHITECTURE_MAP.md` (257 lines)
6. `docs/architecture/ARCHITECTURE_RISK_REGISTER.md` (186 lines)
7. `docs/architecture/CODEBASE_AUDIT_POST_V0.3.md` (206 lines)
8. `docs/architecture/ROADMAP_ALIGNMENT_NOTES.md` (186 lines)
9. `docs/architecture/MEMORY_BOUNDARY_MAP.md` (158 lines)
10. `docs/architecture/SKILL_RUNTIME_BOUNDARY_MAP.md` (137 lines)
11. `docs/architecture/PROVIDER_TOOL_LOOP_BOUNDARY_MAP.md` (160 lines)
12. `docs/architecture/OBSERVABILITY_AND_EVAL_BOUNDARY_MAP.md` (159 lines)

**Total:** 12 new files, 2,107 lines of documentation. No existing files were modified.

## Validation Results

### Typecheck
- Command: `bun run typecheck` (which runs `tsc --noEmit`)
- Result: **PASS** — 0 errors, 0 warnings
- Note: Required `bun install` to install `@types/node` and `typescript` first (node_modules was not populated in the fresh clone).

### Smoke Test
- Command: `bun run smoke` (which runs `bun src/smoke.ts`)
- Result: **PASS** — "v2 smoke passed"

## Major Architecture Findings

### 1. AgentLoop is a Critical Monolith
- `src/runtime/agent-loop.ts` is 2,714 lines with 25+ async methods
- Handles intent routing, security, skill workflows, provider loops, tool execution, memory promotion, trajectory recording, artifacts, and prompt assembly
- **This is the primary v0.4 decomposition target**

### 2. create-runtime.ts is a God Factory
- 830 lines, 63 imports
- Manually constructs 30+ subsystem objects
- Any constructor signature change breaks the entire runtime

### 3. Trajectory and Artifacts are Underdeveloped
- `src/trajectory/trajectory-recorder.ts` is only 97 lines — no persistence
- `src/artifacts/artifact-store.ts` is only 56 lines — no persistence
- **These are primary v0.5 targets**

### 4. smoke.ts is a Test Monolith
- 13,969 lines, 89 imports
- All smoke tests in one file
- No formal test framework in package.json

### 5. Skill System is Well-Developed
- 14 files, 5,606 lines
- Loading, registry, evolution, learning, bundled sync, mutation policy all exist
- Strong foundation for v0.7

### 6. Clean Contract Layer
- 17 contract files, 1,777 lines
- Pure types, no runtime logic
- Most-imported layer (44 imports for tool.ts alone)

### 7. Minimal Circular Dependencies
- Only 3 bidirectional pairs:
  - config/runtime-config.ts <-> contracts/image-generation.ts
  - contracts/intent.ts <-> contracts/skill.ts
  - channels/channel-gateway.ts <-> channels/channel-session-store.ts

### 8. Security Surface is Strong
- Policy factory, command safety, workspace trust, approval controller all exist
- Good separation of concerns

### 9. Missing Components for Roadmap
- No trace schema (v0.5)
- No change manifest spec (v0.7)
- No eval runner in src/ (v0.5)
- No knowledge graph (v0.6)
- No TaskFlow (v0.8)
- No capability manifest (v0.10) — only 42-line stub

### 10. Documentation Conflicts
- `AGENTS.md` project structure map lists `src/gateway/` and `src/intent/` directories that do not exist
- `AGENTS.md` lists `tests/` directory that does not exist

## Files Intentionally Not Inspected

- `docs/ROADMAP.md` — explicitly ignored per instructions
- `node_modules/` — not source code
- `.git/` — not relevant to architecture
- Binary/assets files — not relevant
- `memory/default/` contents — runtime data, not architecture

## Assumptions Made

1. Import analysis treats all `from "..."` statements equally — does not distinguish `import type` from runtime imports.
2. File size is used as a proxy for complexity — large files are flagged as risks.
3. Bidirectional imports are detected by simple string matching — may miss indirect cycles through intermediaries.
4. "Live-proven" behavior is inferred from code structure and smoke.ts coverage, not runtime observation.
5. The `smoke.ts` output "v2 smoke passed" is taken at face value — no deeper test analysis was performed.

## Explicit Confirmation

- **No code was modified.**
- **No runtime behavior was changed.**
- **No dependencies were introduced.**
- **No commits were made.**
- **No pushes were made.**
- **All work is documentation-only.**
