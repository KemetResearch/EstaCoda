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
