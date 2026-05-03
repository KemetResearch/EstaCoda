# Current Runtime Knowledge Graph

## Purpose
Identify the major product subsystems, their ownership, dependencies, data flows, state durability, and governance boundaries as they exist post-v0.3.

## Scope
All source code under `src/`, skill definitions under `skills/`, and runtime data paths.

## Source Files Inspected
- All `src/**/*.ts` files
- `skills/official/*/SKILL.md`
- `memory/default/` (runtime memory store)
- `package.json`, `tsconfig.json`
- `AGENTS.md` (project conventions)

## Current-State Findings

### Major Product Subsystems

| Subsystem | Owner Files | Primary Responsibility |
|-----------|-------------|------------------------|
| **Agent Runtime** | `src/runtime/*` | Turn-loop orchestration, intent routing, provider negotiation, tool dispatch, memory promotion, trajectory recording |
| **Skill System** | `src/skills/*` | Skill loading from bundled/local/external sources, skill registry, skill tool dispatch, workflow planning, evolution proposals, learning telemetry |
| **Tool System** | `src/tools/*` | Tool schema generation, tool registry, tool-call planning, tool execution (builtin, web, workspace, code, image, voice, vision, media) |
| **Provider Layer** | `src/providers/*` | Provider routing, provider execution, OpenAI-compatible adapter, auxiliary provider routing, credential pooling, message normalization |
| **Memory Layer** | `src/memory/*` | Memory storage (file-based), memory rendering for prompts, memory promotion rules, local memory provider, memory scanning |
| **Security Layer** | `src/security/*` | Security policy factory, command safety assessment, workspace trust store, workspace approval controller |
| **Channel Layer** | `src/channels/*` | Channel gateway, Telegram adapter, gateway runner, channel session store, channel approval store, activity labels |
| **Session Layer** | `src/session/*` | In-memory session DB, SQLite session DB, session message storage and retrieval |
| **Prompt Layer** | `src/prompt/*` | Prompt assembly (system + skills + memory + history), history packing, prompt caching |
| **Trajectory Layer** | `src/trajectory/*` | Trajectory event recording (very thin — 97 lines) |
| **Artifact Layer** | `src/artifacts/*` | Artifact persistence (very thin — 56 lines) |
| **MCP Layer** | `src/mcp/*` | MCP client, MCP tool loading |
| **Cron Layer** | `src/cron/*` | Cron job runner, cron safety, cron store, cron tools |
| **Delegation Layer** | `src/delegation/*` | Delegation manager, delegation tools |
| **CLI Layer** | `src/cli/*` | CLI entry point, session loop, interactive selectors, slash menu, tool activity renderer |
| **Onboarding** | `src/onboarding/*` | Interactive onboarding, provider catalog, verification |
| **Contracts** | `src/contracts/*` | Type definitions for all subsystems |

### Data Flows

```
User Input (CLI / Telegram / Cron)
    ↓
IntentRouter — classifies intent, matches skills
    ↓
AgentLoop.handle() — main orchestration
    ├──→ SecurityPolicy — assess risk, decide allow/ask/deny
    ├──→ SkillLoader + SkillRegistry — load matched skills
    ├──→ SkillWorkflowPlanner — compile workflow plan
    ├──→ ToolCallPlanner — plan tool calls
    ├──→ ToolExecutor — execute tools
    ├──→ ProviderExecutor — call LLM provider
    ├──→ MemoryProvider — read/write memory
    ├──→ TrajectoryRecorder — record events
    └──→ ArtifactStore — persist artifacts
    ↓
AgentLoopResponse — text, artifacts, tool executions, skill outcomes
    ↓
Channel / CLI — render to user
```

### State Durability Map

| State | Location | Durable? | Owner |
|-------|----------|----------|-------|
| Session messages | `InMemorySessionDB` / `SqliteSessionDB` | ✅ Yes | `src/session/*` |
| Memory files | `~/.estacoda/memory/` or `memory/default/` | ✅ Yes | `src/memory/*` |
| Skill definitions | `skills/` (bundled) / `~/.estacoda/skills/` (local) | ✅ Yes | `src/skills/*` |
| Skill learning data | `~/.estacoda/skill-learning.json` | ✅ Yes | `src/skills/skill-learning.ts` |
| Skill evolution proposals | `~/.estacoda/skills/` (local working copies) | ✅ Yes | `src/skills/skill-evolution.ts` |
| Workspace trust | `~/.estacoda/workspace-trust.json` | ✅ Yes | `src/security/workspace-trust-store.ts` |
| Workspace approvals | SQLite or JSON | ✅ Yes | `src/security/workspace-approval-controller.ts` |
| Cron jobs | `~/.estacoda/cron/` | ✅ Yes | `src/cron/cron-store.ts` |
| Runtime config | `~/.estacoda/config.yaml` + `.env` | ✅ Yes | `src/config/*` |
| Provider credentials | Environment variables | ✅ Yes (external) | `src/config/env-secret-store.ts` |
| Trajectory events | In-memory only (thin recorder) | ❌ No | `src/trajectory/trajectory-recorder.ts` |
| Artifacts | In-memory only (thin store) | ❌ No | `src/artifacts/artifact-store.ts` |
| Prompt cache | In-memory (`PromptCache` class) | ❌ No | `src/prompt/prompt-cache.ts` |
| AgentLoop state | Instance variables (`#private` fields) | ❌ No | `src/runtime/agent-loop.ts` |

