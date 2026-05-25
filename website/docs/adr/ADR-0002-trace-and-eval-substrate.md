---
title: ADR-0002 Trace and Eval Substrate
description: Structured trajectory recording and deterministic eval fixtures as evidence infrastructure.
sidebar_position: 2
---

# ADR-0002: Trace and Eval Substrate as Evidence Infrastructure

**Status:** Accepted
**Date:** 2026-05-03
**Scope:** Runtime, observability, testing

---

## Context

Before v0.5, execution was opaque. There was no structured record of what the agent planned, what tools it called, what failed, or why. This blocked debugging, regression detection, and future self-evolution.

## Decision

Every run produces a structured trajectory with:

- 32 event kinds
- Timestamped tool calls tied to context
- Failure classification (13 classes)
- Decision/event log
- Safe redaction of secrets

Eval fixtures run deterministically against known scenarios. The eval runner is the regression gate for skill evolution proposals.

## Rejected alternatives

1. **Log-only tracing** — Rejected. Unstructured logs are not queryable or linkable.
2. **External observability platform** — Rejected. Local-first requirement.
3. **Unit tests as primary safety net** — Rejected. Too much code churn pre-MVP; eval fixtures are cheaper.

## Consequences

- `TrajectoryRecorder` and `SQLiteSessionDB` are the persistence layer.
- `estacoda trace` CLI provides inspection.
- Eval fixtures grow with each subsystem.
- Smoke tests remain broad; evals become focused.

## Operational impact

**What boundary it creates:**
- Every execution leaves a queryable record. If something went wrong, the record exists.
- Eval fixtures define the minimum acceptable behavior. A subsystem without eval coverage has no regression safety net.

**What files, commands, and subsystems it affects:**
- `estacoda trace list` — list recent trajectories
- `estacoda trace dump <id>` — full trajectory JSON
- `estacoda trace timeline <id>` — chronological human-readable events
- `estacoda trace failures <id>` — classified failures
- `estacoda eval [fixture-id]` — run deterministic eval fixtures
- `src/runtime/trajectory-recorder.ts` — event capture
- `src/session/sqlite-session-db.ts` — persistence layer

**What maintainers must preserve:**
- Event kinds must remain stable. Renaming or removing event kinds breaks historical queryability.
- Secret redaction must apply to all trajectory output paths. `--raw` bypasses redaction; use it with care.
- Eval fixtures must remain deterministic. Non-deterministic fixtures create false regression signals.

**What failure or drift it prevents:**
- Unobservable failures where the agent fails silently and no record exists.
- Skill evolution proposals that pass review but fail on known scenarios.
- Secret leakage into trajectory storage.

**What is intentionally outside the decision:**
- Real-time trajectory streaming to external systems. Trajectories are local-first.
- Automatic anomaly detection on trajectories. Analysis is operator-initiated.
- Visual timeline rendering. The CLI outputs text; visualization is downstream.

## Related docs

- [CLI Commands](../reference/cli-commands.md)
- [ADR-0001: Skill Evolution Governance](./ADR-0001-skill-evolution-governance.md)
