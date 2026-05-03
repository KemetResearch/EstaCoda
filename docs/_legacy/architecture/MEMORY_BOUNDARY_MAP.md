# Memory Boundary Map

## Purpose
Explicitly map memory types, ownership, persistence, rendering, promotion, and governance boundaries in the v0.3 codebase.

## Scope
All memory-related code: `src/memory/*`, `src/contracts/memory.ts`, and memory interactions in `src/runtime/agent-loop.ts`.

## Source Files Inspected
- `src/memory/memory-store.ts`
- `src/memory/memory-renderer.ts`
- `src/memory/memory-promotion.ts`
- `src/memory/memory-promotion-store.ts`
- `src/memory/local-memory-provider.ts`
- `src/memory/memory-tool.ts`
- `src/memory/memory-scanner.ts`
- `src/contracts/memory.ts`
- `src/runtime/agent-loop.ts` (memory-related sections)

## Memory Type Distinctions

### 1. Session State
- **What:** Messages, tool calls, provider iterations within a single session.
- **Where:** `InMemorySessionDB` or `SqliteSessionDB` (`src/session/*`)
- **Durable:** ✅ Yes (SQLite) or ❌ No (in-memory)
- **Owner:** Session layer
- **Lifecycle:** Session-scoped. Persisted if SQLite is used.
- **Governance:** No special governance. User can view history.
- **Evidence:** `SessionDB` interface, `SessionMessage` type.

### 2. Durable User Memory
- **What:** User preferences, repeated workflows, approved operating rules.
- **Where:** `~/.estacoda/memory/default/USER.md` or similar
- **Durable:** ✅ Yes (file-based)
- **Owner:** `LocalMemoryProvider` + `MemoryStore`
- **Lifecycle:** Long-lived. Promoted from session observations.
- **Governance:** `memory-promotion.ts` rules determine what gets promoted.
- **Evidence:** `resolveUserPreferencePromotion()` in `memory-promotion.ts`.

### 3. Durable Project Memory
- **What:** Repo conventions, project architecture, preferred commands, brand decisions.
- **Where:** `~/.estacoda/memory/default/MEMORY.md` or project-local memory
- **Durable:** ✅ Yes (file-based)
- **Owner:** `LocalMemoryProvider` + `MemoryStore`
- **Lifecycle:** Long-lived. Promoted from project context observations.
- **Governance:** `memory-promotion.ts` rules determine what gets promoted.
- **Evidence:** `resolveProjectFactPromotion()` in `memory-promotion.ts`.

### 4. Workflow Learning
- **What:** Learned skill behaviors, autonomy thresholds, repeated corrections.
- **Where:** `~/.estacoda/skill-learning.json`
- **Durable:** ✅ Yes (JSON file)
- **Owner:** `SkillLearningManager` (`src/skills/skill-learning.ts`)
- **Lifecycle:** Long-lived. Updated from skill usage telemetry.
- **Governance:** `SkillAutonomy` config controls learning rate.
- **Evidence:** `SkillLearningManager` class, `skill-learning.json` path.

### 5. Skill Outcomes
- **What:** Results of skill execution (success/failure, artifacts, tool calls).
- **Where:** Embedded in session history + `SkillOutcome` records
- **Durable:** ⚠️ Partial (if SQLite session DB is used)
- **Owner:** AgentLoop + Session layer
- **Lifecycle:** Session-scoped or persisted with session.
- **Governance:** No special governance.
- **Evidence:** `SkillOutcome` type in `contracts/memory.ts`.

### 6. Trajectory Records
- **What:** Events during a run (tool calls, provider iterations, decisions).
- **Where:** In-memory only (`TrajectoryRecorder`)
- **Durable:** ❌ No
- **Owner:** `TrajectoryRecorder` (`src/trajectory/trajectory-recorder.ts`)
- **Lifecycle:** Runtime-scoped. Lost after process exit.
- **Governance:** No governance — no data to govern.
- **Evidence:** `TrajectoryRecorder` is 97 lines with no persistence.

