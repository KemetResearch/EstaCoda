# Roadmap Alignment Notes

## Purpose
Compare the current v0.3 codebase against the v0.4–v0.10 roadmap to identify alignment, gaps, and sequencing risks.

## Scope
Current codebase state vs. roadmap objectives for v0.4 through v0.10.

## Source Files Inspected
- All `src/**/*.ts` files
- `docs/*.md`
- `package.json`
- `AGENTS.md`

## Alignment by Version

### v0.4 — Agent-Loop Decomposition

| Roadmap Requirement | Current State | Gap |
|---------------------|---------------|-----|
| Full agent-loop decomposition | ❌ Not done | AgentLoop is 2,714-line monolith |
| Provider turn-loop extraction | ❌ Not done | Provider loop is inside AgentLoop.#runProviderLoop() |
| Native intent executor extraction | ❌ Not done | Intent routing is mixed with execution |
| Tool-plan dependency model | ⚠️ Partial | `tool-call-planner.ts` exists (132 lines) but no DAG |
| Cancellation/resume substrate | ⚠️ Partial | AbortSignal is passed but resume is limited |
| Artifact recorder cleanup | ❌ Not done | `artifact-store.ts` is 56 lines |
| Run/trajectory structure | ❌ Not done | `trajectory-recorder.ts` is 97 lines, no persistence |
| Clearer boundaries between router, planner, executor, recorder | ❌ Not done | All mixed in AgentLoop |

**v0.4 Readiness:** The codebase is ready for decomposition. AgentLoop.handle() has distinct phases that can be extracted:
1. Intent routing (lines ~206–300)
2. Security assessment (lines ~300–400)
3. Skill workflow setup (lines ~400–700)
4. Provider loop (lines ~1,281–1,500)
5. Tool execution (lines ~954–1,145)
6. Memory promotion (lines ~1,214–1,260)
7. Trajectory recording (scattered)
8. Prompt assembly (lines ~1,870–1,960)

### v0.5 — Run Recorder, Trace Schema, and Evaluation Substrate

| Roadmap Requirement | Current State | Gap |
|---------------------|---------------|-----|
| Structured trajectory recorder | ❌ Not done | 97 lines, no schema, no persistence |
| Trace schema | ❌ Not done | No formal schema defined |
| Tool-call timeline | ❌ Not done | Not separated from session history |
| Decision/event log | ❌ Not done | Events are RuntimeEvent, not structured log |
| Run metadata | ❌ Not done | No run record structure |
| Failure classification | ❌ Not done | No classification system |
| Basic eval runner | ⚠️ Partial | `scripts/eval-substrate.ts` exists but not integrated |
| Regression fixtures | ⚠️ Partial | `evals/tasks/` exists but no runner |
| Run replay skeleton | ❌ Not done | No replay capability |
| Prompt/tool/result capture | ❌ Not done | Not structured |
| Evidence corpus structure | ❌ Not done | No corpus defined |
| Decision observability hooks | ❌ Not done | No hooks for self-evolution |
| Change-manifest skeleton | ❌ Not done | No manifest type defined |
| Golden-flow fixtures | ❌ Not done | No golden flows |
| Constraint-gate skeleton | ❌ Not done | No constraint gates |

**v0.5 Readiness:** v0.4 must complete first. Current trajectory layer is too thin to build on.

### v0.6 — Memory, Dependency Graph, and Knowledge Graph

| Roadmap Requirement | Current State | Gap |
|---------------------|---------------|-----|
| Memory store | ✅ Exists | `memory-store.ts`, `local-memory-provider.ts` |
| Memory promotion rules | ✅ Exists | `memory-promotion.ts` |
| Memory renderer | ✅ Exists | `memory-renderer.ts` |
| Memory inspection/edit/delete | ⚠️ Partial | `memory-tool.ts` exists but limited |
| Project knowledge graph | ❌ Not done | No graph structure |
| Code dependency graph | ❌ Not done | No code analysis integration |
| Session search | ⚠️ Partial | `session-db.ts` has search but not semantic |
| Artifact-to-memory pipeline | ❌ Not done | No pipeline |
| Memory provenance | ⚠️ Partial | `MemoryPromotionRecord` exists but not comprehensive |
| Memory freshness/staleness | ❌ Not done | No freshness handling |
| Memory promotion trace links | ❌ Not done | No link to trajectory |
| Memory rendering eval fixtures | ❌ Not done | No evals |

**v0.6 Readiness:** Memory foundation exists but knowledge graph and dependency graph are missing.

### v0.7 — Skill Evolution, Curator, and Governed Self-Improvement

| Roadmap Requirement | Current State | Gap |
|---------------------|---------------|-----|
| Skill usage telemetry | ✅ Exists | `skill-usage-telemetry.ts` |
| skill.observe | ⚠️ Partial | Telemetry exists but no formal observe API |
| skill.propose_patch | ✅ Exists | `skill-evolution.ts` |
| skill.list_proposals | ✅ Exists | `skill-curator-status.ts` |
| skill.review_proposals | ✅ Exists | `skill-evolution.ts` |
| skill.approve_patch | ✅ Exists | `skill-evolution.ts` |
| skill.reject_patch | ✅ Exists | `skill-evolution.ts` |
| skill.promote_patch | ✅ Exists | `skill-evolution.ts` |
| Local working copies for bundled skills | ✅ Exists | `skill-bundled-sync.ts` |
| External skills read-only | ✅ Exists | `skill-loader.ts` handles `external` source kind |
| Skill evals | ❌ Not done | No skill-specific evals |
| Skill versioning | ⚠️ Partial | `SkillLifecycleState` exists but no version tracking |
| Curator status/run/promote/archive | ⚠️ Partial | `skill-curator-status.ts` is 100 lines |
| Evidence-backed skill patch manifests | ⚠️ Partial | Proposals have evidence fields but no formal manifest |
| Tool-description improvement proposals | ❌ Not done | Not supported |
| Routing-metadata improvement proposals | ❌ Not done | Not supported |
| Human-review promotion gates | ✅ Exists | `skill-mutation-policy.ts` + approval controller |

