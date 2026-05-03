
================================================================================
docs/architecture/CURRENT_DEPENDENCY_GRAPH.md
================================================================================
# Current Dependency Graph

## Purpose
Map all module-to-module import relationships in the EstaCoda v0.3 codebase to identify orchestration points, leaf utilities, coupling hotspots, and structural risks.

## Scope
All 127 TypeScript source files under `src/`, plus `package.json` and `tsconfig.json`.

## Source Files Inspected
- All `src/**/*.ts` and `src/**/*.tsx` files (127 files, ~53,000 lines)
- `package.json`
- `tsconfig.json`

## Methodology
Static import analysis: extracted all `import ... from "..."` statements, resolved relative paths, counted in-degree and out-degree for each module.

## Current-State Findings

### Central Orchestration Points (Highest In-Degree)
These modules are imported by the most other modules. They are the architectural hubs.

| Module | In-Degree | Role |
|--------|-----------|------|
| `src/contracts/tool.ts` | 44 | Central tool type definitions (ToolDefinition, ToolRiskClass, ToolsetName, etc.) |
| `src/contracts/provider.ts` | 23 | Provider type definitions (ModelProfile, ProviderMessage, ProviderRequest, etc.) |
| `src/config/runtime-config.ts` | 22 | Runtime configuration types and defaults (AgentProfileMode, UiLanguage, etc.) |
| `src/contracts/skill.ts` | 18 | Skill type definitions (SkillDefinition, LoadedSkill, SkillCatalogEntry, etc.) |
| `src/contracts/security.ts` | 16 | Security types (SecurityDecision, SecurityPolicy, SecurityRiskLevel, etc.) |
| `src/contracts/channel.ts` | 16 | Channel types (ChannelKind, ChannelAttachment, etc.) |
| `src/contracts/session.ts` | 14 | Session types (SessionDB, SessionMessage, SessionRecord, etc.) |
| `src/runtime/create-runtime.ts` | 12 | Runtime factory — wires all subsystems together |
| `src/tools/tool-executor.ts` | 12 | Tool execution orchestration |
| `src/contracts/memory.ts` | 11 | Memory types (MemoryProvider, MemoryBudget, SkillOutcome, etc.) |

### Leaf Utilities (Low In-Degree, Some Out-Degree)
These modules import others but are rarely imported themselves. They are consumers, not hubs.

| Module | Out | In | Role |
|--------|-----|-----|------|
| `src/smoke.ts` | 84 | 0 | Monolithic smoke test file (13,969 lines) |
| `src/cli/cli.ts` | 21 | 0 | CLI entry point |
| `src/prompt/prompt-assembly.ts` | 18 | 0 | Prompt construction |
| `src/onboarding/interactive-onboarding.ts` | 15 | 0 | Interactive onboarding flow |
| `src/cli/session-loop.ts` | 14 | 0 | Session loop UI |
| `src/acp/server.ts` | 13 | 0 | ACP server |
| `src/channels/gateway-runner.ts` | 13 | 0 | Channel gateway runner |
| `src/index.ts` | 11 | 0 | Main entry point |
| `src/channels/channel-gateway.ts` | 11 | 0 | Channel gateway orchestration |

### Files with Side Effects
No files detected with purely top-level side effects (no exports + top-level calls). All modules use explicit exports.

### Bidirectional Dependencies
Three bidirectional import pairs detected:

1. `src/config/runtime-config.ts` <-> `src/contracts/image-generation.ts`
   - Risk: Config depends on image generation types; image generation types depend on config. Low risk, small surface.

2. `src/contracts/intent.ts` <-> `src/contracts/skill.ts`
   - Risk: Intent routing types depend on skill types; skill types reference intent types. Acceptable within contracts layer.

3. `src/channels/channel-gateway.ts` <-> `src/channels/channel-session-store.ts`
   - Risk: Gateway and session store reference each other. Moderate — suggests session store logic may be partially embedded in gateway.

### Category Sizes

| Category | Files | Lines | Density Risk |
|----------|-------|-------|--------------|
| skills | 14 | 5,606 | **High** — skill-tools.ts is 2,292 lines |
| tools | 15 | 4,510 | **High** — tool-executor.ts is 462 lines, but many specialized tool files |
| cli | 7 | 4,106 | **High** — cli.ts is 2,562 lines, session-loop.ts is 906 lines |
| runtime | 3 | 4,090 | **Critical** — agent-loop.ts is 2,714 lines |
| channels | 9 | 3,607 | Moderate — channel-gateway.ts is 1,408 lines |
| config | 4 | 2,928 | Moderate — runtime-config.ts is 2,045 lines |
| onboarding | 6 | 2,595 | Moderate |
| providers | 9 | 2,206 | Low-Moderate |
| contracts | 17 | 1,777 | Low — type definitions only |
| cron | 5 | 1,089 | Low |
| memory | 7 | 1,074 | Low — but critical for v0.6 |
| security | 5 | 1,185 | Low |
| prompt | 3 | 1,145 | Low |
| session | 2 | 502 | Low |
| trajectory | 1 | 97 | **Very Low** — underdeveloped |
| artifacts | 1 | 56 | **Very Low** — underdeveloped |
| mcp | 2 | 937 | Low |
| delegation | 2 | 308 | Low |

## Coupling Risks

1. **AgentLoop Monolith** (`src/runtime/agent-loop.ts`, 2,714 lines)
   - Imports 34 modules.
   - Contains 25+ async methods handling: intent routing, security, skill workflow execution, provider loops, tool execution, memory promotion, trajectory recording, artifact handling, prompt assembly.
   - **Risk:** Any change to any subsystem requires touching AgentLoop. Testing requires mocking the entire universe.

2. **create-runtime.ts Factory** (830 lines, 63 imports)
   - Wires every subsystem together: providers, tools, skills, memory, security, channels, cron, MCP, delegation, browser.
   - **Risk:** Changing any subsystem constructor signature breaks the factory. No dependency injection framework; pure manual wiring.

3. **Contracts as Central Hub**
   - 17 contract files imported by 100+ modules.
   - **Risk:** Contract changes cascade widely. No versioning on contract types.

4. **smoke.ts Monolith** (13,969 lines)
   - Imports 89 modules. Contains all smoke tests in one file.
   - **Risk:** Test maintenance burden. No granular test isolation. Slow to run.

## Current Boundaries

