---
title: "Operator Console"
description: "Future Papyrus-owned interactive CLI surface contract."
---

# Operator Console

This document is a planning contract for the EstaCoda Operator Console. It
does not describe fully implemented runtime behavior yet.

## Purpose

The EstaCoda Operator Console is the future Papyrus-owned interactive CLI
surface. It replaces bottom chrome redraws, prompt echo clearing, active-turn
side channels, fixed tool rails, and manual readline-era terminal row
management.

The redesign keeps the existing CLI product semantics while moving live
terminal composition into Papyrus.

```text
session/runtime events
-> OperatorConsoleState
-> Papyrus surfaces
-> compositor
-> terminal diff
```

Core rules:

- Papyrus owns pixels.
- Runtime owns meaning.
- Security policy remains authoritative.
- No session-loop ANSI surgery.
- UI components collect user intent; they do not grant permissions, mutate
  trust, or bypass policy.

## Ownership Model

The console splits responsibility across three layers:

| Layer | Owns | Must Not Own |
|------|------|--------------|
| Runtime/session | messages, runtime events, tool activity, approval requests, model/context state | terminal row accounting or ANSI cursor patches |
| Operator console state | focus, surface ordering, prompt/attachment/tool/approval/steer UI state | provider routing, approval grants, workspace trust |
| Papyrus renderer/compositor | measurement, wrapping, truncation, bidi-safe terminal layout, frame diffing | security decisions or runtime semantics |

The session loop should eventually feed semantic changes into the console
instead of drawing transient terminal regions directly.

## Surface Order

The live console must support this vertical order:

```text
startup/transcript
active work, if present
queued steer, if present
attachments, if present
prompt / steer input
slash menu, if present
status rail
```

The persistent status rail contains only:

- model
- context usage / context bar
- session timer

Tools, approvals, attachments, steering, workspace/trust, and setup state must
not be added to the persistent rail by default. They get contextual surfaces.

## State Model Sketch

These TypeScript shapes are intended contracts and may be refined during
implementation.

```ts
type OperatorConsoleState = {
  transcript: TranscriptBlock[];
  prompt: PromptSurfaceState;
  status: StatusRailState;
  attachments: AttachmentCardState[];
  activeWork: ToolActivityState;
  approvals: ApprovalCardState[];
  slash?: SlashMenuState;
  steer?: SteerState;
  focus: FocusState;
  terminal: TerminalMetrics;
};
```

## Focus And Event Boundary Sketch

```ts
type FocusTarget =
  | { kind: "prompt" }
  | { kind: "attachment"; attachmentId: string }
  | { kind: "activeWork"; toolEventId: string }
  | { kind: "approval"; approvalId: string; control: "approve" | "reject" | "inspect" }
  | { kind: "slashMenu"; itemId: string }
  | { kind: "steer" }
  | { kind: "setup"; controlId: string };
```

```ts
type OperatorConsoleEvent =
  | { type: "key"; key: ParsedKeypress }
  | { type: "paste"; text: string }
  | { type: "resize"; width: number; height: number }
  | { type: "toolEvent"; event: ToolActivityEvent }
  | { type: "approvalRequested"; request: ApprovalRequestViewModel }
  | { type: "turnStarted" }
  | { type: "turnCompleted" }
  | { type: "statusChanged"; status: StatusRailState };
```

Focus rules locked for v1:

- `Enter` submits the prompt.
- `Alt+Enter` inserts a newline.
- Paste preserves newlines.
- `Tab` and `Shift+Tab` move focus between prompt and attachment cards.
- `Enter` opens an attachment preview only when attachment focus is active.
- `Esc` removes a focused attachment or cancels steer draft/queued steer.
- `Ctrl+C` remains the hard active-turn interrupt.

## Phase-Mapped Target Renders

These renders are visual targets, not exact string snapshots. Papyrus owns
measurement, wrapping, truncation, focus, resize behavior, and Arabic/bidi
safety.

