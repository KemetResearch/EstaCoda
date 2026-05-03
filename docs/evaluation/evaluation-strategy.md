---
title: "Evaluation Strategy"
description: "Evaluation substrate, automated runner, golden flows, and future scoring direction."
---

# Evaluation Strategy

## Purpose

Create a repeatable substrate for future self-improvement work:

- Fixed evaluation tasks
- Repeatable run folders
- Structured pass/fail capture
- Baseline vs candidate comparison
- Enough discipline to support skill/prompt evolution safely

This is intentionally narrower than full self-evolution. It is a prerequisite, not the full loop.

## What Exists Now

### Eval Task Definitions

Location: `evals/tasks/` (legacy manual runbooks)

### Automated Eval Runner

Location: `src/eval/eval-runner.ts`

```bash
estacoda eval [fixture-id]
```

Runs deterministic fixtures with pass/fail assertions:
- `provider-text-response` — mock provider returns text without tool calls
- `tool-security-block` — detects blocked `rm -rf /`
- `missing-tool-failure` — handles unavailable tool gracefully

### Eval Substrate Scaffold

```bash
bun run eval:substrate
```

Creates under `.estacoda/eval-runs/<timestamp>/`:
- `manifest.json`
- `results.json`
- `notes.md`
- `commands.md`
- `logs/`
- `artifacts/`
- `failures/`

### Golden Flows

Location: `evals/golden-flows/`

Baseline trajectories with assertions:
- `provider-text-response.json` — clean single-turn completion
- `tool-security-block.json` — dangerous tool correctly gated

Compare actual trajectories against golden flows with `compareToGoldenFlow()`.

### Provider Hardening Batch

```bash
bun run provider:hardening
```

Rotates the project-level provider route across the acceptance set, runs live diagnostics, captures results under `.estacoda/provider-hardening-runs/<timestamp>/`, and restores original config.

**Current live results:**

| Provider | Result |
|----------|--------|
| Kimi | Full pass |
| OpenAI | Full pass |
| DeepSeek | Full pass |
| OpenRouter | Runtime works; exactness partial |
| local/Ollama | Not accepted in this environment |

For OpenRouter, the batch targets `qwen/qwen3.6-plus` rather than `openrouter/auto`. Override with `ESTACODA_OPENROUTER_MODEL`.

## What It Does Not Do Yet

- It does not score candidates automatically against golden flows in CI.
- It does not perform DSPy/GEPA-style optimization.
- It does not generate PRs or evolve code.
- It does not replay golden flows through the live runtime.

**Truthful labels:**
- Evaluation runner + fixtures: `smoke-tested`
- Golden flows: `smoke-tested`
- Autonomous self-evolution loop: `intended but not implemented`

## Intended Next Steps

1. Add more fixed eval tasks for skills and channels.
2. Add structured scoring fields beyond pass/fail.
3. Add baseline vs candidate diffing.
4. Add batch evaluation for skills first.
5. Only later consider prompt/skill evolution loops.