- **contracts/**: Pure types, no runtime logic. Clean boundary.
- **tools/**: Tool definitions + execution adapters. Tool-executor.ts is the boundary.
- **providers/**: Provider routing + execution. provider-executor.ts is the boundary.
- **skills/**: Loading, registry, execution, evolution, learning. skill-tools.ts is the boundary.
- **memory/**: Storage, rendering, promotion. memory-store.ts is the boundary.
- **security/**: Policy factory, command safety, workspace trust/approval. security-policy-factory.ts is the boundary.
- **channels/**: Gateway, adapters, session/approval stores. channel-gateway.ts is the boundary.
- **trajectory/**: Only trajectory-recorder.ts (97 lines). **Boundary is immature.**
- **artifacts/**: Only artifact-store.ts (56 lines). **Boundary is immature.**

## Evidence Status
- ✅ Import graph is fully extractable from source.
- ✅ No circular dependencies beyond 3 minor bidirectional pairs.
- ⚠️ AgentLoop size is a known v0.4 target.
- ⚠️ smoke.ts size is a known testing debt.

## Open Questions
1. Why does `src/config/runtime-config.ts` depend on `src/contracts/image-generation.ts`?
2. Can `channel-gateway.ts` and `channel-session-store.ts` be decoupled?
3. Should contracts be versioned or split into stable/unstable?

## Recommended Follow-Up Areas
- Decompose AgentLoop into planner/executor/recorder (v0.4).
- Split smoke.ts into per-subsystem test files.
- Evaluate if create-runtime.ts can use a DI container or module pattern.


================================================================================
docs/architecture/dependency-graph.mmd
================================================================================
graph TD
    subgraph Contracts["src/contracts/ — Type Hub (1,777 lines)"]
        TOOL["tool.ts<br/>44 imports"]
        PROV["provider.ts<br/>23 imports"]
        SKILL["skill.ts<br/>18 imports"]
        SEC["security.ts<br/>16 imports"]
        CHAN["channel.ts<br/>16 imports"]
        SESS["session.ts<br/>14 imports"]
        MEM["memory.ts<br/>11 imports"]
        RTEV["runtime-event.ts<br/>9 imports"]
        ART["artifact.ts<br/>8 imports"]
        INTENT["intent.ts<br/>7 imports"]
        TPLAN["tool-plan.ts<br/>3 imports"]
        PROMPT["prompt.ts<br/>3 imports"]
    end

    subgraph Runtime["src/runtime/ — Orchestration (4,090 lines)"]
        AL["agent-loop.ts<br/>2,714 lines — MONOLITH"]
        CRT["create-runtime.ts<br/>830 lines — FACTORY"]
        IR["intent-router.ts<br/>546 lines"]
    end

    subgraph Skills["src/skills/ — Skill System (5,606 lines)"]
        SLOADER["skill-loader.ts<br/>916 lines"]
        SREG["skill-registry.ts<br/>199 lines"]
        STOOLS["skill-tools.ts<br/>2,292 lines"]
        SEVO["skill-evolution.ts<br/>665 lines"]
        SLEARN["skill-learning.ts<br/>497 lines"]
        SSYNC["skill-bundled-sync.ts<br/>417 lines"]
        SMUT["skill-mutation-policy.ts<br/>83 lines"]
        SWPLAN["skill-workflow-planner.ts<br/>148 lines"]
        STELEM["skill-usage-telemetry.ts<br/>41 lines"]
    end

    subgraph Tools["src/tools/ — Tool System (4,510 lines)"]
        TEXEC["tool-executor.ts<br/>462 lines"]
        TPLANNER["tool-call-planner.ts<br/>132 lines"]
        TREG["tool-registry.ts<br/>76 lines"]
        TBUILT["builtin-tools.ts<br/>68 lines"]
        TWEB["web-tools.ts<br/>731 lines"]
        TWS["workspace-tools.ts<br/>577 lines"]
        TCODE["execute-code-tool.ts<br/>~300 lines"]
        TIMG["image-generation-tools.ts<br/>~300 lines"]
    end

    subgraph Providers["src/providers/ — Provider Layer (2,206 lines)"]
        PEXEC["provider-executor.ts<br/>465 lines"]
        PROUT["provider-router.ts<br/>83 lines"]
        AUXP["auxiliary-provider-router.ts<br/>184 lines"]
        OPEAI["openai-compatible-provider.ts<br/>838 lines"]
        PREG["provider-registry.ts<br/>41 lines"]
    end

    subgraph Memory["src/memory/ — Memory Layer (1,074 lines)"]
        MSTORE["memory-store.ts<br/>141 lines"]
        MRENDER["memory-renderer.ts<br/>60 lines"]
        MPROMO["memory-promotion.ts<br/>326 lines"]
        MLOCAL["local-memory-provider.ts<br/>187 lines"]
        MTOOL["memory-tool.ts<br/>82 lines"]
    end

    subgraph Security["src/security/ — Security Layer (1,185 lines)"]
        SPF["security-policy-factory.ts<br/>422 lines"]
        CSAF["command-safety.ts<br/>172 lines"]
        WAPC["workspace-approval-controller.ts<br/>350 lines"]
        WTRUST["workspace-trust-store.ts<br/>139 lines"]
    end

    subgraph Channels["src/channels/ — Channel Layer (3,607 lines)"]
        CGATE["channel-gateway.ts<br/>1,408 lines"]
        GWRUN["gateway-runner.ts<br/>463 lines"]
        TELA["telegram-adapter.ts<br/>847 lines"]
        CSSTORE["channel-session-store.ts<br/>294 lines"]
        CASTORE["channel-approval-store.ts<br/>156 lines"]
    end

    subgraph Prompt["src/prompt/ — Prompt Layer (1,145 lines)"]
        PASSEM["prompt-assembly.ts<br/>964 lines"]
        HPACK["history-packer.ts<br/>134 lines"]
        PCACHE["prompt-cache.ts<br/>47 lines"]
    end

    subgraph Session["src/session/ — Session Layer (502 lines)"]
        IMSESS["in-memory-session-db.ts<br/>157 lines"]
        SQLSESS["sqlite-session-db.ts<br/>345 lines"]
    end

    subgraph Trajectory["src/trajectory/ — Trajectory (97 lines)"]
        TREC["trajectory-recorder.ts<br/>97 lines — THIN"]
    end

    subgraph Artifacts["src/artifacts/ — Artifacts (56 lines)"]
        ASTORE["artifact-store.ts<br/>56 lines — THIN"]
    end

    subgraph CLI["src/cli/ — CLI (4,106 lines)"]
        CLIMAIN["cli.ts<br/>2,562 lines"]
        SLOOP["session-loop.ts<br/>906 lines"]
    end

    subgraph Smoke["src/smoke.ts — Tests (13,969 lines)"]
        SMOKE["smoke.ts<br/>89 imports — MONOLITH"]
    end

    %% Central orchestration flows
    CRT --> AL
    CRT --> IR
    CRT --> SLOADER
    CRT --> SREG
    CRT --> STOOLS
    CRT --> TEXEC
    CRT --> TREG
    CRT --> PEXEC
    CRT --> MSTORE
    CRT --> MLOCAL
    CRT --> SPF
    CRT --> WTRUST
    CRT --> CGATE
    CRT --> TREC
    CRT --> ASTORE

    AL --> IR
    AL --> TEXEC
    AL --> TPLANNER
    AL --> PEXEC
    AL --> MLOCAL
    AL --> STOOLS
    AL --> SEVO
    AL --> SLEARN
    AL --> TREC
    AL --> PASSEM
    AL --> HPACK
    AL --> SEC
    AL --> SPF
    AL --> WAPC

    IR --> SKILL
    IR --> INTENT
    IR --> TOOL

    TEXEC --> TREG
    TEXEC --> TBUILT
    TEXEC --> TWEB
    TEXEC --> TWS
    TEXEC --> TCODE
    TEXEC --> CSAF

    PEXEC --> PROV
    PEXEC --> OPEAI
    PEXEC --> AUXP

    STOOLS --> SKILL
    STOOLS --> TOOL
    STOOLS --> SREG
    STOOLS --> SLOADER

    MLOCAL --> MSTORE
    MLOCAL --> MPROMO
    MLOCAL --> MRENDER

    CGATE --> TELA
    CGATE --> CSSTORE
    CGATE --> CASTORE
    CGATE --> CHAN
    CSSTORE --> CGATE

    PASSEM --> PROV
    PASSEM --> SESS
    PASSEM --> MEM
    PASSEM --> PCACHE

    SMOKE --> AL
    SMOKE --> CRT
    SMOKE --> IR
    SMOKE --> TOOL
    SMOKE --> SKILL
    SMOKE --> PROV
    SMOKE --> MEM
    SMOKE --> SEC

    style AL fill:#ff9999
    style CRT fill:#ffcccc
    style SMOKE fill:#ffcccc
    style TREC fill:#ffeb99
    style ASTORE fill:#ffeb99
    style TOOL fill:#99ccff
    style PROV fill:#99ccff
    style SKILL fill:#99ccff


================================================================================
docs/architecture/CURRENT_RUNTIME_KNOWLEDGE_GRAPH.md
================================================================================
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


================================================================================
docs/architecture/runtime-knowledge-graph.mmd
================================================================================
graph TB
    subgraph User["User Surfaces"]
        CLI["CLI (src/cli/)"]
        TELEGRAM["Telegram (src/channels/telegram-adapter.ts)"]
        CRON["Cron (src/cron/)"]
    end

    subgraph Runtime["Agent Runtime (src/runtime/)"]
        AL["AgentLoop<br/>Monolithic Orchestrator"]
        IR["IntentRouter<br/>Intent Classification"]
        CRT["createRuntime()<br/>Factory"]
    end

    subgraph Security["Security Layer (src/security/)"]
        SP["SecurityPolicy<br/>allow/ask/deny"]
        CSAF["CommandSafety<br/>Risk Assessment"]
        WTRUST["WorkspaceTrustStore"]
        WAPC["WorkspaceApprovalController"]
    end

    subgraph Skills["Skill System (src/skills/)"]
        SLOAD["SkillLoader<br/>Load bundled/local/external"]
        SREG["SkillRegistry<br/>Catalog & Lookup"]
        SWPLAN["SkillWorkflowPlanner<br/>Compile Plans"]
        SEVO["SkillEvolutionStore<br/>Propose Patches"]
        SLEARN["SkillLearningManager<br/>Telemetry & Learning"]
        STOOLS["SkillTools<br/>Skill-specific Tool Dispatch"]
    end

    subgraph Tools["Tool System (src/tools/)"]
        TEXEC["ToolExecutor<br/>Execute Tools"]
        TPLAN["ToolCallPlanner<br/>Plan Tool Calls"]
        TREG["ToolRegistry<br/>Tool Catalog"]
        TBUILTIN["Builtin Tools<br/>File, Shell, Search"]
        TWEB["Web Tools<br/>Fetch, Browse"]
        TCODE["Code Tools<br/>Execute Code"]
        TWS["Workspace Tools<br/>File Operations"]
    end

    subgraph Providers["Provider Layer (src/providers/)"]
        PEXEC["ProviderExecutor<br/>Call LLM"]
        PROUT["ProviderRouter<br/>Route to Provider"]
        OPEAI["OpenAICompatibleProvider<br/>Adapter"]
        AUXP["AuxiliaryProviderRouter<br/>Backup Routing"]
        CPOOL["CredentialPool<br/>Key Management"]
    end

    subgraph Memory["Memory Layer (src/memory/)"]
        MPROV["LocalMemoryProvider<br/>Memory Interface"]
        MSTORE["MemoryStore<br/>File Storage"]
        MRENDER["MemoryRenderer<br/>Prompt Packing"]
        MPROMO["MemoryPromotion<br/>Promotion Rules"]
        MSCAN["MemoryScanner<br/>Scan & Index"]
    end

    subgraph Session["Session Layer (src/session/)"]
        SDB["SessionDB<br/>In-Memory / SQLite"]
    end

    subgraph Prompt["Prompt Layer (src/prompt/)"]
        PASSEM["PromptAssembly<br/>Build Prompt"]
        HPACK["HistoryPacker<br/>Compress History"]
        PCACHE["PromptCache<br/>Cache Prompts"]
    end

    subgraph Trajectory["Trajectory Layer (src/trajectory/) — THIN"]
        TREC["TrajectoryRecorder<br/>97 lines"]
    end

    subgraph Artifacts["Artifact Layer (src/artifacts/) — THIN"]
        ASTORE["ArtifactStore<br/>56 lines"]
    end

    subgraph MCP["MCP Layer (src/mcp/)"]
        MCPCL["MCPClient<br/>External Tool Server"]
        MCPTL["MCPTools<br/>Tool Adapter"]
    end

    subgraph Cron["Cron Layer (src/cron/)"]
        CRUN["CronRunner<br/>Execute Scheduled Tasks"]
        CSTOR["CronStore<br/>Persist Jobs"]
        CSAF2["CronSafety<br/>Safety Checks"]
    end

    subgraph Channels["Channel Layer (src/channels/)"]
        CGATE["ChannelGateway<br/>Route Messages"]
        GWRUN["GatewayRunner<br/>Run Gateway"]
        CSSTORE["ChannelSessionStore<br/>Session Mapping"]
        CASTORE["ChannelApprovalStore<br/>Approval State"]
    end

    subgraph Config["Config Layer (src/config/)"]
        RCFG["RuntimeConfig<br/>Configuration"]
        ESECR["EnvSecretStore<br/>Secrets"]
    end

    %% Main data flows
    CLI --> AL
    TELEGRAM --> CGATE --> AL
    CRON --> CRUN --> AL

    AL --> IR
    AL --> SP
    AL --> SLOAD
    AL --> SREG
    AL --> SWPLAN
    AL --> STOOLS
    AL --> TEXEC
    AL --> TPLAN
    AL --> PEXEC
    AL --> MPROV
    AL --> PASSEM
    AL --> TREC
    AL --> ASTORE
    AL --> SDB

    IR --> SREG
    IR --> TBUILTIN

    SP --> CSAF
    SP --> WTRUST
    SP --> WAPC

    SLOAD --> SREG
    SEVO --> SREG
    SLEARN --> SREG
    STOOLS --> TEXEC
    SWPLAN --> TPLAN

    TEXEC --> TREG
    TEXEC --> TBUILTIN
    TEXEC --> TWEB
    TEXEC --> TCODE
    TEXEC --> TWS
    TEXEC --> CSAF

    PEXEC --> PROUT
    PEXEC --> OPEAI
    PEXEC --> AUXP
    PEXEC --> CPOOL

    MPROV --> MSTORE
    MPROV --> MRENDER
    MPROV --> MPROMO

    PASSEM --> HPACK
    PASSEM --> PCACHE
    PASSEM --> MRENDER
    PASSEM --> SDB

    TREC --> AL
    ASTORE --> AL

    CRT --> AL
    CRT --> IR
    CRT --> SP
    CRT --> SLOAD
    CRT --> SREG
    CRT --> STOOLS
    CRT --> TEXEC
    CRT --> TREG
    CRT --> PEXEC
    CRT --> MPROV
    CRT --> SDB
    CRT --> TREC
    CRT --> ASTORE
    CRT --> CGATE
    CRT --> CRUN
    CRT --> MCPCL

    %% Durable state
    MSTORE -.->|"Durable"| DISK1[("~/.estacoda/memory/")]
    SDB -.->|"Durable"| DISK2[("SQLite / In-Memory")]
    SREG -.->|"Durable"| DISK3[("~/.estacoda/skills/")]
    CSTOR -.->|"Durable"| DISK4[("~/.estacoda/cron/")]
    WTRUST -.->|"Durable"| DISK5[("~/.estacoda/workspace-trust.json")]
    SLEARN -.->|"Durable"| DISK6[("~/.estacoda/skill-learning.json")]

    style AL fill:#ff9999,stroke:#cc0000,stroke-width:2px
    style CRT fill:#ffcccc,stroke:#cc0000,stroke-width:2px
    style TREC fill:#ffeb99,stroke:#cc9900,stroke-width:2px
    style ASTORE fill:#ffeb99,stroke:#cc9900,stroke-width:2px


================================================================================
docs/architecture/CURRENT_ARCHITECTURE_MAP.md
================================================================================
# Current Architecture Map

## Purpose
Provide a code-grounded, file-level map of the EstaCoda v0.3 architecture showing what each module owns, what it depends on, and how it fits into the overall system.

## Scope
All 127 TypeScript source files, grouped by subsystem.

## Source Files Inspected
- All `src/**/*.ts` files
- `skills/official/*/SKILL.md`
- `package.json`, `tsconfig.json`

## Current-State Findings

### Entry Points

| File | Role | Lines | Imports |
|------|------|-------|---------|
| `src/index.ts` | Main entry point for `bun run dev` | 162 | 12 |
| `src/cli/cli.ts` | CLI entry point with interactive UI | 2,562 | 23 |
| `src/smoke.ts` | Smoke test runner | 13,969 | 89 |
| `src/acp/server.ts` | ACP server entry point | 1,716 | 13 |

### Runtime Core (src/runtime/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `agent-loop.ts` | **Monolithic turn-loop orchestrator.** Handles intent routing, security, skill workflow execution, provider loops, tool execution, memory promotion, trajectory recording, artifact handling, and prompt assembly. | 2,714 | `AgentLoop`, `AgentLoopInput`, `AgentLoopResponse`, `AgentLoopOptions`, `AgentLoopBudgets` |
| `create-runtime.ts` | **God factory.** Manually constructs and wires all subsystems: providers, tools, skills, memory, security, channels, cron, MCP, delegation, browser. | 830 | `createRuntime`, `Runtime`, `RuntimeOptions` |
| `intent-router.ts` | Intent classification and skill matching. Parses slash invocations, matches patterns, calculates confidence. | 546 | `IntentRouter` |

### Contracts (src/contracts/)

| File | Role | Lines | Key Types |
|------|------|-------|-----------|
| `tool.ts` | Tool type definitions | 54 | `ToolDefinition`, `ToolRiskClass`, `ToolsetName`, `ToolResult`, `ToolExecutionContext`, `ToolHandler`, `RegisteredTool` |
| `provider.ts` | Provider type definitions | 237 | `ModelProfile`, `ProviderMessage`, `ProviderRequest`, `ProviderResponse`, `ProviderAdapter`, `ProviderRoute`, `CredentialPoolEntry` |
| `skill.ts` | Skill type definitions | 222 | `SkillDefinition`, `LoadedSkill`, `SkillCatalogEntry`, `SkillWorkflowPlan`, `SkillWorkflowStep`, `SkillEvaluation`, `SkillSourceKind`, `SkillLifecycleState` |
| `security.ts` | Security type definitions | 124 | `SecurityDecision`, `SecurityRiskLevel`, `SecurityPolicy`, `SecurityContext`, `SecurityApprovalMode` |
| `channel.ts` | Channel type definitions | 141 | `ChannelKind`, `ChannelAttachment`, `ChannelMessage`, `ChannelGatewayConfig` |
| `session.ts` | Session type definitions | 305 | `SessionDB`, `SessionMessage`, `SessionRecord`, `SessionRole`, `SessionEvent` |
| `memory.ts` | Memory type definitions | 97 | `MemoryProvider`, `MemoryBudget`, `MemoryOperation`, `SkillOutcome`, `MemoryPromotionRecord` |
| `intent.ts` | Intent type definitions | 45 | `NativeIntent`, `IntentRoute`, `IntentRouteEvidence`, `SkillInvocation` |
| `trajectory.ts` | Trajectory type definitions | 60 | `TrajectoryEvent`, `Trajectory`, `CompressedTrajectory`, `TrajectoryEventKind` |
| `runtime-event.ts` | Runtime event type definitions | 104 | `RuntimeEvent`, `RuntimeEventSink` |
| `artifact.ts` | Artifact type definitions | 33 | `ArtifactRecord`, `isArtifactKind` |
| `tool-plan.ts` | Tool plan type definitions | 28 | `ToolCallPlan` |
| `prompt.ts` | Prompt type definitions | 49 | `PromptBudgetReport` |
| `context.ts` | Context type definitions | ~120 | `ContextExpansionResult`, `ProjectContextSnapshot` |
| `browser.ts` | Browser type definitions | ~110 | `BrowserBackend`, `BrowserPage`, `BrowserAction` |
| `image-generation.ts` | Image generation type definitions | ~100 | `ImageGenerationConfig`, `ImageGenerationRequest` |

### Skills (src/skills/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `skill-tools.ts` | **Skill tool dispatch and execution.** 2,292 lines — handles skill routing, skill tool calls, skill workflow execution, skill mutation, and skill metadata. | 2,292 | `createSkillTools`, `SkillToolSet`, `SkillMutationSet` |
| `skill-loader.ts` | Load skills from directories. Parses SKILL.md, validates structure, handles bundled/local/external sources. | 916 | `loadSkillsFromDirectory`, `parseSkillDefinition` |
| `skill-evolution.ts` | Skill evolution store. Proposes, reviews, approves, and promotes skill patches. | 665 | `SkillEvolutionStore`, `SkillPatchProposal`, `SkillPatchStatus` |
| `skill-learning.ts` | Skill learning manager. Records telemetry, learns from usage, manages autonomy thresholds. | 497 | `SkillLearningManager`, `SkillAutonomy` |
| `skill-bundled-sync.ts` | Sync bundled skills to local directory. Handles manifest tracking and origin hashes. | 417 | `syncBundledSkills`, `BundledManifest` |
| `skill-registry.ts` | Skill registry. Maintains catalog of loaded skills. | 199 | `SkillRegistry` |
| `skill-workflow-planner.ts` | Compile skill workflow plans from skill definitions. | 148 | `compileSkillWorkflowPlan` |
| `skill-mutation-policy.ts` | Policy for skill mutations. Determines what can be mutated and how. | 83 | `skillMutationPolicy`, `canMutateSkill` |
| `skill-curator-status.ts` | Curator status tracking for skill evolution. | 100 | `SkillCuratorStatus`, `listProposals`, `promotePatch` |
| `skill-usage-telemetry.ts` | Telemetry for skill usage. Route match counts, selection counts, confidence scores. | 41 | `createSkillRouteTelemetry`, `hashSkillRoutePrompt` |
| `skill-lifecycle.ts` | Skill lifecycle state management. | 48 | `SkillLifecycleState` transitions |
| `skill-path-safety.ts` | Path safety for skill file operations. | ~80 | `safeSkillPath`, `validateSkillPath` |
| `skill-visibility.ts` | Skill visibility evaluation. | ~60 | `evaluateSkillVisibility` |

### Tools (src/tools/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `tool-executor.ts` | Execute tools with context, risk checks, and result formatting. | 462 | `ToolExecutor`, `ToolExecutionRecord` |
| `web-tools.ts` | Web fetch and browse tools. | 731 | `createWebTools`, `FetchLike` |
| `workspace-tools.ts` | Workspace file operation tools. | 577 | `createWorkspaceTools`, `WorkspaceFsAdapter` |
| `tool-schema.ts` | Build provider-compatible tool schemas from tool definitions. | ~250 | `buildProviderToolSchemaCatalog`, `OpenAICompatibleToolSchema` |
| `tool-call-planner.ts` | Plan tool calls from provider responses. | 132 | `ToolCallPlanner` |
| `execute-code-tool.ts` | Execute code in sandboxed environment. | ~300 | `createExecuteCodeTool` |
| `image-generation-tools.ts` | Image generation tools. | ~300 | `createImageGenerationTools` |
| `vision-tools.ts` | Vision/image analysis tools. | ~200 | `createVisionTools`, `analyzeImageWithVision` |
| `voice-tools.ts` | Voice/speech tools. | ~200 | `createVoiceTools` |
| `media-tools.ts` | Media processing tools. | ~150 | `createMediaTools` |
| `python-tools.ts` | Python execution tools. | ~200 | `createPythonTools` |
| `tool-registry.ts` | Tool registry. Maintains catalog of registered tools. | 76 | `ToolRegistry` |
| `builtin-tools.ts` | Built-in tools (file, shell, search). | 68 | `builtinTools` |
| `tool-result-packet.ts` | Format tool results for provider consumption. | ~100 | `packetizeToolExecution`, `renderToolResultPacket` |

### Providers (src/providers/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `openai-compatible-provider.ts` | OpenAI-compatible provider adapter. Handles streaming, retries, errors. | 838 | `createOpenAICompatibleProvider` |
| `provider-executor.ts` | Execute provider calls with routing, fallback, and event streaming. | 465 | `ProviderExecutor`, `ProviderExecutionResult` |
| `auxiliary-provider-router.ts` | Route to auxiliary/backup providers when primary fails. | 184 | `AuxiliaryProviderRouter` |
| `provider-router.ts` | Route requests to appropriate provider based on model and preferences. | 83 | `ProviderRouter` |
| `provider-registry.ts` | Registry of available providers. | 41 | `ProviderRegistry` |
| `catalog-provider.ts` | Create catalog provider for model discovery. | 31 | `createCatalogProvider` |
| `provider-message-normalizer.ts` | Normalize messages between provider formats. | ~100 | `normalizeProviderMessagesStrict` |
| `credential-pool.ts` | Manage credential pools for provider authentication. | ~150 | `CredentialPoolRegistry` |
| `model-catalog.ts` | Catalog of known model profiles. | ~200 | `fallbackKnownModelProfiles`, `inferModelProfile` |

### Memory (src/memory/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `memory-promotion.ts` | Memory promotion rules. Determines what gets promoted to durable memory. | 326 | `resolveProjectFactPromotion`, `resolveUserPreferencePromotion`, `MemoryPromotionRule` |
| `memory-promotion-store.ts` | Store for memory promotion records. | 242 | `MemoryPromotionStore` |
| `local-memory-provider.ts` | Local file-based memory provider. | 187 | `LocalMemoryProvider` |
| `memory-store.ts` | Memory file storage operations. | 141 | `MemoryStore` |
| `memory-tool.ts` | Memory tool for agent self-management of memory. | 82 | `createMemoryTool` |
| `memory-renderer.ts` | Render memory into prompt-compatible format. | 60 | `renderMemoryForPrompt` |
| `memory-scanner.ts` | Scan memory files for indexing. | 36 | `scanMemoryFiles` |

### Security (src/security/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `security-policy-factory.ts` | Create security policies for different modes. | 422 | `createSecurityPolicyForMode`, `SecurityPolicy` implementations |
| `workspace-approval-controller.ts` | Manage workspace approval grants and checks. | 350 | `WorkspaceApprovalController` |
| `command-safety.ts` | Assess command safety and risk levels. | 172 | `assessCommandSafety`, `CommandSafetyResult` |
| `workspace-trust-store.ts` | Store and check workspace trust status. | 139 | `WorkspaceTrustStore` |
| `workspace-trust-tools.ts` | Tools for workspace trust management. | ~80 | `createWorkspaceTrustTools` |

### Channels (src/channels/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `channel-gateway.ts` | Gateway for all channel communication. | 1,408 | `ChannelGateway`, `ChannelGatewayConfig` |
| `telegram-adapter.ts` | Telegram Bot API adapter. | 847 | `TelegramAdapter`, `TelegramMessage` |
| `gateway-runner.ts` | Run channel gateway with polling/webhook. | 463 | `GatewayRunner` |
| `channel-session-store.ts` | Map channel users to sessions. | 294 | `ChannelSessionStore` |
| `channel-approval-store.ts` | Store approval state for channel-triggered actions. | 156 | `ChannelApprovalStore` |
| `activity-labels.ts` | Activity label definitions for channels. | ~50 | `ActivityLabels` |
| `voice-transcription.ts` | Voice transcription for channel inputs. | ~100 | `transcribeVoice` |
| `mock-channel-adapter.ts` | Mock adapter for testing. | ~50 | `MockChannelAdapter` |

### Prompt (src/prompt/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `prompt-assembly.ts` | Assemble full prompts from system, skills, memory, history. | 964 | `assembleProviderPrompt`, `assembleProviderContinuationPrompt` |
| `history-packer.ts` | Pack session history into provider message format. | 134 | `packSessionHistory` |
| `prompt-cache.ts` | Cache assembled prompts. | 47 | `PromptCache` |

### Session (src/session/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `sqlite-session-db.ts` | SQLite-backed session database. | 345 | `SqliteSessionDB` |
| `in-memory-session-db.ts` | In-memory session database. | 157 | `InMemorySessionDB` |

### Trajectory (src/trajectory/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `trajectory-recorder.ts` | Record trajectory events. | 97 | `TrajectoryRecorder`, `recordTrajectoryEvent` |

### Artifacts (src/artifacts/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `artifact-store.ts` | Store and retrieve artifacts. | 56 | `ArtifactStore` |

### MCP (src/mcp/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `mcp-client.ts` | MCP (Model Context Protocol) client. | 565 | `MCPClient`, `connectMcpServer` |
| `mcp-tools.ts` | Load tools from MCP servers. | 372 | `loadMcpServers`, `MCPServerSnapshot` |

### Cron (src/cron/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `cron-store.ts` | Store and manage cron jobs. | 355 | `CronStore` |
| `cron-runner.ts` | Execute cron jobs. | 306 | `CronRunner` |
| `cron-tools.ts` | Tools for cron job management. | 164 | `createCronTools` |
| `cron-safety.ts` | Safety checks for cron jobs. | 38 | `CronSafetyPolicy` |
| `cron-command.ts` | Cron command parsing. | ~100 | `parseCronCommand` |

### Config (src/config/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `runtime-config.ts` | Runtime configuration types, defaults, and loading. | 2,045 | `LoadedRuntimeConfig`, `AgentProfileMode`, `UiLanguage`, `UiFlavor`, `SecurityApprovalMode` |
| `config-tools.ts` | Tools for configuration management. | 564 | `createConfigTools` |
| `env-secret-store.ts` | Environment variable secret store. | 116 | `EnvSecretStore` |
| `provider-diagnostics.ts` | Provider diagnostics and health checks. | ~100 | `runProviderDiagnostics` |

### CLI (src/cli/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `cli.ts` | Main CLI with interactive UI, menus, and command handling. | 2,562 | `runCli`, `CliOptions` |
| `session-loop.ts` | Session interaction loop. | 906 | `runSessionLoop` |
| `interactive-select.ts` | Interactive selector UI components. | ~200 | `interactiveSelect` |
| `slash-menu.ts` | Slash command menu. | ~150 | `SlashMenu` |
| `tool-activity-renderer.ts` | Render tool activity in UI. | ~100 | `ToolActivityRenderer` |
| `one-shot.ts` | One-shot command execution. | ~100 | `runOneShot` |
| `cli-session-store.ts` | Store CLI session state. | ~80 | `CliSessionStore` |

### Onboarding (src/onboarding/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `interactive-onboarding.ts` | Interactive onboarding flow. | 1,155 | `runInteractiveOnboarding` |
| `onboarding-copy.ts` | Onboarding text and copy. | 956 | `onboardingCopy` |
| `onboarding-flow.ts` | Onboarding step definitions. | ~300 | `OnboardingFlow` |
| `onboarding-tools.ts` | Tools for onboarding. | ~100 | `createOnboardingTools` |
| `onboarding-provider-catalog.ts` | Provider catalog for onboarding. | ~100 | `ProviderCatalog` |
| `verification.ts` | Onboarding verification. | ~80 | `verifyOnboarding` |

## Current Boundaries

### Strong Boundaries
- **contracts/** → Pure types. No runtime logic. Clean import-only boundary.
- **config/** → Configuration loading. No business logic.
- **session/** → Session persistence. Abstracted via `SessionDB` interface.

### Moderate Boundaries
- **tools/** → Tool execution. Centralized via `ToolExecutor`, but tool files are numerous.
- **providers/** → Provider execution. Centralized via `ProviderExecutor`, but `openai-compatible-provider.ts` is large.
- **skills/** → Skill management. Multiple concerns mixed (loading, execution, evolution, learning).
- **security/** → Security decisions. Good separation but `security-policy-factory.ts` is complex.

### Weak Boundaries
- **runtime/** → `agent-loop.ts` is a monolith. `create-runtime.ts` is a god factory.
- **trajectory/** → Only 97 lines. Not a real subsystem yet.
- **artifacts/** → Only 56 lines. Not a real subsystem yet.
- **channels/** → `channel-gateway.ts` is large and coupled to `channel-session-store.ts`.

## Coupling Risks
1. **AgentLoop** directly imports 34 modules. Any subsystem change can affect it.
2. **create-runtime.ts** manually constructs 30+ objects. Constructor changes break the factory.
3. **skill-tools.ts** at 2,292 lines mixes skill execution, skill mutation, and skill metadata.
4. **cli.ts** at 2,562 lines mixes UI rendering, command handling, and session management.

## Evidence Status
- ✅ File-level ownership is clear.
- ✅ Key exports are documented in source.
- ✅ Directory structure matches subsystem boundaries.
- ⚠️ Some files exceed recommended size (AgentLoop, skill-tools, cli, create-runtime).
- ❌ Trajectory and artifact subsystems are underdeveloped.

## Open Questions
1. Should `skill-tools.ts` be split into execution, mutation, and metadata modules?
2. Should `cli.ts` be split into UI, command parsing, and session management?
3. What is the intended scope of `acp/server.ts` (1,716 lines)?

## Recommended Follow-Up Areas
- Decompose AgentLoop into planner/executor/recorder for v0.4.
- Split skill-tools.ts into smaller modules.
- Split cli.ts into smaller modules.
- Develop trajectory and artifact subsystems for v0.5.


================================================================================
docs/architecture/ARCHITECTURE_RISK_REGISTER.md
================================================================================
# Architecture Risk Register

## Purpose
Document post-v0.3 architectural risks with severity, evidence, and recommended mitigation.

## Scope
Codebase structural risks, not functional bugs.

## Source Files Inspected
- All `src/**/*.ts` files (127 files, ~53,000 lines)
- `package.json`, `tsconfig.json`
- `AGENTS.md`

## Risk Register

### R1: AgentLoop Monolith
- **Severity:** Critical
- **Likelihood:** Confirmed (2,714 lines, 25+ async methods)
- **Impact:** Changes to any subsystem require touching AgentLoop. Testing requires mocking the universe. Refactoring is high-risk.
- **Evidence:** `src/runtime/agent-loop.ts` imports 34 modules and handles intent routing, security, skill workflow execution, provider loops, tool execution, memory promotion, trajectory recording, artifact handling, and prompt assembly.
- **Mitigation:** Decompose into Planner, Executor, and Recorder for v0.4.
- **Owner:** v0.4 — Agent-Loop Decomposition

### R2: create-runtime.ts God Factory
- **Severity:** High
- **Likelihood:** Confirmed (830 lines, 63 imports)
- **Impact:** Any subsystem constructor signature change breaks runtime creation. No DI container or module pattern.
- **Evidence:** `src/runtime/create-runtime.ts` manually constructs providers, tools, skills, memory, security, channels, cron, MCP, delegation, browser.
- **Mitigation:** Introduce module registration pattern or DI container. Consider runtime builder pattern.
- **Owner:** v0.4 — Runtime Decomposition

### R3: smoke.ts Monolith
- **Severity:** High
- **Likelihood:** Confirmed (13,969 lines, 89 imports)
- **Impact:** Test maintenance burden. No granular isolation. Slow execution. Difficult to debug failures.
- **Evidence:** `src/smoke.ts` contains all smoke tests in one file.
- **Mitigation:** Split into per-subsystem test files under `evals/` or `tests/`.
- **Owner:** v0.5 — Evaluation Substrate

### R4: Trajectory Recorder Underdeveloped
- **Severity:** High
- **Likelihood:** Confirmed (97 lines)
- **Impact:** Cannot reconstruct what happened during a run. No evidence substrate for AHE-style evolution.
- **Evidence:** `src/trajectory/trajectory-recorder.ts` is 97 lines with no persistence layer.
- **Mitigation:** Build structured trajectory recorder with trace schema for v0.5.
- **Owner:** v0.5 — Run Recorder, Trace Schema

### R5: Artifact Store Underdeveloped
- **Severity:** Medium-High
- **Likelihood:** Confirmed (56 lines)
- **Impact:** Artifacts may be lost after session ends. No artifact lifecycle management.
- **Evidence:** `src/artifacts/artifact-store.ts` is 56 lines with no persistence.
- **Mitigation:** Build artifact persistence and lifecycle for v0.5.
- **Owner:** v0.5 — Artifact Recording

### R6: skill-tools.ts Monolith
- **Severity:** Medium
- **Likelihood:** Confirmed (2,292 lines)
- **Impact:** Skill execution, mutation, and metadata logic are tangled.
- **Evidence:** `src/skills/skill-tools.ts` handles skill routing, tool calls, workflow execution, mutation, and metadata.
- **Mitigation:** Split into skill-execution.ts, skill-mutation.ts, and skill-metadata.ts.
- **Owner:** v0.4 — Skill System Cleanup

### R7: cli.ts Monolith
- **Severity:** Medium
- **Likelihood:** Confirmed (2,562 lines)
- **Impact:** UI rendering, command handling, and session management are tangled.
- **Evidence:** `src/cli/cli.ts` mixes Ink UI components, command parsing, and session orchestration.
- **Mitigation:** Split into cli-ui.ts, cli-commands.ts, and cli-session.ts.
- **Owner:** Post-v0.4 — CLI Refactor

### R8: channel-gateway.ts Coupled to channel-session-store.ts
- **Severity:** Medium
- **Likelihood:** Confirmed (bidirectional import)
- **Impact:** Gateway and session store cannot evolve independently.
- **Evidence:** `src/channels/channel-gateway.ts` and `src/channels/channel-session-store.ts` import each other.
- **Mitigation:** Decouple via events or mediator pattern.
- **Owner:** v0.9 — Channels Hardening

### R9: Tool-Call Planner Thin
- **Severity:** Medium
- **Likelihood:** Confirmed (132 lines)
- **Impact:** Tool planning may not handle complex dependency chains.
- **Evidence:** `src/tools/tool-call-planner.ts` is 132 lines with minimal logic.
- **Mitigation:** Enhance with explicit DAG representation for v0.4.
- **Owner:** v0.4 — Tool-Plan Dependency Model

### R10: No Formal Eval Runner in Runtime
- **Severity:** Medium
- **Likelihood:** Confirmed
- **Impact:** Evals exist in `evals/tasks/` but are not integrated into runtime.
- **Evidence:** No eval runner found in `src/`. `evals/` directory exists but is separate.
- **Mitigation:** Build eval runner and integrate with trajectory recorder for v0.5.
- **Owner:** v0.5 — Evaluation Substrate

### R11: config/runtime-config.ts Coupled to contracts/image-generation.ts
- **Severity:** Low
- **Likelihood:** Confirmed (bidirectional import)
- **Impact:** Low — small surface, but breaks clean layer separation.
- **Evidence:** Config imports image generation types; image generation types reference config.
- **Mitigation:** Move image generation config into contracts or config.
- **Owner:** v0.4 — Config Cleanup

### R12: Contracts as Single Layer
- **Severity:** Low-Medium
- **Likelihood:** Confirmed
- **Impact:** All contract changes cascade to all modules. No stability boundary.
- **Evidence:** 17 contract files imported by 100+ modules.
- **Mitigation:** Consider versioning or stable/unstable split.
- **Owner:** Post-MVP

### R13: Memory System No Knowledge Graph
- **Severity:** Medium
- **Likelihood:** Confirmed
- **Impact:** Memory is file-based with no structured graph. Cannot support complex query or reasoning.
- **Evidence:** `src/memory/memory-store.ts` is file-based. No graph structure.
- **Mitigation:** Build project knowledge graph and dependency graph for v0.6.
- **Owner:** v0.6 — Memory, Dependency Graph, Knowledge Graph

### R14: No Capability Manifest System
- **Severity:** Medium
- **Likelihood:** Confirmed
- **Impact:** Cannot safely evaluate or constrain new capabilities.
- **Evidence:** `src/capabilities/capability-setup.ts` is 42 lines stub.
- **Mitigation:** Build capability manifest schema and eval hooks for v0.10.
- **Owner:** v0.10 — Trusted Extension

### R15: Cron Safety Minimal
- **Severity:** Low-Medium
- **Likelihood:** Confirmed
- **Impact:** Cron jobs run with limited safety checks.
- **Evidence:** `src/cron/cron-safety.ts` is 38 lines.
- **Mitigation:** Enhance cron safety with approval gates and sandboxing.
- **Owner:** v0.9 — Automations

### R16: MCP Integration Unclear Scope
- **Severity:** Low
- **Likelihood:** Confirmed
- **Impact:** MCP client is 565 lines but integration with tool system is unclear.
- **Evidence:** `src/mcp/mcp-client.ts` and `src/mcp/mcp-tools.ts` exist but are not central to runtime.
- **Mitigation:** Clarify MCP role in tool registry.
- **Owner:** v0.10 — Extension Model

### R17: ACP Server Large and Unclear
- **Severity:** Low
- **Likelihood:** Confirmed
- **Impact:** `src/acp/server.ts` is 1,716 lines — scope and coupling unclear.
- **Evidence:** ACP server is large but not central to dependency graph.
- **Mitigation:** Audit ACP server scope and decouple from core runtime if possible.
- **Owner:** Post-v0.4

### R18: Browser Backend Large
- **Severity:** Low
- **Likelihood:** Confirmed
- **Impact:** `src/browser/browser-backend.ts` is 766 lines. May duplicate external tool functionality.
- **Evidence:** Browser backend is substantial but not heavily imported.
- **Mitigation:** Evaluate if browser tools should be MCP-based or standalone.
- **Owner:** v0.10 — Extension Model

## Risk Summary by Version

| Version | Primary Risks Addressed |
|---------|------------------------|
| v0.4 | R1, R2, R6, R7, R9, R11 |
| v0.5 | R3, R4, R5, R10 |
| v0.6 | R13 |
| v0.7 | R12 (partial) |
| v0.8 | R8 (partial) |
| v0.9 | R8, R15 |
| v0.10 | R14, R16, R18 |

## Evidence Status
- ✅ All risks are code-grounded.
- ✅ File sizes and import counts are measured.
- ✅ Severity is assessed by impact on future evolution.
- ❌ No runtime metrics (test coverage, performance) available.

## Open Questions
1. What is the target test coverage for v0.4 decomposition?
2. Should R17 (ACP server) be prioritized?
3. Is R18 (browser backend) in scope for MVP?

## Recommended Follow-Up Areas
- Build trace schema before v0.4 coding to guide decomposition.
- Define eval runner interface before v0.5 coding.
- Define capability manifest schema before v0.10 coding.


================================================================================
docs/architecture/CODEBASE_AUDIT_POST_V0.3.md
================================================================================
# Codebase Audit Post-v0.3

## Purpose
Provide a comprehensive, code-grounded audit of the EstaCoda codebase after v0.3 (skills hardening), identifying what exists, what works, what's incomplete, and what conflicts with planning documents.

## Scope
All source code, configuration, documentation, and skill definitions.

## Source Files Inspected
- All 127 TypeScript files under `src/`
- `skills/official/*/SKILL.md`
- `docs/*.md`
- `package.json`, `tsconfig.json`
- `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`
- `evals/tasks/`
- `.github/`

## Audit Findings

### A. Project Metadata

| Attribute | Value | Assessment |
|-----------|-------|------------|
| Name | `@estacoda/v2` | ✅ Clear |
| Version | `0.0.0` | ⚠️ Should reflect v0.3 |
| Type | ES Module | ✅ Modern |
| Runtime | Bun | ✅ Fast, modern |
| TypeScript | 5.8 | ✅ Current |
| Test Framework | None in package.json | ❌ Missing |
| Dependencies | 0 production dependencies | ✅ Lightweight |
| Dev Dependencies | `@types/node`, `typescript` | ✅ Minimal |

### B. Scripts Audit

| Script | Command | Status |
|--------|---------|--------|
| `typecheck` | `tsc --noEmit` | ✅ Present |
| `dev` | `$npm_execpath src/index.ts` | ✅ Present |
| `smoke` | `$npm_execpath src/smoke.ts` | ✅ Present |
| `alpha:harness` | `$npm_execpath scripts/internal-alpha.ts` | ✅ Present |
| `eval:substrate` | `$npm_execpath scripts/eval-substrate.ts` | ✅ Present |
| `provider:hardening` | `$npm_execpath scripts/provider-hardening.ts` | ✅ Present |
| `test` | None | ❌ Missing |
| `build` | None | ⚠️ No build script |
| `lint` | None | ⚠️ No lint script |
| `format` | None | ⚠️ No format script |

### C. tsconfig.json Audit

| Attribute | Value | Assessment |
|-----------|-------|------------|
| `target` | ESNext | ✅ |
| `module` | ESNext | ✅ |
| `moduleResolution` | bundler | ✅ |
| `strict` | true | ✅ |
| `noEmit` | true | ✅ (typecheck only) |
| `paths` | None | ⚠️ No path aliases |
| `include` | `["src/**/*.ts"]` | ✅ |
| `exclude` | None | ⚠️ Should exclude tests if added |