### Phase A: Surface State

No user-facing render is required.

```text
session/runtime events
-> OperatorConsoleState
-> Papyrus surfaces
-> compositor
-> terminal diff
```

Visual order supported:

```text
startup/transcript
active work, if present
queued steer, if present
attachments, if present
prompt / steer input
slash menu, if present
status rail
```

### Phase B: Startup Dashboard

Wide startup dashboard:

```text
                         EstaCoda
                    𓋹 Kemet Research 𓋹
                 sovereign agentic infrastructure
────────────── v0.1.0  ☂ session 20ea8195 ──────────────
╭──────────────────────────────────────────────────────────────────────────────╮
│ ╭─ Session ──────────────────────────╮ ╭─ Commands ────────────────────────╮ │
│ │ model       kimi-k2.6 ◐             │ │ /tools     inspect tools           │ │
│ │ context     0 / 262k                │ │ /skills    loaded skills           │ │
│ │ workspace   verified                │ │ /model     active model route      │ │
│ │ security    open                    │ │ /status    runtime state           │ │
│ │ autonomy    autonomous              │ │ /setup     setup editor            │ │
│ ╰────────────────────────────────────╯ ╰───────────────────────────────────╯ │
│                                                                              │
│ Tips                                                                         │
│ Paste large context as attachments. Use /model to switch routes.              │
│ Approvals appear inline when an action needs permission.                      │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Prompt ─────────────────────────────────────────────────────────────────────╮
│ ›                                                                            │
╰──────────────────────────────────────────────────────────────────────────────╯
kimi-k2.6 ◐ │ ctx [▱▱▱▱▱▱▱▱▱▱] 0/262k 0% │ session 00:10
```

Narrow startup dashboard:

```text
                         EstaCoda
                    Kemet Research
                 sovereign agentic infrastructure
v0.1.0 · session 20ea8195
╭────────────────────────────────────────────╮
│ ╭─ Session ──────────────────────────────╮ │
│ │ model       kimi-k2.6 ◐                 │ │
│ │ context     0 / 262k                    │ │
│ │ workspace   verified                    │ │
│ │ security    open                        │ │
│ ╰────────────────────────────────────────╯ │
│ ╭─ Commands ─────────────────────────────╮ │
│ │ /tools    inspect tools                 │ │
│ │ /skills   loaded skills                 │ │
│ │ /model    active model route            │ │
│ │ /status   runtime state                 │ │
│ ╰────────────────────────────────────────╯ │
│                                            │
│ Tips                                       │
│ Paste large context as attachments.        │
╰────────────────────────────────────────────╯
```

Implementation target:

- Header = identity.
- Outer border = startup seal.
- Inner left box = Session.
- Inner right box = Commands.
- Tips = plain text.
- Prompt/status rail = live command surface.

### Phase C: Prompt Box And Status Rail

Single-line prompt:

```text
╭─ Prompt ─────────────────────────────────────────────────────────────╮
│ › review the Papyrus rollout plan                                    │
╰──────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 18.4k/262k 7% │ session 01:12
```

Multiline prompt expansion:

```text
╭─ Prompt · multiline ─────────────────────────────────────────────────╮
│ › write a migration plan for:                                        │
│   - approval cards                                                   │
│   - pasted attachments                                               │
│   - tool activity                                                    │
╰──────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 18.4k/262k 7% │ session 01:12
```

Long multiline prompt with internal scroll:

```text
╭─ Prompt · multiline ─────────────────────────────────────────────────╮
│ › write a migration plan for the Papyrus console redesign             │
│   focusing on:                                                        │
│   - startup dashboard                                                 │
│   - prompt expansion                                                  │
│   - active work                                                       │
│   - approvals                                                         │
│   - steering                                                          │
│                                                                      │
│ 12 lines · ↑↓ scroll within prompt                                    │
╰──────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 18.4k/262k 7% │ session 01:12
```

