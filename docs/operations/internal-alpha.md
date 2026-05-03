---
title: "Internal Alpha Runbook"
description: "Repeatable operator path for testing EstaCoda as a real agent."
---

# Internal Alpha Runbook

This runbook answers three questions on every run:

1. Can we complete core agent flows end to end?
2. Where does the runtime still break or feel rough?
3. Can we capture failures cleanly enough to fix them without guesswork?

## Quick Start

Generate a tracked run folder:

```bash
bun run alpha:harness
```

Creates:
```
.estacoda/internal-alpha-runs/<timestamp>/
  notes.md
  commands.md
  environment.json
  logs/
  failures/
  artifacts/
  reset.sh
```

## Recommended Flow

### 1. Preflight

```bash
bun run typecheck
bun run smoke
bun run dev -- doctor --live
bun run dev -- gateway status
```

### 2. CLI Agent Session

Validate:
- Workspace trust behavior
- File read/write loop
- `/reset`, `/skills`, `/tools`

### 3. Skill Execution

Confirm:
- Skill is visible
- Provider sees the selected procedure
- Result is grounded in tool execution

### 4. Approval-Gated Action

Confirm:
- Request is actually gated
- Approval prompt is understandable
- Action resumes correctly after approval
- Denial produces clean state transition

### 5. Telegram Text Task

Confirm:
- Gateway starts cleanly
- Typing/progress appears
- Reply lands in chat
- Session continuity feels correct

### 6. Telegram Attachment Task

Confirm:
- Download succeeds
- Metadata is preserved
- Right inspection path is used
- Failures are understandable

### 7. Provider Route Checks

```bash
bun run dev -- doctor --live
bun run dev -- --trust "Say hello as EstaCoda and summarize what you can do."
```

Repeat for: Kimi, OpenRouter, Ollama, DeepSeek.

### 8. Failure Capture

For every meaningful failure:
- Save screenshots to `failures/`
- Save terminal transcripts to `logs/`
- Record reproduction steps in `notes.md`
- Record expected vs actual behavior

### 9. Reset / Rollback

```bash
./.estacoda/internal-alpha-runs/<timestamp>/reset.sh
```

## Minimum Bar for "Good Run"

- Preflight passes
- At least one real CLI file-edit task succeeds
- At least one skill run succeeds
- Approval gating works end to end
- Telegram text works
- Telegram attachment works
- At least one provider route passes live
- Failures, if any, are captured cleanly

## Notes on Truthfulness

If something only works in one-shot mode, only works with a trusted workspace, only works in a temp config, or only works in a narrow provider setup, record that plainly. Do not treat it as production-ready.