### D. Documentation Audit

| Document | Exists | Conflicts with Codebase? |
|----------|--------|-------------------------|
| `README.md` | ✅ | No — minimal, accurate |
| `AGENTS.md` | ✅ | Minor: project structure map differs from actual tree |
| `CONTRIBUTING.md` | ✅ | No conflicts |
| `SECURITY.md` | ✅ | No conflicts |
| `ONBOARDING.md` | ✅ | No conflicts |
| `docs/ARCHITECTURE.md` | ✅ | Partial — describes intent, not current state |
| `docs/ENVIRONMENT.md` | ✅ | No conflicts |
| `docs/EVALUATION.md` | ✅ | Partial — evals exist but no runtime integration |
| `docs/HANDOFF.md` | ✅ | No conflicts |
| `docs/INTERNAL_ALPHA_RUNBOOK.md` | ✅ | No conflicts |
| `docs/KNOWN_ISSUES.md` | ✅ | No conflicts |
| `docs/ROADMAP.md` | ✅ | Ignored per instructions |
| `docs/TESTING.md` | ✅ | Partial — no test framework configured |

**AGENTS.md Conflict:** The project structure map in AGENTS.md lists `src/gateway/` and `src/intent/` directories, but the actual tree has `src/channels/` and `src/runtime/intent-router.ts`. Also lists `tests/` directory which does not exist.

