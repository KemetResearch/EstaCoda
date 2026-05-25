---
title: ADR-0001 Skill Evolution Governance
description: Governed skill evolution with review-gated promotion.
sidebar_position: 1
---

# ADR-0001: Governed Skill Evolution and Review-Gated Promotion

**Status:** Accepted
**Date:** 2026-05-03
**Scope:** Skills, evolution, security

---

## Context

EstaCoda improves skills from usage and failure evidence. Silent self-mutation is dangerous. Observability and evidence make controlled improvement possible, but only when every change passes explicit review.

## Decision

Skill evolution follows a governed loop with explicit review gates:

```text
observe → propose → review → approve/reject → promote → rollback
```

Every proposal carries a `ChangeManifest` with:

- Hypothesis
- Predicted impact
- Risk level
- Eval plan
- Constraint gates
- Rollback plan

Promotion requires explicit approval or configured policy. Failing eval gates block promotion. The runtime never silently rewrites itself.

## Rejected alternatives

1. **Auto-promotion after eval pass** — Rejected. Removes human review for high-risk changes.
2. **Direct skill mutation without manifest** — Rejected. No evidence trail, no rollback.
3. **External-only evolution pipeline** — Rejected. Runtime must capture evidence locally.

## Consequences

- Proposal and manifest CLI namespaces are top-level (`estacoda proposal`, `estacoda manifest`).
- `SkillProposalService` is the shared implementation layer.
- Tool-description and routing-metadata proposals are supported as manifest targets.
- Auto-proposal generation is deferred to post-v0.7.

## Operational impact

**What boundary it creates:**
- Skills cannot change their own implementation without a manifest, eval run, and explicit approval.
- The runtime rejects any skill mutation that bypasses `SkillProposalService`.

**What files, commands, and subsystems it affects:**
- `estacoda proposal` — create, inspect, and manage evolution proposals
- `estacoda manifest` — inspect manifest files and their `filesChanged` diffs
- `src/skills/skill-proposal-service.ts` — the shared implementation layer
- `src/skills/skill-evolution.ts` — evolution engine
- Eval fixtures act as the regression gate for proposals

**What maintainers must preserve:**
- The manifest schema must remain stable enough that existing proposals remain valid across versions.
- Eval gates must run before promotion. Removing or weakening eval validation breaks the safety model.
- Rollback plans must remain executable. A proposal without a rollback plan is incomplete, not optional.

**What failure or drift it prevents:**
- Silent skill drift where behavior changes without trace.
- Promotion of skills that fail regression evals.
- Loss of evidence when a promoted skill turns out to be worse than the previous version.

**What is intentionally outside the decision:**
- Auto-proposal generation from live usage. This is deferred.
- Automatic rollback on live failure detection. Rollback is operator-initiated.
- Cross-profile skill sharing. Proposals are scoped to the profile that created them.

## Related docs

- [Skills](../user-guide/skills.md)
- [CLI Commands](../reference/cli-commands.md)
- [ADR-0002: Trace and Eval Substrate](./ADR-0002-trace-and-eval-substrate.md)
