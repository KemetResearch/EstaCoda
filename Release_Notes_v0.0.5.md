# v0.0.5 — UI/CLI Foundation

## Summary

v0.0.5 introduces EstaCoda's first formal UI/CLI foundation. The system now detects terminal capabilities, resolves themes and skins into semantic tokens, and renders all operator surfaces through a structured ViewModel → Renderer → SurfaceAdapter pipeline. Two rendering modes are supported: plain (ASCII-only, deterministic, safe for CI/logs/non-TTY) and standard (ANSI color, Unicode symbols, animation). All existing command semantics and exit codes are preserved.

## Highlights

- Structured ViewModel → Renderer → SurfaceAdapter pipeline
- Plain and standard rendering modes
- Light/dark theme support
- KemetBlue skin
- Command registry as source of truth
- Deterministic plain output for CI/logs/non-TTY
- Standard terminal renderer with ANSI/Unicode support
- Tool activity and approval/security surfaces
- Startup hero, input rail-frame, and picker rendering
- Status rail with session and task timers
- Channel-safe rendering adapters
- Provider-token streaming safety

## Changes

### Audit & Safety Harness

- Added a safety harness around UI/CLI rendering to prevent regressions in operator-facing output.
- Established snapshot and deterministic output contracts for all rendering paths.
- Verified no ANSI leakage into plain-mode output and no Unicode leakage into channel-safe adapters.

### Terminal Capability Detection

- Added `detectTerminalCapabilities()` to inspect TTY, `NO_COLOR`, `FORCE_COLOR`, `COLORTERM`, `TERM`, `LANG`, `COLUMNS`, and CI environment variables.
- Supports graceful degradation: non-TTY, `TERM=dumb`, `NO_COLOR=1`, narrow widths, and non-UTF-8 locales.
- Animation is gated by TTY + color + not-CI; static fallback frames prevent interleaving during provider-token streaming.

### Command Registry

- Centralized command registry is now the source of truth for all CLI and slash commands.
- Commands carry metadata: scope (CLI/slash/both), visibility, category, description, and arguments.
- Alias resolution is canonical: deprecated aliases resolve but are not listed; removed aliases do not resolve.
- Cron subcommands are namespaced under `cron` and do not leak to top-level resolution.

### Theme, Mode, Skin, and Token System

- Semantic token contract decouples rendering from hardcoded values.
- Modes: `standard` (ANSI + Unicode + animation) and `plain` (ASCII-only, no ANSI).
- Themes: `light` and `dark` with neutral surfaces and semantic severity colors.
- Skin: `kemetBlue` overlay with approved Egyptian Arabic taglines and branding symbols.
- Token resolver enforces invariants: plain mode forces ASCII prompt/spinner/icons, disables color and animation, and strips Unicode branding.

### ViewModel Foundation

- All operator surfaces now build ViewModels instead of concatenating strings.
- ViewModels are pure data with a `kind` discriminator: `Status`, `Table`, `List`, `KeyValueBlock`, `WarningError`, `ApprovalSecurity`, `ActivityTimeline`, `ProgressRail`, `CommandResult`, `Startup`, `Picker`, `AssistantResponse`, `PlainFallback`.
- Builder helpers produce deterministic, serializable output with no functions and no ANSI escape codes.

### Plain Renderer

- `PlainRenderer` produces ASCII-only output safe for logs, CI, and non-TTY pipes.
- Tables use space-aligned columns with right-aligned numeric values.
- Lists use ordered/unordered ASCII bullets.
- Warnings/errors use bracketed severity labels (`[ERROR]`, `[WARN]`).
- Tool activity uses ASCII markers (`[*]`, `[+]`, `[x]`, `[!]`).
- Progress rail uses ASCII step indicators.
- Deterministic: identical input always produces identical output.

### Standard Renderer and Animation Primitives

