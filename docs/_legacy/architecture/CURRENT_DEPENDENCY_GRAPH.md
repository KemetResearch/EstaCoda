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
