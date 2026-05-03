---
title: "Handoff Guide"
description: "Project handoff for incoming coding agents and operators."
---

# Handoff Guide

## Repo Snapshot

- **Current branch:** `main`
- **Git status:** Clean before this documentation refresh.
- **Version:** v0.3 (post-v0.3, pre-v0.4)

## Product Goal

EstaCoda v2 is intended to become a production-grade autonomous agent platform with:

- Provider-backed agent loop
- Reusable skill packages as procedural knowledge
- Bounded persistent memory
- Capability-first security and approvals
- Multi-channel delivery (Telegram first)
- Runtime that learns over time without drifting from deterministic operator control

## Current Milestone

**MVP candidate / private internal alpha**

Confirmed working:

| Capability | Evidence |
|------------|----------|
| CLI agent loop | `live-proven` |
| Skill execution | `smoke-tested` |
| Telegram runtime | `live-proven` |
| Telegram approvals/progress/attachments | `smoke-tested` |
| Vision-backed image analysis (Kimi) | `live-proven` |
| Provider matrix (Kimi/OpenAI/DeepSeek) | `live-proven` |
| MCP client (stdio) | `live-proven` |
| ACP foundation | `live-proven` |
| Cron foundation | `smoke-tested` |
| Browser automation (local CDP) | `smoke-tested` |
| First-run onboarding (EN/AR) | `live-proven` |

## Architecture Overview

### Main Systems

| System | Entrypoint | Role |
|--------|-----------|------|
| Boot | `src/index.ts` | Config, onboarding, dispatch |
| Runtime | `src/runtime/create-runtime.ts` | Composition root |
| Agent Loop | `src/runtime/agent-loop.ts` | Core turn orchestration |
| CLI | `src/cli/cli.ts` | Command surface |
| Gateway | `src/channels/gateway-runner.ts` | Telegram gateway |

### Key Subsystems

See [Subsystems](../subsystems/) for deep dives.

### Critical Debt

1. **AgentLoop monolith** — 2,714 lines. v0.4 target.
2. **No unit tests** — 14k-line smoke.ts only.
3. **Bun lock-in** — `bun:sqlite` prevents Node execution.
4. **Trajectory/Artifact skeletons** — in-memory only.

## Evidence Labels

| Label | Meaning |
|-------|---------|
| `live-proven` | Real operator run |
| `smoke-tested` | `src/smoke.ts` |
| `implemented but not live-proven` | Code exists, no fresh proof |
| `intended but not implemented` | Design target only |

## Standard Validation

```bash
bun run typecheck
bun run smoke
```

## Security-Sensitive Areas

Treat as high scrutiny:

```
src/security/
src/tools/
src/channels/
src/skills/
src/memory/
src/config/
skills/
optional-skills/
install scripts
release scripts
```

## Next Engineering Priority

**v0.4: Agent-Loop Decomposition**

This is the highest-risk, highest-priority run. Without it, v0.5–v0.10 cannot proceed safely.

See [Decomposition Targets](../architecture/decomposition-targets.md) for the plan.
