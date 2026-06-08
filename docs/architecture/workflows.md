---
title: "Workflow"
description: "Durable multi-step execution, state machine, and runtime integration."
---

# Workflow Architecture

## Purpose

Workflow provides durable, observable, operator-controllable multi-step execution for agent sessions. A workflow run represents a high-level objective, for example "refactor the auth module." Steps represent discrete actions within that run. State is persisted to SQLite so work survives process restarts.

## When Workflow is active

Workflow is wired into `createRuntime` **only** when `sessionDb` is an `SQLiteSessionDB`. In-memory sessions do not support Workflow.

## Components

### WorkflowEngine

The state machine. Enforces legal transitions, manages workflow run and step lifecycles, and emits events.

Key methods:
- `createWorkflowRun(sessionId, intent)` — creates a workflow run in `pending` state.
- `startWorkflowRun(runId)` — transitions to `running`.
- `requestWorkflowPause(runId, reason)` — requests pause at next safe boundary.
- `resumeWorkflowRun(runId)` — transitions `paused`/`interrupted`/`waiting` to `running`.
- `interruptWorkflowRun(runId, reason)` — immediate interrupt with process cleanup.
- `cancelWorkflowRun(runId, reason)` — terminal cancel with process cleanup.
- `skipStep(stepId, reason)` — skip a pending step (only if not started and skippable).
- `retryStep(stepId)` — create a retry step (only if idempotent/safeToRetry and under maxRetries).
- `createWorkflowCheckpoint(runId, name)` — record a named checkpoint.

### WorkflowStore (SQLiteWorkflowStore)

Persistence layer. All tables use `create table if not exists` and are created via schema migration in `SQLiteSessionDB`.

### WorkflowLockService

Prevents concurrent workflow run mutation. Locks have lease expiry; stale locks are recovered on startup.

### WorkflowProcessRegistry

Tracks external processes (shell commands, browser sessions) linked to steps. On interrupt/cancel, running processes are terminated and results are recorded.

### WorkflowCommandDispatcher

Routes slash commands to engine methods. Every dispatch validates preconditions and returns structured `CommandResult`. All operator actions append `OperatorEvent` records.

### WorkflowEventSummaryService

Summarizes completed workflow events into `WorkflowEventSummary` records. Never deletes original events. Only runs when:
- no active processes,
- no active steps,
- no pending approvals.

Default config: `enabled: false`. Must be explicitly enabled.

### WorkflowAgentLoopAdapter

Bridges Workflow and AgentLoop. Responsibilities:
- Load unconsumed steer events before each turn.
- Prefix steer guidance explicitly (auditable, not hidden).
- Execute turn through AgentLoop.handle().
- Mark steer events consumed with real `trajectoryId` linkage.
- Record artifact and run links.
- Check automatic workflow event summaries at safe boundary.

## Data Model

### WorkflowRun

- `id`, `sessionId`, `status`
- `intent`: the original objective (JSON)
- `currentStepId`: active step
- `createdAt`, `updatedAt`, `completedAt`, `cancelledAt`, `failedAt`
- `pauseRequestedAt`, `pauseReason`
- `checkpointCount`, `stepCount`, `retryCount`
- `compactedAt`


### WorkflowStep

- `id`, `runId`, `index`, `status`, `name`, `description`
- `toolPlans`, `executions`
- `retryPolicy`, `retryCount`, `maxRetries`
- `idempotent`, `safeToRetry`
- `failurePolicy` (includes `allowSkipIfSkippable`)
- `retryOfStepId`, `attemptNumber`
- Timestamps: `startedAt`, `completedAt`, `failedAt`, `cancelledAt`, `pausedAt`, `resumedAt`

### WorkflowEvent

- `id`, `runId`, `stepId`, `kind`, `data`, `timestamp`

Kinds include: `step-started`, `step-completed`, `step-failed`, `step-skipped`, `step-retried`, `pause-requested`, `process-registered`, `process-exited`, `process-orphaned`, `compacted`.

### OperatorEvent

- `id`, `runId`, `stepId`, `kind`, `operator`, `command`, `effect`
- `previousState`, `newState`
- `metadata`, `timestamp`
- `consumedAt`, `consumedByStepId`, `consumedByRunId` — set when steer is consumed by adapter

### Checkpoint

- `id`, `runId`, `stepId`, `name`, `description`, `snapshot` (JSON), `createdAt`, `createdBy`

### ApprovalGate

- `id`, `stepId`, `runId`, `status`
- `requestedAt`, `resolvedAt`, `resolvedBy`
- `reason`, `riskClass`
- `toolName`, `targetKey`, `targetSummary`, `scope`
- `controllerGrantId`, `toolExecutorDecision`, `deterministicRule`

## Runtime Integration

```
Session Loop
    |
    v
Runtime.handle()  <-- /workflow commands set activeRunId
    |
    v
AgentLoop.handle()
    ^
    |
WorkflowAgentLoopAdapter.runTurn()  <-- only when activeRunId is set
    |
    v
WorkflowEngine + Store
```

When `rt.workflow.activeRunId` is set and the workflow run is running, the adapter wraps turns. When no active workflow run is set, AgentLoop runs normally.

## Restart Recovery

On `createRuntime` with SQLite:
1. `WorkflowRestartRecovery.recover()` marks `running` workflow runs as `interrupted`.
2. Marks `running` steps as `interrupted`.
3. Releases stale locks (expired lease).
4. Results are visible via `rt.workflow.recoverFromRestart()`.

## Known Limitations

- Checkpoints are recorded but not restorable in v0.8.
- Workflow runs are scoped to a single session; no cross-session resumption.
- Lock service is single-process SQLite only.
- Automatic workflow event summaries are disabled by default.
- No automatic retry without operator `/retry`.
