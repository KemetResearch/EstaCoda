---
title: "Testing"
description: "Testing strategy, smoke tests, and validation commands."
---

# Testing

## Philosophy

EstaCoda currently has **broad smoke coverage and no unit tests**. The smoke test file is the primary safety net.

## Fast Regression Checks

Run these before and after most changes:

```bash
bun run typecheck
bun run smoke
```

| Check | Evidence Level |
|-------|---------------|
| `typecheck` | Compile guard only |
| `smoke` | `smoke-tested` |

## Smoke Tests

**File:** `src/smoke.ts`
**Size:** 13,969 lines
**Imports:** 89

### What Smoke Covers

- Provider normalization and routing
- Tool-call recovery and continuation
- Browser backend basics
- Image generation (FAL, BytePlus/Seedream)
- Voice (TTS, STT)
- Telegram progress, approvals, attachments, session lifecycle
- Skill execution, mutation, evolution
- Memory promotion
- Security policy and hard floor
- Cron create/list/edit/tick
- MCP discovery and reload
- ACP basic flow
- Context expansion and prompt packing
- Artifact handling
- Onboarding copy and settings

### What Smoke Does Not Cover

- Real provider execution (mocked)
- Real Telegram gateway (mocked adapter)
- Real browser automation (mock backend)
- Real MCP server execution (mocked)
- Real voice/image generation (mocked responses)

### Smoke Limitations

- All tests in one 14k-line file
- No formal test framework
- No granular failure isolation
- Adding a test means editing a monolith

## Recommended Test Practices

1. Run `bun run typecheck` first.
2. Run `bun run smoke` before declaring success.
3. For live behavior, run the internal alpha harness.
4. Capture failures with screenshots, logs, and reproduction steps.

## Future Testing

**Target:** v0.4–v0.5

- Introduce Vitest (Bun-compatible)
- Extract unit tests for Router, Planner, Executor, Recorder
- Keep smoke.ts as integration layer only
- Add per-subsystem test suites