Status rail degradation:

```text
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 18.4k/262k 7% │ session 01:12
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 7% │ session 01:12
kimi-k2.7 ● │ ctx 7% │ 01:12
kimi ● 7% 01:12
```

### Phase D: Attachments

Wide attachment row:

```text
Attachments
╭─ pasted text ─────────────╮ ╭─ file excerpt ────────────╮ ╭─ pasted text ─────────────╮
│ MVP known issue…          │ │ src/cli/session-loop.ts   │ │ Stack trace from setup…   │
│ 2,481 chars               │ │ 184 lines                 │ │ 918 chars                 │
╰───────────────────────────╯ ╰───────────────────────────╯ ╰───────────────────────────╯
╭─ Prompt ─────────────────────────────────────────────────────────────╮
│ › summarize this and turn it into a regression test                  │
╰──────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 7% │ session 01:12
```

Narrow attachment layout:

```text
Attachments
╭─ pasted text ─────────────────────────────╮
│ MVP known issue…                           │
│ 2,481 chars · Enter open · Esc remove      │
╰────────────────────────────────────────────╯
╭─ file excerpt ────────────────────────────╮
│ src/runtime/provider-turn-loop.ts          │
│ 184 lines · Enter open · Esc remove        │
╰────────────────────────────────────────────╯
╭─ Prompt ──────────────────────────────────╮
│ › summarize this                           │
╰────────────────────────────────────────────╯
kimi-k2.7 ● │ ctx 7% │ 01:12
```

Submitted transcript form:

```text
User:
summarize this and turn it into a regression test
Attachments:
- pasted text · 2,481 chars
- file excerpt · src/cli/session-loop.ts · 184 lines
```

### Phase E: Active Work

Live active work:

```text
╭─ Active work ─────────────────────────────────────────────────────────╮
│ ◷ read_file       src/ui/papyrus/screen/output.ts              00:03  │
│ ◷ rg              "createReadlinePrompt" src                   00:02  │
│ ✓ read_file       src/cli/session-loop.ts                      00:01  │
│ ✓ grep            approval required                            00:01  │
│ ✓ typecheck       passed                                       00:18  │
│ ... 18 more completed this turn                                      │
╰───────────────────────────────────────────────────────────────────────╯
╭─ Prompt ─────────────────────────────────────────────────────────────╮
│ ›                                                                     │
╰──────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 7% │ session 01:12
```

Turn-end collapsed summary:

```text
Assistant:
Completed tool work: 3 running steps resolved, 42 total tool events, 1 file change inspected.
```

Active work is live telemetry. It should not dump full operational detail into
the transcript by default.

### Phase F: Inline Approval Cards

Approval required:

```text
Assistant:
I need approval before modifying the database.
┌─ Approval required ───────────────────┐
│ Action: run migration                  │
│ Target: production database            │
│ Risk: schema change                    │
│                                        │
│ [Approve once]   [Reject]   [Inspect]  │
└────────────────────────────────────────┘
Assistant:
Waiting for approval.
```

Focused approval control:

```text
┌─ Approval required ─────────────────────────────────────┐
│ Action: write file                                      │
│ Target: src/runtime/provider-turn-loop.ts               │
│ Risk: runtime behavior change                           │
│                                                         │
│ +42 lines  -17 lines                                    │
│                                                         │
│ ❯ Approve once        Reject        Inspect             │
└─────────────────────────────────────────────────────────┘
```

Approval v1 controls:

- Approve once
- Reject
- Inspect

Feedback, amend, session approval, and persistent approval controls are out of
scope for approval v1 unless the implementation adds a separately reviewed
runtime path.

### Phase G: Setup And Secret Panels

Provider/model table:

```text
╭─ Model route ─────────────────────────────────────────────────────────╮
│ Choose the active provider and model route.                           │
│                                                                       │
│ Provider        Model                    Status        Notes          │
│ ───────────────────────────────────────────────────────────────────── │
│ ❯ OpenAI        gpt-5.5                  ready         API key set     │
│   Anthropic     claude-sonnet-4.5        ready         API key set     │
│   Local         qwen3-coder              offline       endpoint unset  │
│   Z.AI          glm-4.5                  ready         API key set     │
│                                                                       │
│ ↑↓ navigate · Enter select · / filter · Esc back                      │
╰───────────────────────────────────────────────────────────────────────╯
```

Secret entry:

```text
╭─ API key · OpenAI ────────────────────────────────────────────────────╮
│ Enter API key for OpenAI.                                             │
│                                                                       │
│ sk-••••••••••••••••••••••••••••••••                                  │
│                                                                       │
│ Stored as: OPENAI_API_KEY                                             │
│                                                                       │
│ Enter save · Esc back · Ctrl+C exit                                   │
╰───────────────────────────────────────────────────────────────────────╯
```

Secret rules:

- Never render raw secrets after input.
- Never preview secret paste.
- Never store secret values in transcript.
- Mask by terminal cell count.
- Destroy secret state after save/cancel.

### Phase H: Slash Menu

```text
╭─ Prompt ─────────────────────────────────────────────────────────────╮
│ › /mo                                                                │
╰──────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────╮
│ ❯ /model        show or change active model route                    │
│   /model setup  configure provider/model credentials                 │
│   /model list   list available models                                │
╰──────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 7% │ session 00:13
```

Slash suggestions are anchored to prompt input. The command registry remains
semantic; Papyrus renders it.

### Phase I: Steering And Interrupt

Active turn with steer draft:

```text
Assistant is working…
╭─ Active work ─────────────────────────────────────────────────────────╮
│ ◷ reading setup editor files                                   00:08  │
│ ◷ searching approval tests                                      00:04  │
╰───────────────────────────────────────────────────────────────────────╯
╭─ Steer current turn ──────────────────────────────────────────────────╮
│ › focus only on approval cards and pasted attachments                  │
╰───────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 7% │ session 00:31
```

Queued steer:

```text
Assistant is working…
╭─ Active work ─────────────────────────────────────────────────────────╮
│ ◷ terminal.exec     pnpm test                                  00:31  │
│ ◷ read_file         src/cli/session-loop.ts                    00:08  │
╰───────────────────────────────────────────────────────────────────────╯
╭─ Queued steer ────────────────────────────────────────────────────────╮
│ focus only on approval cards and pasted attachments                    │
│ Will apply at next safe boundary · Esc cancel                          │
╰───────────────────────────────────────────────────────────────────────╯
╭─ Steer current turn ──────────────────────────────────────────────────╮
│ ›                                                                      │
╰───────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 7% │ session 00:31
```

Steering semantics:

- Typing during active turn opens `Steer current turn`.
- `Enter` submits steer.
- Runtime applies steer at the next safe boundary.
- Queued steer card appears until applied/cancelled.
- One queued steer exists at a time.
- `Esc` cancels draft or queued steer.
- `Ctrl+C` interrupts the active turn.
- A second `Ctrl+C` exits according to the active session policy.

### Phase J: Full Live Session Composite

```text
User:
review the Papyrus rollout plan
Assistant:
The structure is sound. The critical change is that Papyrus must own the
interactive frame instead of patching rows around readline.
╭─ Active work ─────────────────────────────────────────────────────────╮
│ ✓ searched operator console files                              00:01  │
│ ◷ reading setup editor tests                                   00:04  │
╰───────────────────────────────────────────────────────────────────────╯
Attachments
╭─ pasted text ─────────────╮ ╭─ file excerpt ────────────╮
│ MVP known issue…          │ │ src/cli/session-loop.ts   │
│ 2,481 chars               │ │ 184 lines                 │
╰───────────────────────────╯ ╰───────────────────────────╯
╭─ Prompt ─────────────────────────────────────────────────────────────╮
│ › focus next on approval cards and steering                          │
╰──────────────────────────────────────────────────────────────────────╯
kimi-k2.7-code ● │ ctx [▰▱▱▱▱▱▱▱▱▱] 18.4k/262k 7% │ session 01:12
```