### 7. Prompt-Rendered Memory
- **What:** Memory content injected into provider prompts.
- **Where:** Assembled by `PromptAssembly` + `MemoryRenderer`
- **Durable:** ❌ No (computed at prompt time)
- **Owner:** Prompt layer + Memory layer
- **Lifecycle:** Per-turn. Rendered from durable memory files.
- **Governance:** `MemoryBudget` controls how much memory is rendered.
- **Evidence:** `MemoryBudget`, `RenderedMemorySnapshot`, `renderMemoryForPrompt()`.

### 8. Forgotten/Superseded/Contradicted Memory
- **What:** Memory that is outdated or overridden.
- **Where:** Not explicitly tracked.
- **Durable:** ❌ No tracking
- **Owner:** None
- **Lifecycle:** Files may be overwritten but no history kept.
- **Governance:** No governance.
- **Evidence:** `MemoryStore` overwrites files. No archive or versioning.

### 9. Sensitive or Secret Material
- **What:** API keys, tokens, passwords, private paths.
- **Where:** Environment variables, `.env` files, `EnvSecretStore`
- **Durable:** ✅ Yes (external to memory system)
- **Owner:** `EnvSecretStore` (`src/config/env-secret-store.ts`)
- **Lifecycle:** External. Managed by OS or user.
- **Governance:** **Must not be promoted to memory.** Redaction in logs.
- **Evidence:** `AGENTS.md` explicitly warns against logging secrets. `env-secret-store.ts` handles secrets separately from memory.

## Memory Data Flow

```
Session Observations
    ↓
AgentLoop.handle()
    ├──→ MemoryProvider.read() — fetch existing memory
    ├──→ PromptAssembly — render memory into prompt
    └──→ MemoryPromotion — decide what to promote
        ↓
    LocalMemoryProvider
        ├──→ MemoryStore — write to files
        └──→ MemoryPromotionStore — record promotions
```

## Memory Governance Boundaries

| Boundary | Enforced By | Status |
|----------|-------------|--------|
| Promotion rules | `memory-promotion.ts` | ✅ User preferences and project facts have distinct rules |
| Budget limits | `MemoryBudget` in contracts | ✅ Defined but not aggressively enforced |
| Secret isolation | `EnvSecretStore` + AGENTS.md policy | ✅ Secrets are separate from memory |
| File path safety | `memory-store.ts` | ✅ Writes to `~/.estacoda/memory/` only |
| Read scope | `local-memory-provider.ts` | ✅ Reads from configured memory roots |
| Render selectivity | `memory-renderer.ts` + `history-packer.ts` | ⚠️ Basic selectivity; no ranking algorithm evident |
| Staleness handling | None | ❌ No staleness detection |
| Contradiction handling | None | ❌ No contradiction detection |
| Archive/versioning | None | ❌ No versioning |

## Memory Subsystem Coupling

- **AgentLoop → MemoryProvider:** Direct coupling. AgentLoop reads memory and triggers promotion.
- **PromptAssembly → MemoryRenderer:** Direct coupling. Prompt assembly renders memory into prompts.
- **MemoryProvider → MemoryStore:** Direct coupling. LocalMemoryProvider uses MemoryStore for file I/O.
- **MemoryProvider → MemoryPromotion:** Direct coupling. Promotion happens through provider.
- **SkillLearningManager → Memory:** Indirect. Skill learning is stored separately from memory.

## Evidence Status
- ✅ Memory types are clearly defined in contracts.
- ✅ Promotion rules exist for user preferences and project facts.
- ✅ Secret isolation is enforced.
- ❌ Trajectory is not persisted.
- ❌ No staleness or contradiction handling.
- ❌ No memory versioning or archive.

## Open Questions
1. How does memory rendering avoid poisoning context with stale data?
2. What is the memory budget enforcement mechanism?
3. Should skill-learning.json be considered part of the memory system or separate?
4. How does the system handle conflicting memories?

## Recommended Follow-Up Areas
- Add staleness detection and freshness scoring for v0.6.
- Add memory versioning or archive for v0.6.
- Clarify if skill-learning.json should be managed by memory layer.
- Build knowledge graph integration for v0.6.
