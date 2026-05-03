---
title: "Architecture Overview"
description: "High-level system map, entrypoints, runtime composition, and data flow."
---

# Architecture Overview

EstaCoda is a TypeScript-first agent runtime built on Bun. It executes provider-backed agent sessions through CLI and Telegram, with skills, tools, memory, and security policy as first-class surfaces.

## Entrypoints

| File | Role | Evidence |
|------|------|----------|
| `src/index.ts` | Boot flow. Loads config, runs first-run onboarding if needed, dispatches to CLI command, interactive session, or one-shot prompt. Also restores the active CLI workspace session from persisted store before interactive launch. | `implemented but not live-proven` |
| `src/cli/cli.ts` | CLI command surface. Parses arguments and dispatches to subcommands. | `smoke-tested` |
| `src/cli/session-loop.ts` | Interactive terminal loop. Handles in-session admin commands: `/sessions`, `/search`, `/switch`, `/reset`. | `smoke-tested` |
| `src/cli/cli-session-store.ts` | Persisted active CLI session pointer keyed by workspace root. | `smoke-tested` |
| `src/channels/gateway-runner.ts` | Telegram gateway runtime wrapper. | `live-proven` |

## Runtime Composition

`createRuntime()` in `src/runtime/create-runtime.ts` is the composition root. It is a 901-line function with 69 imports that manually constructs 30+ subsystem objects.

Construction order:

1. State stores (memory store, session DB, artifact store, cron store)
2. Provider registry and auxiliary routes
3. Tool registry
4. Skill registries (official → personal → project → external)
5. Prompt dependencies (prompt cache, context expander)
6. Extracted runtime components (`RunRecorder`, `ToolPlanRunner`, `ProviderTurnLoop`, `SkillWorkflowExecutor`, `NativeToolExecutor`)
7. `AgentLoop`

Key composition rules:

- Official skills load first. Personal/project/external skills load next.
- Visible skill catalog is filtered per session using runtime conditions.
- `vision.analyze` is registered as a real tool and uses auxiliary `vision` provider route preferences.
- Channel media directory is treated as an additional allowed root for relevant tools.
- Configured MCP servers are loaded during runtime creation and stopped during runtime disposal.

## Core Orchestration

| File | Role | Lines | Evidence |
|------|------|-------|----------|
| `src/runtime/create-runtime.ts` | Composition root | 901 | `smoke-tested` |
| `src/runtime/agent-loop.ts` | Core orchestration lifecycle | 809 | `live-proven` |
| `src/runtime/runtime-router.ts` | Runtime routing (intent + skill) | ~120 | `smoke-tested` |
| `src/runtime/provider-turn-loop.ts` | Provider streaming loop | ~585 | `live-proven` |
| `src/runtime/tool-plan-runner.ts` | Tool plan execution | ~420 | `live-proven` |
| `src/runtime/run-recorder.ts` | Run recording and trajectory | ~200 | `smoke-tested` |
| `src/runtime/skill-workflow-executor.ts` | Skill workflow execution | ~267 | `live-proven` |
| `src/runtime/native-tool-executor.ts` | Deterministic native intent execution | ~150 | `smoke-tested` |
| `src/runtime/intent-router.ts` | Native intent classification | 175 | `smoke-tested` |

## Agent Loop Shape

`AgentLoop.handle()` follows this approximate flow:

1. Receive text + attachments + channel
2. Expand `@file:` / `@folder:` references
3. Record input to session DB + trajectory
4. Normalize attachment statuses
5. Short-circuit on attachment preflight failures
6. Route native intent and skill (delegated to `RuntimeRouter`)
7. Make security decision
8. Assemble prompt
9. **Delegate provider turn loop to `ProviderTurnLoop`**
10. **Delegate tool execution to `ToolPlanRunner`**
11. **Delegate skill workflow execution to `SkillWorkflowExecutor`**
12. **Delegate deterministic native execution to `NativeToolExecutor`**
13. Persist results, outcomes, artifacts
14. Return text/progress/artifacts

Guardrails inside the loop:

- Attachment preflight can stop the turn before provider execution.
- Provider iterations are budgeted (enforced by `ProviderTurnLoop`).
- Repeated tool failures are capped (enforced by `ToolPlanRunner`).
- Safe tool concurrency is bounded (enforced by `ToolPlanRunner`).
- Security decisions are attached to tool executions, not just final replies.

**Remaining coupling:** `AgentLoop` still assembles the full prompt, manages memory context injection, and coordinates between components. It does not execute provider iterations or tool plans directly.

Native intent routing handles product-owned paths before normal provider planning:

- Explicit text-to-image prompts → `image-generation` → deterministic `image.generate`
- Ready image attachments with edit/modify prompts → `attachment-analysis`
- Audio/voice transcription wording → `voice-transcription`

## Provider Architecture

Two layers:

**1. Registry / routing**
- Offline-first model catalog (`src/model-catalog/models-dev-registry.ts`)
- Provider registry with route selection by capability and preference
- Credential pool for key rotation

**2. Execution**
- `ProviderExecutor` — streaming token collection, tool-call fragment assembly, fallback handling
- `OpenAICompatibleProvider` — primary inference adapter

Auxiliary routes exist for: `main`, `vision`, `compression`, `approval`, `web_extract`, `session_search`, `skills_hub`, `mcp`, `memory_flush`, `delegation`.

These are preferences/routing constructs, not separate runtimes.

Important distinction:
- The model catalog is enriched from the models.dev metadata registry when cached/bundled data is available, with local fallback profiles retained as a safety net.
- Catalog-only providers are discovery adapters, not true inference adapters.
- Runtime config loads catalog metadata with network refresh disabled by default.

## Prompt Architecture

Prompt assembly is layered and partly cacheable. Key layers:

1. Identity / SOUL
2. Frozen memory snapshot
3. Compact skills index
4. Session history
5. User message
6. Channel attachments
7. Intent
8. Skill instructions
9. Skill setup
10. Skill resources
11. Workflow plan
12. Tool menu
13. Project context
14. Explicit reference context
15. Tool results / continuation feedback

Semantic rules:

- Session-stable system context is preferred over mid-session mutation.
- Skills are progressively disclosed.
- Attachments are structured context, not fake user text.
- Channel-facing formatting is handled after model generation, not by mutating the core runtime.

## Skill Model

Skill sources:

| Source | Location | Mutability |
|--------|----------|------------|
| `official` | Bundled in repo | Read-only (local working copies for evolution) |
| `personal` | `~/.estacoda/skills/` | Mutable |
| `project` | `<workspace>/.estacoda/skills/` | Mutable |
| `external` | Configured external roots | Read-only |

Visibility is session-stable, filtered by runtime conditions, and refreshed on `/reset` or new session.

Skill operations: list, view, inspect, create, patch, edit, delete, write_file, remove_file, import, export.

Execution: provider-backed by default; deterministic fallback path exists for no-provider sessions. Resources (`references/`, `templates/`, `scripts/`, compatible `assets/`) are indexed and loaded on demand.

## Channel Architecture

`ChannelGateway` is the generic adapter bridge. Responsibilities:

- Auth / allowlist / pairing
- Session mapping with normalized session-key policy
- Session auto-reset policy
- Session-admin commands (`/sessions`, `/search`, `/switch`)
- Runtime construction from fresh config snapshot per turn
- Progress delivery
- Approval prompt delivery
- Command handling

Telegram-specific behavior lives in `TelegramAdapter`:

- Polling
- Attachment download
- Callback query handling
- Progress message editing
- Final reply formatting

Telegram UX choices:

- One evolving progress message per active turn
- Inline approval buttons map back to `/approve` and `/deny`
- Final replies formatted in Telegram-safe HTML layer
- Activity labels localized through shared label map (`en`, `ar`)
- Group sessions per-user by default; thread sessions shared by default
- Active chat → session mapping persists across gateway restarts

## Security Model

Capability-first security boundary.

- Approval modes: `strict`, `adaptive`, `open`
- `adaptive` is default; uses deterministic triage first, then optional auxiliary security assessor
- `open` preserves a hard dangerous-command floor
- `/yolo` is a session-scoped CLI/gateway toggle for `open` mode; cannot bypass the hard floor
- Tool risk classes drive gating: `safe`, `caution`, `external-side-effect`, `irreversible`
- Structured `targetKey` values are the approval boundary; display summaries are not
- Workspace trust allows normal local work to proceed proactively
- Persistent approvals match on normalized `targetKey`
- Channel approvals: `once`, `session`, `always`
- CLI approvals: same scope model through runtime-backed grants
- Hard floor covers: broad recursive deletes, destructive disk operations, shutdown/reboot, fork-bomb/kill-all, secret reads, pipe-to-interpreter installs, git force-pushes

## Persistence Model

### Session persistence

- Interactive/session state written to session DB
- SQLite for gateway path; in-memory for smoke/scaffolding
- CLI session context persisted in `.estacoda/cli-sessions.json`
- Channel session context persisted in `.estacoda/channel-sessions.json`
- Channel session identity includes explicit chat/thread policy

### Memory persistence

- `SOUL.md`, `USER.md`, `MEMORY.md`, `AGENTS.md` in `~/.estacoda/`
- Bounded budgets enforced by `MemoryStore`
- `LocalMemoryProvider` persists: manual conclusions, promoted user preferences, promoted project facts/conventions, skill outcomes
- Contradiction/forget/inspection for promoted user preferences
- Workflow learning separated from memory files:
  - Facts/conventions → `MEMORY.md`
  - User preferences → `USER.md`
  - Reusable procedures → project skills
  - Workflow learning state → `<workspace>/.estacoda/skill-learning.json`
- `skills.autonomy`: `none` | `suggest` | `proactive` | `autonomous`

### Trajectory persistence

- `TrajectoryRecorder` records runtime events in memory only
- No persistence layer exists yet
- `implemented but not live-proven`

## Data Flow Summary

The primary end-to-end path:

1. Input arrives from CLI or Telegram
2. Runtime normalizes message + attachments
3. Prompt assembly builds a layered provider request
4. Provider responds with text and/or tool calls
5. Tool planner + executor run concrete actions under policy
6. Continuation prompt feeds tool results back if needed
7. Final output is formatted per surface
8. Session, memory, approvals, and trajectory state are persisted

## Current Architectural Weak Spots

1. **AgentLoop monolith** — Was 2,714 lines, now 809 lines. Core orchestration remains but provider loop, tool execution, skill workflows, and native intents are extracted. Remaining coupling: prompt assembly, memory context injection, cross-component coordination.
2. **create-runtime.ts god factory** — 901 lines, 69 imports, 36 constructor calls, no DI boundary. Assessment in `docs/planning/v0.4-builder-assessment.md` recommends deferring a builder pattern.
3. **Trajectory/Artifact skeletons** — 97 and 56 lines, in-memory only.
4. **No unit tests** — 13,969-line smoke.ts is the only safety net. Deferred to v0.5.
5. **Bun lock-in** — `bun:sqlite` prevents Node execution.
6. **Telegram-only channels** — no other real launch channel.
7. **Gateway liveness** — readiness-focused, not daemon-tracking.
8. **Remaining cross-component state** — `AgentLoop` constructor still receives 20+ dependencies. Some (e.g., `memoryContext`, `projectContext`) are only used for prompt assembly and could move to a dedicated `PromptAssembler`.
