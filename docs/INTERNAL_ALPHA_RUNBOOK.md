# EstaCoda V2 Internal Alpha Runbook

This runbook is the repeatable operator path for testing EstaCoda v2 as a real agent, not just as a codebase.

It is designed to answer three questions on every run:

1. Can we complete the core agent flows end to end?
2. Where does the runtime still break or feel rough?
3. Can we capture those failures cleanly enough to fix them without guesswork?

## Scope

Each internal alpha run should cover:

- preflight health
- CLI session with file edits
- selected skill execution
- approval-gated local action
- Telegram text task
- Telegram attachment task
- provider route checks
- failure capture
- reset / rollback

## Quick Start

Initialize a fresh run folder:

```bash
cd /path/to/EstaCoda
bun run alpha:harness
```

That creates a timestamped folder under:

```text
.estacoda/internal-alpha-runs/<timestamp>/
```

with:

- `notes.md` for observations and failures
- `commands.md` with copy-paste test steps
- `environment.json` describing the run context
- `logs/` for transcripts
- `failures/` for screenshots and captures
- `artifacts/` for outputs produced during the run
- `reset.sh` for common cleanup

## Recommended Flow

### 1. Preflight

Run:

```bash
bun run typecheck
bun run smoke
bun run dev -- doctor --live
bun run dev -- gateway status
```

This catches obvious regressions before spending time on manual testing.

### 2. CLI Agent Session

Start the interactive agent and validate:

- workspace trust behavior
- file read/write loop
- `/reset`
- `/skills`
- `/tools`

The goal is to prove that the normal terminal agent path still feels coherent.

### 3. Selected Skill Execution

Use a real skill from the slash surface and confirm:

- the skill is visible
- the provider sees the selected procedure
- skill-local resources are referenced correctly
- the result is grounded in tool execution, not just narration

### 4. Approval-Gated Action

Trigger a task that should request approval and confirm:

- the request is actually gated
- the approval prompt is understandable
- the action resumes correctly after approval
- denial produces a clean state transition

### 5. Telegram Text Task

Run the Telegram gateway and send a real text prompt from Telegram.

Confirm:

- gateway starts cleanly
- typing/progress appears
- the reply lands in chat
- session continuity feels correct

### 6. Telegram Attachment Task

Send an image or document.

Confirm:

- attachment download succeeds
- attachment metadata is preserved
- the right inspection path is used
- final result returns in chat
- failures are understandable if the file is unsupported or too large

### 7. Provider Route Checks

At minimum, validate the currently configured provider path with:

```bash
bun run dev -- doctor --live
bun run dev -- --trust "Say hello as EstaCoda and summarize what you can do in one short paragraph."
```

Then repeat as needed for:

- Kimi
- OpenRouter
- Ollama
- DeepSeek

The goal is to catch provider-specific quirks in one controlled loop.

### 8. Failure Capture

For every meaningful failure:

- save screenshots into `failures/`
- save terminal transcripts into `logs/`
- record reproduction steps in `notes.md`
- record expected vs actual behavior

This is what turns an exploratory run into actionable engineering feedback.

### 9. Reset / Rollback

Use the generated reset script:

```bash
./.estacoda/internal-alpha-runs/<timestamp>/reset.sh
```

Then stop any running gateway process and restore provider config if you changed it for route checks.

## Minimum Bar For “Good Run”

A run counts as healthy when:

- preflight passes
- at least one real CLI file-edit task succeeds
- at least one skill run succeeds
- approval gating works end to end
- Telegram text works
- Telegram attachment works
- at least one provider route passes live
- failures, if any, are captured cleanly

## Notes On Truthfulness

This runbook is for internal alpha, not public-beta confidence.

If something only works in one-shot mode, only works with a trusted workspace, only works in a temp config, or only works in a narrow provider setup, we should record that plainly instead of treating it as production-ready behavior.
