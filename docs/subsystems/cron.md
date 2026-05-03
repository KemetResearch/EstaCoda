---
title: "Cron & Automation"
description: "Scheduled tasks, cron runner, and job storage."
---

# Cron & Automation

## Files

| File | Lines | Role |
|------|-------|------|
| `src/cron/cron-store.ts` | ~340 | Persistent job storage |
| `src/cron/cron-tools.ts` | ~280 | Agent-facing `cronjob` tool |
| `src/cron/cron-runner.ts` | ~280 | Scheduler tick execution |

## Cron Store

- Persistent storage at `~/.estacoda/cron/jobs.json`
- Atomic writes
- Schedule parsing: relative delays, intervals, cron expressions, ISO timestamps
- Prompt safety scanning
- Optional workspace-local script metadata
- Local output files

## Cron Tool

The agent can manage scheduled tasks via the `cronjob` tool:

| Action | Description |
|--------|-------------|
| `create` | Add a new scheduled task |
| `list` | List all tasks |
| `update` | Modify an existing task |
| `pause` | Pause a task |
| `resume` | Resume a paused task |
| `run` | Execute a task immediately |
| `remove` | Delete a task |

## Cron Runner

- Enforces `.tick.lock` to prevent concurrent ticks
- Runs bounded workspace-contained scripts without shell expansion
- Handles `[SILENT]` prefix
- Delivers origin/Telegram outputs when configured
- Writes wrapped output to `~/.estacoda/cron/output/`

## Gateway Integration

Gateway scheduler ticks run due jobs automatically. Channel turns rebuild from fresh config snapshots, so cron jobs see current MCP and provider state.

## Evidence

- Cron create/list/edit/tick flow: `smoke-tested`
- Schedule parsing: `smoke-tested`
- Prompt safety blocking: `smoke-tested`
- Tick locking: `smoke-tested`
- Gateway command exposure: `smoke-tested`
- Broader channel delivery: `implemented but not live-proven`