### E. Subsystem Completeness Audit

| Subsystem | Files | Lines | Completeness | Gaps |
|-----------|-------|-------|--------------|------|
| **Agent Runtime** | 3 | 4,090 | ⚠️ Functional but monolithic | AgentLoop is 2,714 lines; needs decomposition |
| **Skills** | 14 | 5,606 | ✅ Well-developed | skill-tools.ts is 2,292 lines; needs split |
| **Tools** | 15 | 4,510 | ✅ Well-developed | tool-call-planner.ts is thin (132 lines) |
| **Providers** | 9 | 2,206 | ✅ Functional | openai-compatible-provider.ts is large (838 lines) |
| **Memory** | 7 | 1,074 | ✅ Functional | No knowledge graph; no structured query |
| **Security** | 5 | 1,185 | ✅ Functional | Good separation of concerns |
| **Channels** | 9 | 3,607 | ✅ Functional | channel-gateway.ts is large (1,408 lines) |
| **Prompt** | 3 | 1,145 | ✅ Functional | prompt-assembly.ts is large (964 lines) |
| **Session** | 2 | 502 | ✅ Functional | Both in-memory and SQLite backends exist |
| **Trajectory** | 1 | 97 | ❌ Underdeveloped | No persistence; no structured schema |
| **Artifacts** | 1 | 56 | ❌ Underdeveloped | No persistence; no lifecycle |
| **MCP** | 2 | 937 | ⚠️ Present but unclear integration | Not central to runtime |
| **Cron** | 5 | 1,089 | ✅ Functional | cron-safety.ts is minimal (38 lines) |
| **Delegation** | 2 | 308 | ⚠️ Present but minimal | Not central to runtime |
| **Onboarding** | 6 | 2,595 | ✅ Functional | Well-developed |
| **CLI** | 7 | 4,106 | ✅ Functional | cli.ts is large (2,562 lines) |
| **Config** | 4 | 2,928 | ✅ Functional | runtime-config.ts is large (2,045 lines) |

