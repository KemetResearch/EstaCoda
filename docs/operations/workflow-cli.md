---
title: "Workflow CLI"
description: "Command reference for the estacoda workflow CLI namespace."
---

# Workflow CLI Reference

## Entry Point

```bash
estacoda workflow <subcommand> [args...]
```

## Commands

### list

List all active (non-terminal) workflow runs.

```bash
estacoda workflow list
```

Output columns: `runId`, `status`, `age`, `sessionId`

### show

Show workflow run details including steps.

```bash
estacoda workflow show <runId>
```

### status

Show formatted status view with progress, pending approvals, and available actions.

```bash
estacoda workflow status <runId>
```

### trace

Show chronological event timeline.

```bash
estacoda workflow trace <runId> [limit]
```

- `limit`: optional integer; limits to most recent N events.

### pause

Request pause at next safe boundary.

```bash
estacoda workflow pause <runId> [reason]
```

### resume

Resume a paused, interrupted, or waiting workflow run.

```bash
estacoda workflow resume <runId>
```

### interrupt

Interrupt immediately. Terminates active processes.

```bash
estacoda workflow interrupt <runId> [reason]
```

### cancel

Cancel workflow run. Terminal state.

```bash
estacoda workflow cancel <runId> [reason]
```

### steer

Inject operator guidance into a workflow run.

```bash
estacoda workflow steer <runId> <instruction>
```

Guidance appears in the next turn prefixed as `OPERATOR GUIDANCE`.

### approve

Approve a pending approval gate.

```bash
estacoda workflow approve <stepId>
```

### reject

Reject a pending approval gate.

```bash
estacoda workflow reject <stepId> [reason]
```

### retry

Retry a failed step.

```bash
estacoda workflow retry <stepId>
```

Only works if the step is idempotent or safeToRetry, and under maxRetries.

### skip

Skip a pending skippable step.

```bash
estacoda workflow skip <stepId> [reason]
```

Only works if the step has not started and `allowSkipIfSkippable` is true.

### checkpoint

Create a named checkpoint.

```bash
estacoda workflow checkpoint <runId> <name>
```

### compact

Summarize workflow events if at a safe boundary.

```bash
estacoda workflow summarize <runId>
```

## Requirements

All `estacoda workflow` commands require SQLite session persistence. If the runtime uses an in-memory session DB, commands will fail with a message indicating Workflow requires SQLite.

## Exit Codes

- `0`: success
- `1`: error (workflow run not found, invalid arguments, command rejected)
