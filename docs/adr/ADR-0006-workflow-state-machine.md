# ADR-0006: Workflow State Machine and Durable Execution

**Status:** Accepted  
**Date:** 2026-05-04  
**Scope:** Workflow engine, operator control plane, runtime integration

## Context

Agent sessions previously had no structured multi-step execution model. A single crash or restart lost all in-progress work. There was no way to:
- pause a long-running task at a safe boundary,
- resume after a process restart,
- observe step-level progress,
- or inject operator guidance mid-run without mutating the prompt directly.

## Decision

1. **Introduce a durable Workflow state machine** with explicit workflow run and step lifecycles.
2. **Persist all state in SQLite** alongside session data, using the same `SQLiteSessionDB`.
3. **Lock workflow runs during execution** to prevent concurrent mutation.
4. **Make the state machine strict**: illegal transitions throw `IllegalTransitionError`.
5. **Operator commands are first-class events**, auditable and traceable.
6. **Steer guidance is explicit prefixing**, not hidden prompt mutation.
7. **Workflow event summaries are additive and safe-boundary only**; original events are never deleted.
8. **Restart recovery runs automatically** on runtime startup.
9. **AgentLoop remains Workflow-agnostic**; integration happens through an adapter layer.

## State Model

### Workflow run states

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

## Rejected Alternatives

1. **In-memory workflow run state only** — Rejected: crashes lose all progress.
2. **Loose state transitions** — Rejected: silent state corruption is worse than explicit errors.
3. **Hidden steer injection** — Rejected: not auditable, breaks reproducibility.
4. **Workflow event summaries that delete events** — Rejected: destroys audit trail.
5. **Workflow-aware AgentLoop** — Rejected: couples two layers that should evolve independently.

## Consequences

- `SQLiteSessionDB` now manages schema versioning (v1–v3) for Workflow tables.
- `createRuntime` wires Workflow subsystems only when `sessionDb instanceof SQLiteSessionDB`.
- Operator commands require SQLite persistence; in-memory sessions do not support Workflow.
- Workflow lock expiry prevents orphaned locks; stale lock recovery runs on startup.
- Every operator action produces an `OperatorEvent` with `previousState` / `newState`.

## What v0.8 does not do

- No automatic workflow run scheduling or cron integration.
- No visual workflow builder.
- No cross-session workflow run sharing.
- No distributed lock service (single-process SQLite only).
- No automatic retry without operator invocation.
- No checkpoint rollback (checkpoints are recorded but not restorable in v0.8).
