---
title: ADR-0003 Advisory Skills vs TaskFlow
description: Markdown-first advisory skills and durable enforced orchestration via TaskFlow.
sidebar_position: 3
---

# ADR-0003: Advisory Skills vs Durable TaskFlow Boundary

**Status:** Accepted
**Date:** 2026-05-03
**Scope:** Skills, workflows, runtime

---

## Context

Skills teach workflows through Markdown instructions. Some workflows need guarantees (shipping, deployment, payments). Others need flexibility (research, architecture, debugging). A single model cannot serve both needs well.

## Decision

Skills remain **Markdown-first and advisory** by default:

```yaml
workflowMode: advisory
```

The skill teaches the agent a good workflow. The agent decides how to apply it.

**Enforced workflows** exist for high-value operational flows:

```yaml
workflowMode: enforced
```

Enforced workflows need:

- Step state
- Dependency resolution
- Failure handling
- Resume behavior
- Cancellation
- Approval gates
- Artifact recording
- Validation hooks

The split:

- Skill template = authoring surface
- Workflow schema = runtime interpretation layer
- Tool planner = dependency-aware execution
- TaskFlow = durable enforced orchestration

## Rejected alternatives

1. **All skills as rigid mini-programs** — Rejected. Kills flexibility for judgment-heavy tasks.
2. **No enforcement at all** — Rejected. Unsafe for operational workflows.
3. **Skill-level enforcement only** — Rejected. Enforcement belongs in runtime, not authoring.

## Consequences

- v0.7 supports advisory skill workflows.
- v0.8 introduces TaskFlow for durable enforced orchestration.
- Skills do not become a programming language.

## Operational impact

**What boundary it creates:**
- Advisory skills provide guidance without guaranteeing execution order. The agent may skip, reorder, or reinterpret steps.
- Enforced workflows execute through TaskFlow, which records every step, enforces transitions, and blocks illegal state changes.

**What files, commands, and subsystems it affects:**
- `estacoda skills list` — browse available skills
- `estacoda skills view <name>` — read full SKILL.md content
- `estacoda flow` — TaskFlow operator commands
- `src/skills/skill-loader.ts` — skill parsing and validation
- `src/taskflow/` — durable orchestration engine
- `src/tools/tool-call-planner.ts` — dependency-aware execution planning

**What maintainers must preserve:**
- The advisory/enforced boundary must remain explicit. A skill that claims `advisory` must never be silently upgraded to `enforced` behavior.
- TaskFlow state transitions must remain strict. Illegal transitions throw `IllegalTransitionError`; relaxing this corrupts execution guarantees.
- Skill templates must stay Markdown-first. Turning skills into a DSL would violate the decision.

**What failure or drift it prevents:**
- Over-constraining judgment-heavy tasks by forcing rigid step order.
- Under-constraining operational workflows by allowing the agent to skip safety steps.
- Skill bloat where every workflow tries to be both advisory and enforced simultaneously.

**What is intentionally outside the decision:**
- Automatic workflow mode selection. The skill author chooses the mode.
- Visual workflow builder. Authoring remains text-based.
- Cross-skill workflow composition. A flow belongs to a single skill or explicit composition layer.

## Related docs

- [Skills](../user-guide/skills.md)
- [TaskFlow CLI](../reference/cli-commands.md)
- [ADR-0006: TaskFlow State Machine](./ADR-0006-taskflow-state-machine.md)