**v0.7 Readiness:** Strong foundation. Skill evolution infrastructure exists but needs formal manifests and eval integration.

### v0.8 — Durable TaskFlow

| Roadmap Requirement | Current State | Gap |
|---------------------|---------------|-----|
| Flow state machine | ❌ Not done | No TaskFlow implementation |
| Step states | ❌ Not done | No step state management |
| Wait/resume/cancel | ⚠️ Partial | Cancel via AbortSignal; resume is limited |
| Child tasks | ❌ Not done | No child task support |
| Flow persistence | ❌ Not done | No flow persistence |
| Human approval gates | ✅ Exists | `workspace-approval-controller.ts` |
| Retry policy | ❌ Not done | No retry logic |
| Failure states | ❌ Not done | No failure state machine |
| Flow replay after restart | ❌ Not done | No replay |
| Artifact linkage | ❌ Not done | Artifacts are in-memory only |
| Flow-to-run recorder integration | ❌ Not done | No integration |

**v0.8 Readiness:** No TaskFlow exists. Must build from scratch.

### v0.9 — Channels, Automations, and Operators

| Roadmap Requirement | Current State | Gap |
|---------------------|---------------|-----|
| Telegram gateway | ✅ Exists | `telegram-adapter.ts`, `channel-gateway.ts` |
| User-scope pairing | ⚠️ Partial | `channel-session-store.ts` exists |
| Notification routing | ⚠️ Partial | Gateway handles routing |
| Cron runner | ✅ Exists | `cron-runner.ts` |
| Scheduled task store | ✅ Exists | `cron-store.ts` |
| Channel permissions | ✅ Exists | `channel-approval-store.ts` |
| Operator commands | ⚠️ Partial | Slash commands exist but limited |
| CLI status view | ❌ Not done | No status view |
| Channel-specific safety rules | ⚠️ Partial | General safety applies |

**v0.9 Readiness:** Good foundation. Telegram and cron exist. Need status view and enhanced safety.

### v0.10 — Distribution, Trusted Extension, Evolution Pipeline

| Roadmap Requirement | Current State | Gap |
|---------------------|---------------|-----|
| Plugin/capability interface skeleton | ❌ Not done | `capability-setup.ts` is 42-line stub |
| External skill packs | ⚠️ Partial | External skill loading exists |
| Capability manifest | ❌ Not done | No manifest type |
| Permission manifest | ⚠️ Partial | `SkillPermissionExpectation` exists in contracts |
| Skill provenance | ✅ Exists | `SkillProvenance` type exists |
| Sandbox policy | ❌ Not done | No sandbox |
| Capability eval hooks | ❌ Not done | No hooks |
| External evolution pipeline | ❌ Not done | No pipeline |
| Change-manifest spec | ❌ Not done | No spec |
| Trace export format | ❌ Not done | No format |
| Install/verify flow | ❌ Not done | No flow |
| Public docs | ✅ Exists | README, AGENTS, CONTRIBUTING, SECURITY |
| Security model | ✅ Exists | `SECURITY.md` |
| Contributor workflows | ✅ Exists | `CONTRIBUTING.md`, `.github/` |

**v0.10 Readiness:** Many v0.10 items are stubs or missing. Requires v0.4–v0.9 to complete first.

## Sequencing Risks

1. **v0.4 blocks v0.5:** Cannot build trace schema on a monolithic agent loop.
2. **v0.5 blocks v0.6–v0.7:** Memory promotion trace links and skill evals need trajectory.
3. **v0.6 blocks v0.7:** Knowledge graph may inform skill evolution evidence.
4. **v0.4–v0.7 block v0.8:** TaskFlow needs clean runtime boundaries.
5. **v0.8 blocks v0.9:** Channels need durable flows for complex automations.

## Current Boundaries
- **Alignment is strongest** in skills (v0.7) and channels (v0.9).
- **Alignment is weakest** in runtime (v0.4), trajectory (v0.5), and TaskFlow (v0.8).

## Evidence Status
- ✅ All roadmap items are mapped to current files.
- ✅ Gaps are explicitly identified.
- ✅ Sequencing risks are documented.
- ❌ No formal gap scoring or effort estimation.

## Open Questions
1. Should v0.4 be split into v0.4a (planner/executor/recorder) and v0.4b (provider/intent extraction)?
2. Can v0.5 trace schema be drafted before v0.4 completes?
3. Is TaskFlow (v0.8) required for MVP, or can it be v0.8.x?

## Recommended Follow-Up Areas
- Draft trace schema NOW to guide v0.4 decomposition.
- Prioritize v0.4 decomposition over all other work.
- Define TaskFlow scope — is it MVP-critical or post-MVP?
