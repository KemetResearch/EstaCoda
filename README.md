# EstaCoda

EstaCoda is a TypeScript agent runtime for local terminal work, channel-based operation, editor integration, workflow learning, and media-capable agent tooling.

The project is currently an **MVP candidate for private/internal use**. The core CLI agent, onboarding, provider setup, security modes, workflow-learning controls, multi-channel gateway, MCP client, ACP foundation, browser tools, voice/TTS foundation, cron with execution history, skills, memory, artifact paths, and **durable TaskFlow execution** are implemented and covered by smoke tests or live operator proof. It is not yet packaged as a public release.

## Quick Start

```bash
cd /path/to/EstaCoda
bun install
bun run dev
```

On first launch, EstaCoda runs an interactive setup flow:

- choose interface language and expression style
- trust the active workspace
- choose primary and optional backup model routes
- store hosted-provider keys locally in `~/.estacoda/.env` with `0600` permissions
- choose security mode: `strict`, `adaptive`, or `open`
- choose workflow-learning mode: `none`, `suggest`, `proactive`, or `autonomous`
- optionally configure Telegram, Discord, Email, WhatsApp, voice, vision/image generation, and browser support
- verify readiness, then start the first agent session

## Core Capabilities

- Provider-backed CLI agent loop with real tool execution.
- Capability-first security with approval modes, hard safety floor, `/yolo`, and audit/debug views.
- Local and project config overlays with local secret storage.
- Bounded memory through `MEMORY.md`, `USER.md`, `SOUL.md`, and `AGENTS.md`.
- Skill system with visibility, usage telemetry, evolution overlays, gated proposals, snapshots, rollback, and scored eval fixtures.
- **Multi-channel gateway (v0.9):**
  - **Telegram** — live-proven: allowlists, approvals, sessions, attachments, voice transcription hooks, generated-image delivery, pairing codes.
  - **Discord** — implemented: DM/channel/thread support, allowlists, attachments, text delivery. Slash commands deferred to v0.9.1.
  - **Email** — implemented: IMAP receive, SMTP send, reply-in-thread, attachments, allowed senders, home address. Uses global security policy; no email-specific approval friction.
  - **WhatsApp** — experimental: Baileys linked-device adapter, QR/pairing-code login, DM-first, media, chunking. Gated behind `experimental: true`. See security docs for unofficial-API risk.
- **DeliveryRouter** — normalized delivery path for all channels: local, origin, Telegram, Discord, WhatsApp, Email, silent.
- MCP client for stdio and HTTP servers, including reload semantics.
- ACP stdio server foundation for editor clients.
- Browser automation through a local Chrome DevTools Protocol backend.
- **Cron jobs (v0.9 hardened)** — persistent store, prompt scanning, script-backed jobs, tick locking, per-job duplicate prevention, execution history in SQLite, failure classification, delivery routing, recursion guard.
- Voice/TTS/STT configuration foundation and audio artifacts.
- Image generation with FAL and BytePlus/ModelArk Seedream provider support.
- English and Arabic first-run onboarding, with localized setup labels and supported status copy.
- **Durable TaskFlow execution** (v0.8): multi-step flows with pause/resume/interrupt/cancel, step-level status, operator steer, approval gates, safe-boundary compaction, and restart recovery.
- **Operator surface (v0.9):** CLI commands for gateway status/diagnose, channels list/status, cron list/show/history/run/pause/resume/remove, sessions list/show/current/attach/detach.
- **Cross-surface sessions (v0.9):** explicit attach/detach via surface pointers; CLI↔Telegram handoff with short-lived single-use codes.

## TaskFlow (v0.8)

TaskFlow adds durable, observable multi-step execution:

- **Flows** represent high-level objectives; **steps** represent discrete actions.
- State is persisted to SQLite alongside session data.
- Operator controls: `/flow` slash commands and `estacoda flow` CLI commands.
- `/steer` injects explicit operator guidance into the next turn.
- Safe-boundary compaction preserves the full audit trail.
- Restart recovery marks interrupted flows/steps on startup.
- Requires SQLite session persistence; not available with in-memory sessions.

See [TaskFlow Architecture](docs/architecture/taskflow.md) and [Operator Controls](docs/operations/operator-controls.md) for details.

## Checks

Run these before pushing changes:

```bash
cd /path/to/EstaCoda
bun run typecheck
bun run smoke
bun run scripts/run-eval-fixtures.ts
```

For a clean first-run onboarding check:

```bash
rm -rf /tmp/estacoda-e2e-home
mkdir -p /tmp/estacoda-e2e-home
HOME=/tmp/estacoda-e2e-home bun run dev
```

## State

By default, user-level state lives under `~/.estacoda/`:

- `config.json`
- `.env`
- `trust.json`
- `sessions.sqlite`
- `memory/`
- `skills/`
- `cron/`
- `image-cache/`
- `audio-cache/`
- `channel-media/`

Project overlays live under `<workspace>/.estacoda/`.

## Docs

- [Documentation Index](docs/README.md)
- [Architecture](docs/architecture/)
- [Subsystems](docs/subsystems/)
- [Operations](docs/operations/)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Onboarding

EstaCoda starts with a guided first-run setup when no usable configuration is found:

```bash
bun run dev
```

The setup flow walks through:

1. Interface language and expression style.
2. Workspace trust.
3. Primary provider and model.
4. Optional backup provider and model.
5. Protected API key capture into `~/.estacoda/.env`.
6. Security mode (`strict`, `adaptive`, or `open`).
7. Workflow learning mode (`none`, `suggest`, `proactive`, or `autonomous`).
8. Optional capabilities: Telegram, Discord, Email, WhatsApp, voice, vision, image generation, browser automation.
9. Readiness check before the first agent agent session.

Credentials are stored locally with restrictive permissions. Advanced users can point EstaCoda at existing environment variables instead of pasting keys during setup.

Workspace trust is path-scoped. A trusted workspace allows normal local file and terminal work under the configured security policy.

`open` mode is not "security off"; the hard safety floor remains active.