## Implementation Phases

1. Add Operator Console docs and contracts.
2. Add console state, focus model, layout, and renderer shell.
3. Render boxed prompt with status rail below.
4. Support `Alt+Enter` multiline insertion and prompt scrolling.
5. Add paste attachment cards and focus routing.
6. Add uncapped active work model and scrollable active work box.
7. Add inline approval cards for approve once, reject, and inspect.
8. Add active-turn steer surface and queued steer state.
9. Rebuild startup dashboard and setup panels with the same console language.
10. Route the session loop through the Operator Console.
11. Remove obsolete terminal controllers and transient chrome machinery.

## Non-Goals For This Commit

This documentation-only commit does not:

- change runtime behavior;
- change the interactive CLI path;
- add `OperatorConsoleState` implementation files;
- add or remove feature flags;
- delete bottom chrome, active-turn, or select controllers;
- change approval policy or grant handling;
- change setup behavior;
- update snapshots.

## Legacy Code Intended For Later Deletion

After the Operator Console owns the frame, later implementation PRs may delete
or heavily reduce:

- `src/cli/bottom-chrome-controller.ts`
- `src/cli/bottom-chrome-controller.test.ts`
- `src/cli/active-turn-command-controller.ts`
- `src/cli/active-turn-command-controller.test.ts`
- `ToolActivityAnimator` inside `src/cli/session-loop.ts`
- fixed tool slot padding such as `TOOL_SLOT_COUNT = 5`
- bottom chrome transient spinner tickers
- bottom chrome active chrome tickers
- `writeAboveChrome` / `writeAboveChromeNoRestore` plumbing
- `suspendChromeForTranscript` style prompt-region plumbing
- manual active-turn transient line arrays
- terminal row clearing helpers that only exist for live chrome patches
- terminal renderer portions of `src/cli/interactive-select.ts` after setup
  panels use console widgets
- old approval text prompt shells once inline approval cards own focus/input
- `rawPromptRenderLoop.ts` if the console renderer fully replaces it, or reduce
  it to a compatibility wrapper

Do not delete:

- semantic view-model builders;
- slash command registry;
- approval/security policy;
- plain/no-color/no-Unicode renderers;
- Arabic/bidi helpers;
- `parseKeypress`;
- line editor/cursor utilities;
- Papyrus widgets and screen primitives;
- non-interactive command output paths.

## Validation Expectations

Baseline before implementation work:

```bash
pnpm exec vitest run src/cli/session-loop.test.ts src/cli/rawPromptController.test.ts src/cli/papyrus-prompt.test.ts src/cli/approval-prompt-adapter.test.ts src/ui/papyrus src/ui/renderers
```

Focused implementation validation should add or update tests for:

- `Alt+Enter` newline insertion;
- `Enter` submit behavior;
- paste preserving newlines;
- multiline prompt expansion and internal scroll;
- prompt cursor visibility after resize;
- slash menu anchoring;
- persistent rail containing only model/context/session timer;
- attachment focus, preview, removal, overflow, and submitted transcript refs;
- uncapped tool activity and collapsed turn-end summary;
- approval card focus and approve/reject/inspect intent mapping;
- hardline and policy-denied approval safety;
- queued steer, cancellation, and `Ctrl+C` interrupt invariants;
- Arabic startup/status/setup layout with isolated technical tokens;
- narrow terminal fallbacks;
- no stale/ghost lines after setup page navigation.

Full validation before shipping an implementation PR:

```bash
pnpm run test
pnpm run smoke
pnpm run build
pnpm run audit:runtime-imports
pnpm run audit:esm
pnpm run smoke:dist
git diff --check
```
