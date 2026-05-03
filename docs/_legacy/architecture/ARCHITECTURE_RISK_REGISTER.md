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