### F. Skill Definitions Audit

| Skill | Path | Status |
|-------|------|--------|
| ASCII Video | `skills/official/ascii-video/SKILL.md` | ✅ Present |
| Telegram Media Analysis | `skills/official/telegram-media-analysis/SKILL.md` | ✅ Present |
| YouTube Knowledge Base | `skills/official/youtube-knowledge-base/SKILL.md` | ✅ Present |

All skills are under `skills/official/`. No `personal/` or `project/` skills found in repo.

### G. Eval Substrate Audit

| Component | Path | Status |
|-----------|------|--------|
| Eval tasks directory | `evals/tasks/` | ✅ Present |
| Eval runner in src | None | ❌ Missing |
| Smoke tests | `src/smoke.ts` | ✅ Present but monolithic |
| Eval substrate script | `scripts/eval-substrate.ts` | ✅ Present |
| Provider hardening script | `scripts/provider-hardening.ts` | ✅ Present |
| Internal alpha script | `scripts/internal-alpha.ts` | ✅ Present |

### H. GitHub Configuration Audit

| Component | Path | Status |
|-----------|------|--------|
| Issue templates | `.github/ISSUE_TEMPLATE/` | ✅ Present |
| PR template | `.github/pull_request_template.md` | ✅ Present |
| Workflows | `.github/workflows/` | ✅ Present |
| SECURITY policy | `SECURITY.md` | ✅ Present |

