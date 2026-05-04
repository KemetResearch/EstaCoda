---
title: "Operator Controls"
description: "Slash commands and CLI commands for controlling TaskFlow, gateway, cron, sessions, and channels."
---

# Operator Controls

## TaskFlow Commands

### In-Session Slash Commands

Available when TaskFlow is wired (requires SQLite session persistence):

- `/flow status [flowId]` — Show flow status, progress, pending approvals, elapsed time, and available actions.
- `/flow pause <flowId> [reason]` — Request pause at next safe boundary.
- `/flow resume <flowId>` — Resume a paused, interrupted, or waiting flow.
- `/flow interrupt <flowId> [reason]` — Interrupt immediately; terminates active processes.
- `/flow cancel <flowId> [reason]` — Cancel flow; terminal state.
- `/flow steer <flowId> <guidance>` — Inject operator guidance for next turn.
- `/flow approve <stepId>` — Approve a pending approval gate.
- `/flow reject <stepId> [reason]` — Reject a pending approval gate.
- `/flow retry <stepId>` — Retry a failed step (if idempotent or safeToRetry).
- `/flow skip <stepId> [reason]` — Skip a pending skippable step.
- `/flow checkpoint <flowId> <name>` — Create a named checkpoint.
- `/flow trace [flowId] [limit]` — Show event timeline.
- `/flow compact <flowId>` — Run manual compaction.
- `/flow set <flowId>` — Set active flow for this session.
- `/flow unset` — Clear active flow.

If `flowId` is omitted for `status` and `trace`, the active flow is used.

### Top-Level CLI Commands

```bash
estacoda flow list                          # List active flows
estacoda flow show <flowId>                 # Show flow details and steps
estacoda flow status <flowId>               # Show formatted status
estacoda flow trace <flowId> [limit]        # Show event trace
estacoda flow pause <flowId> [reason]       # Request pause
estacoda flow resume <flowId>               # Resume flow
estacoda flow interrupt <flowId> [reason]   # Interrupt flow
estacoda flow cancel <flowId> [reason]      # Cancel flow
estacoda flow steer <flowId> <instruction>  # Inject guidance
estacoda flow approve <stepId>              # Approve gate
estacoda flow reject <stepId> [reason]      # Reject gate
estacoda flow retry <stepId>                # Retry step
estacoda flow skip <stepId> [reason]        # Skip step
estacoda flow checkpoint <flowId> <name>    # Create checkpoint
estacoda flow compact <flowId>              # Compact events
```

## Gateway Operator Commands

### Status and Diagnostics

```bash
estacoda gateway status       # Full gateway status
estacoda gateway diagnose     # Per-channel readiness check
```

`gateway status` surfaces:
- Process state (CLI view)
- All configured channels (Telegram, Discord, Email, WhatsApp) with ready/configured/disabled state
- DeliveryRouter platforms
- Active surface pointers
- Pending approvals count
- Cron job summary
- Recent cron failures (last 5)
- Recent delivery errors (last 5)
- Missing config/env warnings

`gateway diagnose` checks:
- Telegram token presence, allowed users/chats
- Discord token presence
- Email IMAP/SMTP hosts, username, password, ownAddress, homeAddress
- WhatsApp experimental gate, Baileys availability, auth dir writable
- Cron directory permissions (jobs file readable, output/lock dirs writable)

Returns exit code 1 if any warnings exist.

### Channel Commands

```bash
estacoda channels list              # Compact table of all channels
estacoda channels status telegram   # Detailed Telegram status
estacoda channels status discord    # Detailed Discord status
estacoda channels status email      # Detailed Email status
estacoda channels status whatsapp   # Detailed WhatsApp status
```

Channel status shows:
- Enabled/disabled state
- Token/credential presence
- Allowlist configuration
- Surface pointers attached to the channel
- WhatsApp experimental gate status (for WhatsApp)
- Email home/default address (for Email)

## Cron Operator Commands

```bash
estacoda cron list                    # List all jobs
estacoda cron show <job-id>           # Job detail with recent executions
estacoda cron history [job-id]        # Execution history
estacoda cron run <job-id>            # Request a run
estacoda cron pause <job-id>          # Pause job
estacoda cron resume <job-id>         # Resume job
estacoda cron remove <job-id>         # Delete job
```

