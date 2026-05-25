---
title: ADR-0004 Generated Graphs as Local Artifacts
description: Graph generation scripts committed, raw outputs gitignored, sanitized summaries public.
sidebar_position: 4
---

# ADR-0004: Generated Graphs as Local Artifacts with Public Summaries

**Status:** Accepted
**Date:** 2026-05-03
**Scope:** Documentation, tooling, repo hygiene

---

## Context

Dependency and knowledge graphs are useful for understanding the codebase, but generated artifacts quickly become stale, contain local paths, and bloat the repo.

## Decision

1. **Graph generation scripts are committed publicly.**
2. **Sanitized summaries are committed publicly** (`docs/architecture/dependency-map.md`, `docs/architecture/knowledge-map.md`).
3. **Raw generated outputs are excluded via `.gitignore`.**
4. **Local machine paths, usernames, and private notes never appear in committed docs.**

Generated artifacts go under `.estacoda/graphs/`:

```gitignore
.estacoda/graphs/*.json
.estacoda/graphs/*.dot
.estacoda/graphs/*.svg
```

## Rejected alternatives

1. **Commit full generated graphs** — Rejected. Stale bloat, local path leakage.
2. **No graphs at all** — Rejected. Useful for onboarding and architecture review.
3. **Graphs in CI only** — Rejected: local generation is faster and avoids CI queue dependency.

## Consequences

- `tools/graphs/` contains generation scripts.
- `docs/architecture/` contains human-curated summaries.
- Graphs are refreshed during maintenance passes, not every commit.

## Operational impact

**What boundary it creates:**
- The repo never contains raw generated artifacts. Only the scripts that produce them and the human-curated summaries derived from them.
- Local paths and private notes stay on the machine that generated them.

**What files, commands, and subsystems it affects:**
- `tools/graphs/` — generation scripts
- `docs/architecture/dependency-map.md` — sanitized dependency summary
- `docs/architecture/knowledge-map.md` — sanitized knowledge summary
- `.gitignore` — excludes `.estacoda/graphs/`

**What maintainers must preserve:**
- Summaries must be sanitized before commit. A generated graph pasted directly into `docs/architecture/` leaks local paths.
- Generation scripts must remain runnable. If a script breaks, the summary becomes unrefreshable.
- `.gitignore` must continue to exclude `.estacoda/graphs/`. Accidentally committing raw outputs is a hygiene violation.

**What failure or drift it prevents:**
- Repo bloat from multi-megabyte SVG files that are stale after the next refactor.
- Local path leakage into public commits (`/home/alice/estacoda/...`).
- False confidence from outdated architecture graphs that no longer match the code.

**What is intentionally outside the decision:**
- Automated graph refresh on every commit. Graphs are refreshed during maintenance passes.
- Public hosting of interactive graph visualizations. Summaries are static Markdown.
- Graph generation as a runtime feature. This is a development and documentation tool, not a user-facing capability.

## Related docs

- [Developer: Architecture](../developer/architecture.md)