### I. Code Quality Indicators

| Metric | Value | Assessment |
|--------|-------|------------|
| Total files | 127 | Moderate |
| Total lines | ~53,000 | Large for MVP |
| Largest file | smoke.ts (13,969 lines) | ❌ Critical debt |
| Second largest | agent-loop.ts (2,714 lines) | ❌ Needs decomposition |
| Third largest | cli.ts (2,562 lines) | ⚠️ Should split |
| Average file size | ~417 lines | Reasonable |
| Files > 1000 lines | 6 | ⚠️ High |
| Files > 500 lines | 20 | ⚠️ Moderate |
| Bidirectional deps | 3 | ✅ Clean |
| Missing tests | All modules | ❌ Critical |

### J. Security Surface Audit

| Surface | Status | Evidence |
|---------|--------|----------|
| Command execution | ✅ Controlled | `command-safety.ts`, `tool-executor.ts` |
| File read/write | ✅ Controlled | `workspace-tools.ts`, `workspace-approval-controller.ts` |
| API key handling | ✅ Controlled | `env-secret-store.ts`, `credential-pool.ts` |
| Workspace trust | ✅ Controlled | `workspace-trust-store.ts` |
| Skill loading | ✅ Controlled | `skill-path-safety.ts`, `skill-loader.ts` |
| Skill mutation | ✅ Controlled | `skill-mutation-policy.ts` |
| Memory promotion | ✅ Controlled | `memory-promotion.ts` |
| Cron safety | ⚠️ Minimal | `cron-safety.ts` (38 lines) |
| Channel permissions | ✅ Controlled | `channel-approval-store.ts` |
| Network access | ✅ Controlled | `web-tools.ts` |

