---
title: "Architecture Risk Register"
description: "Identified architecture risks, severity, and mitigations."
---

# Architecture Risk Register

| ID | Risk | Severity | Likelihood | Impact | Mitigation | Owner |
|----|------|----------|------------|--------|------------|-------|
| R01 | **AgentLoop monolith blocks v0.4+** | Critical | High | High | Decompose into Router/Planner/Executor/Recorder | v0.4 |
| R02 | **create-runtime god factory** | High | High | Medium | Introduce DI container or builder pattern | v0.4 |
| R03 | **No unit tests** | Critical | High | High | Extract unit tests from smoke; introduce Vitest | v0.4–v0.5 |
| R04 | **Bun lock-in prevents Node deployment** | High | Medium | Medium | Abstract SQLite behind interface | v0.4 |
| R05 | **Trajectory/Artifact are in-memory only** | Medium | High | Medium | Add SQLite persistence | v0.5 |
| R06 | **smoke.ts at 14k lines** | Medium | High | Low | Split into per-subsystem test suites | v0.5 |
| R07 | **Capability trust is a stub** | Medium | Low | High | Design manifest schema before v0.10 | v0.9–v0.10 |
| R08 | **No formal eval runner** | Medium | Medium | Medium | Integrate `scripts/eval-substrate.ts` | v0.5 |
| R09 | **Memory rendering is dump-based** | Medium | Medium | Medium | Add selectivity/ranking | v0.6 |
| R10 | **Provider message content assumes strings** | Low | High | Low | Widen content type support | v0.4 |
| R11 | **AGENTS.md drift** | Low | High | Low | Update project structure map | v0.4 |
| R12 | **Telegram-only channels** | Medium | Low | Medium | Add more channel adapters | v0.9 |
| R13 | **Gateway readiness ≠ liveness** | Low | Medium | Low | Add daemon health checks | v0.9 |
| R14 | **Skill evals are metadata-only** | Medium | Medium | Medium | Add real task fixtures | v0.7 |
| R15 | **OpenRouter exactness issues** | Medium | Medium | Medium | Provider-specific hardening | v0.4 |
| R16 | **MCP HTTP transport unproven** | Low | Low | Low | Operator validation | v0.9 |
| R17 | **Local/Ollama unproven** | Low | Low | Low | Environment-specific testing | v0.9 |
| R18 | **ACP editor polish incomplete** | Low | Medium | Low | Terminal/process rendering | v0.9 |

## Risk Heat Map

| | Low Likelihood | Medium Likelihood | High Likelihood |
|---|----------------|-------------------|-----------------|
| **Critical Severity** | — | — | R01, R03 |
| **High Severity** | R04 | — | R02 |
| **Medium Severity** | R07, R12 | R08, R09, R14, R15 | R05, R06 |
| **Low Severity** | R16, R17 | R13, R18 | R10, R11 |

## Mitigation Status

- **Completed:** R01 (AgentLoop decomposed from 2,714 → 809 lines), R11 (AGENTS.md updated)
- **In progress:** R02 (assessment completed; builder deferred to v0.5+), R15
- **Partial:** R10
- **Accepted:** R03 (deferred to v0.5), R04 (deferred), R05 (deferred to v0.5), R06 (deferred to v0.5), R07 (deferred), R08 (deferred to v0.5), R09 (deferred to v0.6), R12 (deferred), R13 (deferred), R14 (deferred to v0.7), R16 (deferred), R17 (deferred), R18 (deferred)
