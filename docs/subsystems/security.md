---
title: "Security"
description: "Security model: policy, approvals, trust, and command safety."
---

# Security

EstaCoda uses a capability-first security model where tool risk classes, approval modes, and workspace trust work together to bound agent behavior.

## Files

| File | Lines | Role |
|------|-------|------|
| `src/security/security-policy-factory.ts` | ~180 | Create policy for approval mode |
| `src/security/workspace-trust-store.ts` | ~160 | Persist workspace trust grants |
| `src/security/workspace-approval-controller.ts` | ~240 | Manage approval grants and scopes |
| `src/security/command-safety.ts` | ~200 | Command classification and hard floor |
| `src/contracts/security.ts` | ~120 | Security types and defaults |

## Approval Modes

| Mode | Behavior | Evidence |
|------|----------|----------|
| `strict` | Ask for approval on almost all tool executions | `smoke-tested` |
| `adaptive` | Deterministic triage first, then optional auxiliary assessor for ambiguous cases | `smoke-tested` |
| `open` | Minimal gating, but hard floor still applies | `smoke-tested` |

Default: `adaptive`

## Tool Risk Classes

| Class | Examples | Gating |
|-------|----------|--------|
| `safe` | File reads, web search | None |
| `caution` | File writes, edits | Adaptive or strict |
| `external-side-effect` | Network POSTs, external APIs | Usually gated |
| `irreversible` | Deletes, deployments, sends | Always gated |

## Hard Floor

The unconditional hard floor covers:

- Broad/root-like recursive deletes
- Destructive disk operations
- Shutdown/reboot commands
- Fork-bomb or kill-all patterns
- Explicit secret reads
- Pipe-to-interpreter installs
- Git force-pushes

`/yolo` is a session-scoped toggle for `open` mode but **cannot bypass the hard floor**.

## Approval Scopes

| Scope | Duration |
|-------|----------|
| `once` | Single execution |
| `session` | Until session ends |
| `always` | Persisted until revoked |

Persistent approvals match on normalized `targetKey` values, including operation type and normalized targets.

## Workspace Trust

- Trusted workspaces allow normal local work to proceed proactively.
- Obvious risk classes still trigger approval logic.
- Trust is persisted per workspace root.

## Security Audit

Interactive CLI sessions expose `/security` and `/security debug` for inspecting recent decisions, target keys, deterministic rule hits, and assessor status.

## Adaptive Assessor

- Defaults to auxiliary `approval` route when enabled without explicit provider/model override.
- Assessor failures, malformed output, or timeouts fall back to `ask`.
