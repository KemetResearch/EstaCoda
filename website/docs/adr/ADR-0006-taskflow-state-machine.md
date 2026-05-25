---
title: ADR-0006 TaskFlow State Machine
description: Durable TaskFlow state machine with strict transitions and SQLite persistence.
sidebar_position: 6
---

# ADR-0006: TaskFlow State Machine and Durable Execution

**Status:** Accepted
**Date:** 2026-05-04
**Scope:** TaskFlow engine, operator control plane, runtime integration

---

## Context

Agent sessions previously had no structured multi-step execution model. A single crash or restart lost all in-progress work. There was no way to pause a long-running task at a safe boundary, resume after a process restart, observe step-level progress, or inject operator guidance mid-flow without mutating the prompt directly.

## Decision

1. **Introduce a durable TaskFlow state machine** with explicit flow and step lifecycles.
2. **Persist all state in SQLite** alongside session data, using the same `SQLiteSessionDB`.
3. **Lock flows during execution** to prevent concurrent mutation.
4. **Make the state machine strict**: illegal transitions throw `IllegalTransitionError`.
5. **Operator commands are first-class events**, auditable and traceable.
6. **Steer guidance is explicit prefixing**, not hidden prompt mutation.
7. **Compaction is additive and safe-boundary only**; original events are never deleted.
8. **Restart recovery runs automatically** on runtime startup.
9. **AgentLoop remains TaskFlow-agnostic**; integration happens through an adapter layer.

## State model

### Flow states

- `pending` → `running` | `cancelled`
- `running` → `paused` | `waiting` | `interrupted` | `completed` | `failed` | `cancelled`
- `paused` → `running` | `interrupted` | `cancelled`
- `waiting` → `running` | `interrupted` | `cancelled`
- `interrupted` → `running` | `cancelled`
- `completed`, `failed`, `cancelled` are terminal

### Step states

- `pending` → `running` | `skipped`
- `running` → `completed` | `waiting_for_approval` | `paused` | `failed`
- `paused` → `running`
- `waiting_for_approval` → `running` | `failed`
- `completed`, `failed`, `skipped`, `cancelled` are terminal

### Skip rule

A step may be skipped **only if**:

- `failurePolicy.allowSkipIfSkippable` is true, **and**
- `startedAt` is null (execution has not begun).

A step that has started must be interrupted or cancelled, not skipped.

### Retry rule

A step may be retried **only if**:

- `idempotent` is true or `safeToRetry` is true, **and**
- `retryCount < maxRetries`.

Retry creates a new step record linked via `retryOfStepId`.

## Rejected alternatives

1. **In-memory flow state only** — Rejected. Crashes lose all progress.
2. **Loose state transitions** — Rejected. Silent state corruption is worse than explicit errors.
3. **Hidden steer injection** — Rejected. Not auditable, breaks reproducibility.
4. **Compaction that deletes events** — Rejected. Destroys audit trail.
5. **TaskFlow-aware AgentLoop** — Rejected. Couples two layers that should evolve independently.

## Consequences

- `SQLiteSessionDB` now manages schema versioning (v1–v3) for TaskFlow tables.
- `createRuntime` wires TaskFlow subsystems only when `sessionDb instanceof SQLiteSessionDB`.
- Operator commands require SQLite persistence; in-memory sessions do not support TaskFlow.
- Flow lock expiry prevents orphaned locks; stale lock recovery runs on startup.
- Every operator action produces an `OperatorEvent` with `previousState` / `newState`.

## Operational impact

**What boundary it creates:**
- TaskFlow provides durable execution guarantees only when SQLite session persistence is available. In-memory sessions cannot pause, resume, or recover flows.
- The state machine is strict by design. An illegal transition is an error, not a warning.

**What files, commands, and subsystems it affects:**
- `estacoda flow` — full operator command surface
- `estacoda flow status` — observe step-level progress
- `estacoda flow pause/resume/interrupt/cancel` — lifecycle control
- `estacoda flow steer` — explicit operator guidance injection
- `src/taskflow/` — state machine and execution engine
- `src/session/sqlite-session-db.ts` — schema versioning and persistence
- `src/runtime/create-runtime.ts` — conditional TaskFlow wiring

**What maintainers must preserve:**
- Schema migrations must remain reversible. TaskFlow tables are versioned; downgrades must be possible.
- Lock expiry must remain short enough to prevent indefinite stalls, long enough to tolerate slow steps.
- The AgentLoop must stay TaskFlow-agnostic. Adding TaskFlow awareness to the core loop violates the adapter boundary.

**What failure or drift it prevents:**
- Progress loss on crash or restart.
- Silent state corruption from illegal transitions.
- Hidden prompt mutation that breaks reproducibility.
- Orphaned locks from crashed processes.

**What is intentionally outside the decision:**
- Automatic flow scheduling or cron integration.
- Visual workflow builder.
- Cross-session flow sharing.
- Distributed lock service (single-process SQLite only).
- Automatic retry without operator invocation.
- Checkpoint rollback (checkpoints are recorded but not restorable in v0.8).

## Related docs

- [CLI Commands](../reference/cli-commands.md)
- [Developer: Runtime](../developer/runtime.md)
- [ADR-0003: Advisory Skills vs TaskFlow](./ADR-0003-advisory-skills-vs-taskflow.md)