`cron list` shows: id, schedule, status, next run, prompt summary.

`cron show` shows: job config + last 5 executions with status and timestamps.

`cron history` shows: execution records with status, failure class/message where applicable.

`cron run` sets `runRequested=true` on the job. The next tick will execute it.

## Session Operator Commands

```bash
estacoda sessions list                                # Recent sessions with attached surfaces
estacoda sessions show <session-id>                   # Session detail + surface pointers
estacoda sessions current                             # Current runtime session
estacoda sessions attach <surface> <id> <session-id>  # Attach surface to session
estacoda sessions detach <surface> <id>               # Detach surface from session
```

Valid surfaces: `cli`, `telegram`, `discord`, `whatsapp`, `email`.

Sessions are **separate by default**. A CLI session and a channel session for the same user do not share context automatically. Explicit attach/detach is required.

## Channel Slash Commands

Available in Telegram gateway (and applicable Discord/WhatsApp where supported):

- `/status` — show current session and channel status
- `/sessions` — list recent sessions
- `/switch <session-id>` — switch to a different session
- `/attach <code>` — attach to a CLI session via handoff code
- `/detach` — detach from current session and create a new one
- `/new` — create a new session
- `/reset` — reset current session
- `/cron` — list cron jobs
- `/approvals` — show pending approvals
- `/stop` — stop the gateway

## /steer Semantics

`/steer` and `/flow steer` record an `OperatorEvent` with `kind: "operator-steered"`. The event is **unconsumed** until the adapter processes the next turn.

On the next adapter turn:
1. All unconsumed steer events are loaded.
2. Guidance is prefixed to the user text in a structured block:
   ```
   --- OPERATOR GUIDANCE (eventIds: <id1>, <id2>) ---
   1. <guidance 1>
   2. <guidance 2>
   --- END OPERATOR GUIDANCE ---
   
   <original user text>
   ```
3. Events are marked `consumedAt`, `consumedByStepId`, `consumedByRunId`.
4. Consumption is visible in `/flow trace`.

Steer is rejected for flows in terminal states.

## /compact and Automatic Compaction

**Manual:** `/flow compact <flowId>` or `estacoda flow compact <flowId>` triggers compaction immediately if at a safe boundary.

**Automatic:** Disabled by default. Enable by passing a custom `CompactionConfig` to `FlowCompactionService`:

```typescript
{
  enabled: true,
  mode: "conservative",
  eventThreshold: 50,
  minTurnsBeforeCompact: 3
}
```

Auto-compaction checks the boundary at the end of each adapter turn. It only runs when:
- no active processes,
- no active steps,
- no pending approvals,
- event count ≥ threshold,
- completed steps ≥ minTurnsBeforeCompact.

Compaction creates a `CompactSummary` and appends `compacted` / `operator-compacted` events. Original events are preserved.

## Process Ownership

On `/interrupt` and `/cancel`, the dispatcher:
1. Lists active processes for the flow.
2. Sends `SIGTERM` with 5s timeout to each.
3. Records `process-exited` or `process-orphaned` events.
4. Then transitions the flow state.

Process cleanup results are visible in `/flow status` and `/flow trace`.

## Approval Gates

Approval gates are created by the security layer when a tool call requires explicit approval. Gates have:
- `status`: `pending` | `approved` | `rejected`
- `riskClass`: `low` | `medium` | `high` | `critical`
- `toolName`, `targetKey`, `targetSummary`
- `controllerGrantId`: links to the runtime approval system
- `toolExecutorDecision`: `approve` | `reject` | `ask`
- `deterministicRule`: which rule triggered the gate

`/flow approve` and `/flow reject` resolve gates and emit `OperatorEvent` records.

## Retry and Skip Safety Rules

**Retry:**
- Only if `idempotent` or `safeToRetry` is true.
- Only if `retryCount < maxRetries`.
- Creates a new step linked via `retryOfStepId`.

**Skip:**
- Only if `failurePolicy.allowSkipIfSkippable` is true.
- Only if the step has not started (`startedAt` is null).
- A step that has started must be interrupted or cancelled.
