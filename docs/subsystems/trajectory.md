---
title: "Trajectory & Observability"
description: "Trajectory recording, event kinds, and current observability gaps."
---

# Trajectory & Observability

## Current State

Trajectory recording exists as a **contract and a skeleton**. The implementation is 97 lines and in-memory only.

## Files

| File | Lines | Role |
|------|-------|------|
| `src/contracts/trajectory.ts` | 60 | Event kinds and type definitions |
| `src/trajectory/trajectory-recorder.ts` | 97 | In-memory event recorder |

## Event Kinds

The contract defines 32 event kinds:

| Category | Events |
|----------|--------|
| Session | `session-start`, `session-end` |
| Input | `user-input`, `context-expanded` |
| Skills | `skill-selected`, `skill-workflow-planned`, `skill-workflow-step`, `skill-route-usage`, `skill-route-telemetry`, `skill-lifecycle-changed` |
| Tools | `tool-plan`, `tool-call`, `tool-gated`, `tool-result` |
| Provider | `provider-completion`, `provider-continuation`, `provider-iteration`, `provider-budget-exhausted` |
| Memory | `memory-write`, `memory-conclusion` |
| Security | `security-risk-escalated` |
| Artifacts | `artifact-created` |
| Delegation | `delegation-started`, `delegation-finished` |
| Prompt | `prompt-assembled`, `session-history-packed` |
| Progress | `progress`, `fallback`, `assistant-output`, `user-correction` |
| Cancel | `agent-cancelled` |

## TrajectoryRecorder

```typescript
class TrajectoryRecorder {
  record(kind: TrajectoryEventKind, data: Record<string, unknown>): TrajectoryEvent;
  complete(outcome: Trajectory["outcome"]): Trajectory;
  snapshot(): Trajectory;
  compress(): CompressedTrajectory;
}
```

**Features:**
- Records events with timestamp and ID
- Completes with success/failure outcome
- Compresses to summary + preserved event IDs

**Gaps:**
- No persistence
- No structured trace schema
- No tool-call timeline separation
- No decision/event log
- No run metadata
- No failure classification
- No replay capability

## ArtifactStore

**File:** `src/artifacts/artifact-store.ts`
**Size:** 56 lines

Stores artifact records in memory with `artifact://<id>` prompt-safe references.

**Gaps:**
- No persistence
- No linkage to trajectory events
- No artifact lineage

## v0.5 Targets

| Target | Current | Needed |
|--------|---------|--------|
| Structured trajectory recorder | 97-line skeleton | Persistent store, schema validation |
| Trace schema | Contract only | Formal schema doc + types |
| Tool-call timeline | Mixed with session history | Separated timeline per run |
| Decision/event log | RuntimeEvent only | Structured decision log |
| Run metadata | None | Run record with config snapshot |
| Failure classification | None | Coarse classification |
| Basic eval runner | Script scaffold | Integrated runner |
| Regression fixtures | Task files exist | Runner + scoring |
| Run replay | None | Replay skeleton |
| Evidence corpus | None | Corpus structure |
| Change-manifest skeleton | None | Manifest type |