### K. Missing Components (Expected by Roadmap but Not Found)

| Component | Expected By | Status |
|-----------|-------------|--------|
| Trace schema | v0.5 | ❌ Not found |
| Change manifest spec | v0.7 | ❌ Not found |
| Eval dataset strategy | v0.5 | ❌ Not found |
| Evidence corpus structure | v0.5 | ❌ Not found |
| Capability manifest | v0.10 | ❌ Stub only (`src/capabilities/capability-setup.ts`, 42 lines) |
| Knowledge graph | v0.6 | ❌ Not found |
| Dependency graph | v0.6 | ❌ Not found |
| TaskFlow state machine | v0.8 | ❌ Not found |
| Flow persistence | v0.8 | ❌ Not found |
| Self-evolution pipeline | v0.10 | ❌ Not found |

## Current Boundaries
- **Contracts** are the cleanest boundary.
- **Runtime** is the messiest boundary (monolith).
- **Skills** are well-organized but `skill-tools.ts` is too large.
- **Trajectory and Artifacts** are not real boundaries yet.

## Coupling Risks
- AgentLoop → everything
- create-runtime.ts → everything
- smoke.ts → everything

## Evidence Status
- ✅ File-level audit is complete.
- ✅ Documentation conflicts are identified.
- ✅ Subsystem completeness is rated.
- ✅ Security surface is reviewed.
- ❌ No runtime behavior was tested (only static analysis).

## Open Questions
1. Should `package.json` version be updated to `0.3.0`?
2. Should a test framework be added before v0.4?
3. What is the role of `scripts/` vs `src/` for eval substrate?
4. Should `AGENTS.md` be updated to match actual tree?

## Recommended Follow-Up Areas
- Update `AGENTS.md` project structure map to match actual tree.
- Add test framework (`bun:test` or `vitest`).
- Split `smoke.ts` into per-subsystem files.
- Define trace schema before v0.4 decomposition.