- `StandardRenderer` produces ANSI-colored, Unicode-enriched terminal output.
- Supports dark and light themes with semantic color application.
- Visual primitives: status on rails, inline severity signals, framed focus panels for approvals, hero panels for startup.
- `AnimationController` cycles through spinner frames when enabled; is a no-op in plain/non-TTY/CI/dumb mode.
- Streaming safety: animation never writes to stdout directly; static fallback prevents token interleaving.

### Core Session Operator Surfaces

- Migrated `/status`, `/model`, `/sessions`, `/attach`, `/detach`, `/resume`, and session listing to the ViewModel pipeline.
- All session commands render consistently across plain and standard modes.
- Surface pointer model (attach/detach) renders through the same pipeline.

### Gateway, Diagnose, and Channels

- Migrated `gateway status`, `gateway diagnose`, `channels list`, and `channels status` to ViewModels.
- Gateway status shows process, channels, health, paired identities, active sessions, pending approvals, cron status, next due jobs, and recent failures.
- Diagnose checks credentials and config for all channels + cron.
- Channel status supports Telegram, Discord, Email, and WhatsApp (experimental) with appropriate readiness reporting.

### Cron, Sessions, and Handoff

- Migrated `cron list`, `cron show`, `cron history`, `cron pause`, `cron resume`, `cron run`, `cron remove` to ViewModels.
- Cron execution history renders as tables with failure classification.
- Handoff code generation and redemption surfaces render through the pipeline.

### Tool Activity, Approval, Security, and Status Rail

- Migrated tool activity timeline, approval prompts, security gates, and status rail to ViewModels.
- Tool activity renders with severity-aware markers and elapsed duration.
- Approval/security surfaces render framed panels with risk class and action buttons.
- Status rail includes session metadata and task/flow timers.

### Startup, Picker, and Session Loop Surfaces

- Startup hero renders a branded panel with taglines, version, model info, and readiness warnings.
- Picker renders selectable options with current selection highlighted.
- Input rail-frame uses thin horizontal rules (`───` in standard, `---` in plain) and prompt prefix; no full box frame.
- Assistant response renders with `EstaCoda` branding: `U+13000` symbol in standard mode, ASCII-safe label in plain/channel mode.

### Channel-Safe Rendering

- Added surface adapters for Telegram, Discord, Email, and WhatsApp.
- Channel adapters strip ANSI and terminal-only frames; emoji is gated by adapter capability.
- `DeliveryRouter` integrates `deliverViewModel()` with surface adapter fallback to plain renderer.
- Cross-adapter tests verify zero ANSI in all channel-safe output.

### Documentation and Final Validation

- Added `docs/ui-architecture.md`: pipeline, capability detection, streaming safety.
- Added `docs/theme-tokens.md`: semantic tokens, skin overlays, KemetBlue.
- Added `docs/rendering-guide.md`: contributor walkthrough for adding CLI surfaces.
- Added `docs/manual-qa.md`: environment fallback validation procedures.
- Updated README with documentation links.

## Compatibility

- Existing command semantics preserved.
- Existing exit codes preserved.
- Backward-compatible string wrappers preserved:
  - `runtime.describe()` returns `string`.
  - Legacy tool activity wrapper continues to work.
- Channel backend behavior preserved (Telegram, Discord, Email, WhatsApp).
- Plain output remains safe for scripts/logs.
- Cron store remains JSON-based; execution history in SQLite.

## Validation

- `bun run test`: 866 passed (29 test files)
- `npm run test:node`: 804 passed (24 test files)
- `bun run typecheck`: clean
- `bun run smoke`: 3/3 passed

## Deferred

- Auto/system theme detection
- Full BiDi/RTL layout
- Channel backend redesign
- Rich channel cards/embeds/buttons
- Removal of deprecated string wrappers
- Runtime theme switching
- Web dashboard / GUI

## Tag

- **Tag:** `v0.0.5`
- **Commit:** `9a588d1`
- **Package version:** `0.0.5`
