---
title: "Channels"
description: "Channel architecture: gateway, adapters, session management, and Telegram."
---

# Channels

Channels are the surfaces through which users interact with EstaCoda. Today, Telegram is the only live-proven channel.

## Files

| File | Lines | Role |
|------|-------|------|
| `src/channels/channel-gateway.ts` | 1,408 | Generic adapter bridge |
| `src/channels/telegram-adapter.ts` | 847 | Telegram-specific adapter |
| `src/channels/channel-session-store.ts` | ~240 | Persisted session mapping |
| `src/channels/channel-approval-store.ts` | ~180 | Approval persistence per channel |
| `src/channels/telegram-format.ts` | ~200 | Telegram-safe HTML formatting |
| `src/channels/activity-labels.ts` | ~80 | Localized activity labels |

## ChannelGateway

Responsibilities:

- Auth / allowlist / pairing
- Session mapping with normalized session-key policy
- Session auto-reset policy
- Session-admin commands (`/sessions`, `/search`, `/switch`)
- Runtime construction from fresh config snapshot per turn
- Progress delivery
- Approval prompt delivery
- Command handling

## Telegram Adapter

**Live-proven capabilities:**

| Capability | Evidence |
|------------|----------|
| Text replies | `live-proven` |
| Document analysis | `live-proven` |
| Image understanding (Kimi) | `live-proven` |
| Image generation delivery | `live-proven` |
| Progress compaction | `smoke-tested` |
| Inline approvals | `smoke-tested` |
| Session persistence | `smoke-tested` |
| Attachment download | `smoke-tested` |

**UX choices:**

- One evolving progress message per active turn
- Inline approval buttons map to `/approve` and `/deny`
- Final replies formatted in Telegram-safe HTML
- Activity labels localized (`en`, `ar`)
- Group sessions per-user by default
- Thread sessions shared by default
- Active chat → session mapping persists across gateway restarts

## Session Identity Policy

Channel session identity includes explicit chat/thread policy:

| Context | Default |
|---------|---------|
| DM | Per-user |
| Group | Per-user |
| Thread | Shared |

Configurable via runtime config.

## Gateway Runtime

Gateway turns rebuild runtimes from fresh config snapshots. This helps MCP reload semantics but means adapter-level settings are established at gateway start.

```bash
# Start gateway
bun run dev -- gateway start --telegram

# Check status
bun run dev -- gateway status
```

## Limitations

- Telegram is the only real launch channel.
- Gateway status reports readiness, not background-process liveness.
- Channel-specific safety rules are partial — general safety policy applies.
