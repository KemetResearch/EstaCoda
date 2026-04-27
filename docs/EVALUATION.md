# Evaluation

This file describes EstaCoda's Phase 0 evaluation substrate. It is not a self-evolution engine.

## Purpose

The current goal is to create a repeatable substrate for future self-improvement work:

- fixed evaluation tasks
- repeatable run folders
- structured pass/fail capture
- baseline vs candidate comparison
- enough discipline to support future skill/prompt evolution safely

This is intentionally narrower than the Hermes self-evolution repo. It is a prerequisite, not the full loop.

## What Exists Now

- Task definitions live in [evals/tasks](/Users/ahnwy/estacoda-v2/evals/tasks).
- A run scaffold can be generated with:

```bash
cd /Users/ahnwy/estacoda-v2
/Users/ahnwy/.bun/bin/bun run eval:substrate
```

- The scaffold creates:
  - a run root under `.estacoda/eval-runs/<timestamp>/`
  - `manifest.json`
  - `results.json`
  - `notes.md`
  - `commands.md`
  - `logs/`
  - `artifacts/`
  - `failures/`

## What It Does Not Do Yet

- It does not automatically execute all tasks.
- It does not score candidates automatically.
- It does not perform DSPy/GEPA-style optimization.
- It does not generate PRs or evolve code by itself.

So the truthful label is:

- evaluation substrate: `implemented`
- autonomous self-evolution loop: `intended but not implemented`

## Intended Next Steps

1. Add more fixed eval tasks for important skills and channels.
2. Add structured scoring fields beyond pass/fail.
3. Add baseline vs candidate diffing.
4. Add batch evaluation for skills first.
5. Only later consider prompt/skill evolution loops.