### Governance Boundaries

| Boundary | Enforced By | Status |
|----------|-------------|--------|
| Tool risk classification | `ToolRiskClass` in contracts + `command-safety.ts` | ✅ Implemented |
| Security decision (allow/ask/deny) | `SecurityPolicy` + `security-policy-factory.ts` | ✅ Implemented |
| Workspace trust | `WorkspaceTrustStore` + trust prompts | ✅ Implemented |
| Approval controller | `WorkspaceApprovalController` | ✅ Implemented |
| Skill mutation policy | `skill-mutation-policy.ts` | ✅ Implemented |
| Skill bundled sync | `skill-bundled-sync.ts` + `.bundled_manifest.json` | ✅ Implemented |
| Cron safety | `cron-safety.ts` | ✅ Implemented |
| Memory promotion rules | `memory-promotion.ts` | ✅ Implemented |
| Capability manifest | Not yet — `src/capabilities/capability-setup.ts` is 42 lines stub | ❌ Missing |
| Change manifest for evolution | Not yet — skill-evolution.ts has proposals but no formal manifest | ⚠️ Partial |
| Trace schema | Not yet — trajectory-recorder.ts is 97 lines | ❌ Missing |
| Eval substrate | `evals/tasks/` exists but no eval runner in src/ | ⚠️ Partial |

## Current Boundaries

### Runtime vs Skills
- **Runtime** (`src/runtime/*`) owns the turn loop, provider negotiation, and tool dispatch.
- **Skills** (`src/skills/*`) own loading, routing metadata, workflow planning, and mutation.
- **Boundary:** AgentLoop calls SkillTools and SkillWorkflowPlanner; skills do not call runtime directly.

### Runtime vs Tools
- **Runtime** dispatches to ToolExecutor.
- **Tools** (`src/tools/*`) own schema generation, execution adapters, and result formatting.
- **Boundary:** ToolExecutor is the single entry point for all tool execution.

### Runtime vs Providers
- **Runtime** calls ProviderExecutor.
- **Providers** (`src/providers/*`) own routing, credential management, and adapter logic.
- **Boundary:** ProviderExecutor encapsulates all provider calls.

### Runtime vs Memory
- **Runtime** calls MemoryProvider (LocalMemoryProvider).
- **Memory** (`src/memory/*`) owns storage, rendering, and promotion.
- **Boundary:** MemoryProvider interface is the contract.

### Runtime vs Session
- **Runtime** uses SessionDB interface.
- **Session** (`src/session/*`) owns persistence.
- **Boundary:** SessionDB interface abstracts in-memory vs SQLite.

### Skills vs Tools
- **Skills** can declare toolsets and workflow steps.
- **Tools** are independent of skills.
- **Boundary:** Skill routing references ToolsetName; tools do not reference skills.

## Coupling Risks

1. **AgentLoop knows too much:** Directly references intent router, security policy, tool executor, provider executor, memory provider, skill learning manager, skill evolution store, trajectory recorder, prompt assembly, and history packer.
2. **create-runtime.ts is a god factory:** Manually constructs 30+ objects. Any constructor change breaks it.
3. **Contracts are a single layer:** No stable/unstable split. All 17 contract files are equally "public."

## Evidence Status
- ✅ Subsystem ownership is clear from directory structure.
- ✅ Data flows are traceable from AgentLoop.handle().
- ✅ Durable state locations are documented in AGENTS.md.
- ❌ Trajectory recording is too thin to reconstruct full runs.
- ❌ Artifact store is too thin for robust artifact lifecycle.
- ❌ No formal capability manifest system.

## Open Questions
1. Where do trajectory events persist? (Currently in-memory only.)
2. Where do artifacts persist after a session ends? (Currently in-memory only.)
3. How does the eval substrate (`evals/tasks/`) connect to the runtime? (No runtime integration found.)
4. What is the lifecycle of a skill evolution proposal? (skill-evolution.ts has types but no state machine.)

## Recommended Follow-Up Areas
- Formalize trajectory persistence for v0.5.
- Formalize artifact persistence for v0.5.
- Connect eval substrate to runtime for v0.5.
- Design capability manifest schema for v0.10.
