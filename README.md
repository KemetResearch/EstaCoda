# EstaCoda

EstaCoda is a TypeScript agent runtime for local terminal work, channel-based operation, editor integration, workflow learning, and media-capable agent tooling.

The project is currently an **MVP candidate for private/internal use**. The core CLI agent, onboarding, provider setup, security modes, workflow-learning controls, Telegram image delivery, MCP client, ACP foundation, browser tools, voice/TTS foundation, cron, skills, memory, and artifact paths are implemented and covered by smoke tests or live operator proof. It is not yet packaged as a public release.

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
- optionally configure Telegram, voice, vision/image generation, and browser support
- verify readiness, then start the first agent session

## Core Capabilities

- Provider-backed CLI agent loop with real tool execution.
- Capability-first security with approval modes, hard safety floor, `/yolo`, and audit/debug views.
- Local and project config overlays with local secret storage.
- Bounded memory through `MEMORY.md`, `USER.md`, `SOUL.md`, and `AGENTS.md`.
- Skill system with visibility, usage telemetry, evolution overlays, gated proposals, snapshots, rollback, and scored eval fixtures.
- Telegram gateway with allowlists, approvals, sessions, attachments, voice transcription hooks, and generated-image delivery.
- MCP client for stdio and HTTP servers, including reload semantics.
- ACP stdio server foundation for editor clients.
- Browser automation through a local Chrome DevTools Protocol backend.
- Cron jobs with prompt scanning, script-backed jobs, tick locking, and local outputs.
- Voice/TTS/STT configuration foundation and audio artifacts.
- Image generation with FAL and BytePlus/ModelArk Seedream provider support.
- English and Arabic first-run onboarding, with localized setup labels and supported status copy.

## Checks

Run these before pushing changes:

```bash
cd /path/to/EstaCoda
bun run typecheck
bun run smoke
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
- [Roadmap](docs/ROADMAP.md)
