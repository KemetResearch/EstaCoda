# Observability and Eval Boundary Map

## Purpose
Explicitly map what is observed, recorded, tested, proven, missing, and planned for observability and evaluation in the v0.3 codebase.

## Scope
All observability and eval code: `src/trajectory/*`, `src/smoke.ts`, `evals/`, `scripts/`, and event handling in `src/runtime/agent-loop.ts`, `src/contracts/runtime-event.ts`, `src/contracts/trajectory.ts`.

## Source Files Inspected
- `src/trajectory/trajectory-recorder.ts`
- `src/contracts/trajectory.ts`
- `src/contracts/runtime-event.ts`
- `src/smoke.ts`
- `evals/tasks/`
- `scripts/eval-substrate.ts`
- `scripts/provider-hardening.ts`
- `scripts/internal-alpha.ts`
- `src/runtime/agent-loop.ts` (recording sections)
- `src/channels/channel-gateway.ts` (event handling)

## Observability Distinctions

### 1. Session Events
- **What:** User messages, agent responses, tool calls, provider iterations within a session.
- **Where:** `SessionDB` (in-memory or SQLite)
- **Observed By:** Session layer
- **Recorded:** ✅ Yes (if SQLite)
- **Structured:** ⚠️ Partial (messages are structured, but not events)
- **Evidence:** `SessionMessage`, `SessionRecord`, `SessionEvent` types.

### 2. Trajectory Recording
- **What:** Trajectory events during a run (tool calls, provider iterations, decisions, budget exhaustion, cancellations).
- **Where:** `TrajectoryRecorder` (`src/trajectory/trajectory-recorder.ts`)
- **Observed By:** AgentLoop records events via TrajectoryRecorder.
- **Recorded:** ❌ No (in-memory only, 97 lines)
- **Structured:** ⚠️ Partial (`TrajectoryEvent` type exists but recorder is thin)
- **Evidence:** `TrajectoryRecorder` is 97 lines. `TrajectoryEvent`, `Trajectory` types exist.

### 3. Smoke Tests
- **What:** End-to-end smoke tests covering skills, tools, providers, channels, memory, security.
- **Where:** `src/smoke.ts` (13,969 lines)
- **Observed By:** Smoke test runner
- **Recorded:** ✅ Yes (assertions pass/fail)
- **Structured:** ❌ No (monolithic file, no test framework)
- **Evidence:** `src/smoke.ts` imports 89 modules and tests broad functionality.

### 4. Live-Proven Behavior
- **What:** Behavior that is exercised in live runs (not just tests).
- **Status:** ⚠️ Partial
- **Evidence:**
  - ✅ Skill loading and routing — exercised in every run.
  - ✅ Provider execution — exercised in every run.
  - ✅ Tool execution — exercised when tools are called.
  - ✅ Security policy — exercised on risky operations.
  - ✅ Memory promotion — exercised on repeated preferences.
  - ✅ Channel gateway — exercised when using Telegram.
  - ⚠️ Skill evolution — exists but may not be exercised in every run.
  - ⚠️ Trajectory recording — exists but not persisted.
  - ❌ Eval runner — not integrated into runtime.

### 5. Implemented-But-Not-Live-Proven Behavior
- **What:** Code exists but may not be exercised in typical runs.
- **Status:**
  - `skill-evolution.ts` — proposals may not be generated in normal use.
  - `skill-learning.ts` — learning may require threshold crossing.
  - `auxiliary-provider-router.ts` — only exercised on primary failure.
  - `cron-runner.ts` — only exercised when cron jobs are scheduled.
  - `mcp-client.ts` — only exercised when MCP servers are configured.
  - `delegation-manager.ts` — only exercised when delegating tasks.

### 6. Missing Replay/Eval Coverage
- **What:** No ability to replay a run or evaluate it against fixtures.
- **Status:** ❌ Missing
- **Evidence:** No replay infrastructure. No eval runner in `src/`.

### 7. Missing Trace Schema
- **What:** No formal schema for execution traces.
- **Status:** ❌ Missing
- **Evidence:** `TrajectoryEvent` type exists but is not a comprehensive trace schema. No trace export format.

### 8. Missing Failure Classification
- **What:** No taxonomy for classifying failures.
- **Status:** ❌ Missing
- **Evidence:** AgentLoop handles errors but does not classify them into a taxonomy.

## Eval Substrate Audit

| Component | Path | Status | Integration |
|-----------|------|--------|-------------|
| Smoke tests | `src/smoke.ts` | ✅ Present | Standalone, monolithic |
| Eval tasks | `evals/tasks/` | ✅ Present | Not integrated with runtime |
| Eval substrate script | `scripts/eval-substrate.ts` | ✅ Present | Standalone |
| Provider hardening script | `scripts/provider-hardening.ts` | ✅ Present | Standalone |
| Internal alpha script | `scripts/internal-alpha.ts` | ✅ Present | Standalone |
| Eval runner in src | None | ❌ Missing | No runtime eval integration |
| Regression fixtures | None | ❌ Missing | No fixture system |
| Golden flows | None | ❌ Missing | No golden flow definitions |
| Constraint gates | None | ❌ Missing | No constraint gate system |

## RuntimeEvent Usage

`RuntimeEvent` is defined in `src/contracts/runtime-event.ts` (104 lines). It is a union of event types:
- `tool-execution-start`
- `tool-execution-complete`
- `provider-iteration-start`
- `provider-iteration-complete`
- `skill-route-match`
- `security-decision`
- `memory-promotion`
- `artifact-created`
- `trajectory-event`
- `progress-update`

**Status:** ✅ Well-defined event types. Used by AgentLoop to emit progress.
**Gap:** Events are emitted but not systematically recorded or replayed.

## Observability Boundaries

| Boundary | Enforced By | Status |
|----------|-------------|--------|
| Event types | `RuntimeEvent` union | ✅ Defined |
| Event emission | AgentLoop + ChannelGateway | ✅ Emitted |
| Event recording | TrajectoryRecorder | ❌ Not persisted |
| Event replay | None | ❌ Missing |
| Session history | SessionDB | ✅ Persisted (SQLite) |
| Smoke coverage | smoke.ts | ✅ Broad but monolithic |
| Eval integration | None | ❌ Missing |
| Failure taxonomy | None | ❌ Missing |
| Trace schema | None | ❌ Missing |
| Evidence corpus | None | ❌ Missing |

## Coupling Risks

1. **AgentLoop → TrajectoryRecorder:** Direct. AgentLoop manually records events at multiple points.
2. **AgentLoop → RuntimeEventSink:** Direct. AgentLoop emits events to sink (often CLI or channel).
3. **smoke.ts → Everything:** Smoke tests import 89 modules. Any change can break smoke tests.

## Evidence Status
- ✅ RuntimeEvent types are comprehensive.
- ✅ Smoke tests exist and cover broad functionality.
- ✅ Session history is persisted.
- ❌ Trajectory is not persisted.
- ❌ No trace schema.
- ❌ No eval runner in runtime.
- ❌ No failure classification.
- ❌ No replay capability.

## Open Questions
1. Should TrajectoryRecorder persist to SQLite or files?
2. Should eval runner be a separate process or integrated into runtime?
3. What is the minimum trace schema needed for v0.5?
4. How should smoke tests be split?

## Recommended Follow-Up Areas
- Define trace schema before v0.4 coding to guide recorder placement.
- Build eval runner for v0.5.
- Add failure classification taxonomy for v0.5.
- Split smoke.ts into per-subsystem test files.
- Integrate trajectory recording with session DB or separate store.
