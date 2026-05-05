# EstaCoda v0.0.4 Release Notes

## Summary

v0.0.4 makes EstaCoda reachable, schedulable, and operable outside the terminal without accidental context bleed or unreliable background execution. It introduces a multi-channel gateway, cron reliability hardening, explicit cross-surface session handoff, and a unified delivery layer.

## What's New

### Multi-Channel Gateway

- **Telegram** (live-proven): Polling, attachments, progress messages, operator commands, diagnostics, and run record linkage.
- **Discord** (implemented): Bot receives DMs and server messages; per-user sessions; allowed users/guilds/channels; attachments; typing indicators; prefix operator commands.
- **Email** (implemented): IMAP UNSEEN polling; SMTP reply-in-thread with `In-Reply-To`/`References`; allowed senders; self/noreply/automated filters; plain-text + HTML body; rich MIME parsing; inline image/media handling; file attachment ingestion and forwarding; `MEDIA:/path` outgoing.
- **WhatsApp** (experimental): Baileys adapter; QR/pairing-code authentication; DM-first model; media send/receive; message chunking; allowlist; delivery failure behavior documented. Unofficial API — account suspension risk acknowledged.

### Unified Delivery Layer

- `DeliveryRouter` routes messages to any channel using Hermes-compatible target syntax: `origin`, `local`, `telegram:chatId:threadId`, `discord:channelId:threadId`, `email:address`, and comma-separated multi-target.
- Adapters register delivery capability with the router.
- Cron output routes through `DeliveryRouter` to any channel.
- Oversized output truncated to platform limits (4000 chars default) with full output saved to disk.

### Cron Reliability

- **Execution history:** `CronExecutionStore` persists queryable history in SQLite (`cron_executions` table) without mutating `CronJob` objects.
- **Robust tick lock:** Lock file contains `{pid, startedAt}`; stale lock recovery after 5 minutes (PID-based deadlock prevention).
- **Duplicate prevention:** `advance_next_run()` called under lock before execution.
- **Fresh session default:** Every run gets a new session ID (`cron_{job_id}_{timestamp}`).
- **Recursion guard:** Cron jobs run with `disabled_toolsets=["cronjob", "messaging", "clarify"]` to prevent self-scheduling loops.
- **Failure classification:** `script-failed`, `runtime-error`, `delivery-failed`, `timeout`, `provider-error`.
- **Delivery status:** `sent`, `failed`, `not_configured`.

### CLI ↔ Telegram Handoff

- **Surface pointer model:** Explicit `surfacePointer → sessionId` mapping layer enables attach/detach without session migration.
- **Handoff codes:** 8-character codes from 32-char unambiguous alphabet (no 0/O/1/I); 15-minute expiry; max 3 pending codes per platform; rate-limited (1 request per user per 10 minutes); lockout after 5 failed attempts (1 hour).
- **Attach/detach semantics:**
  - `estacoda handoff telegram` generates a code from the CLI.
  - `/attach <code>` from Telegram binds chat to the CLI session.
  - `/detach` from Telegram returns chat to an independent session.
  - `estacoda sessions detach telegram` from CLI removes binding.
- **Safety:** No accidental context bleed when not attached; cross-surface sessions are separate by default.

### Operator Surface

- **Gateway status:** `estacoda gateway status` shows process, channels, health, paired identities, active sessions, pending approvals, cron status, next due jobs, and recent failures.
- **Gateway diagnostics:** `estacoda gateway diagnose` checks credentials and config for all channels + cron.
- **Session commands:** `estacoda sessions list|show|attach|detach|resume`.
- **Channel commands:** `estacoda channels list|status`.
- **Cron commands:** `estacoda cron list|show|history|pause|resume|run|remove`.

### Test Infrastructure

- **Vitest runner:** `bun test` invokes Vitest with Bun-compatible settings.
- **Fake channel adapters:** Test doubles for Telegram, Discord, WhatsApp, and Email that record all sent messages and simulate delivery failures.
- **DeliveryRouter unit tests:** Target parsing, routing, truncation, and multi-target delivery.

### Schema Migrations

- `SQLiteSessionDB` extended with `cron_executions` table.
- Surface pointer and handoff stores use existing session DB.

## Validation

- **Type check:** `bun run typecheck` — clean
- **Smoke tests:** `bun run smoke` — 3/3 passed
- **Unit tests:** `bun test` — 190 tests passed
- **Eval fixtures:** `bun run scripts/run-eval-fixtures.ts` — 27/27 passed

## Known Limitations

### Channels
- **Telegram** is the only live-proven channel. Discord, Email, and WhatsApp are implemented but not live-proven.
- **Discord slash commands** are deferred.
- **WhatsApp** is experimental and uses an unofficial API (Baileys). Meta may suspend accounts using it.
- **Email live smoke** is optional/manual.
- **Gateway status** reports readiness, not background-process liveness.

### Cron
- Cron store remains JSON-based. SQLite is used for execution history only.
- No automatic catch-up for missed jobs beyond per-job duplicate prevention.

### Sessions
- Cross-surface sessions are separate by default. Explicit attach/detach is required.
- No automatic context merge when attaching.
- Handoff codes have no built-in rate limiter; mitigation relies on TTL + keyspace + single-use + allowlist.

### TaskFlow (carried forward from v0.0.3)
- Checkpoints are recorded but not restorable.
- Flows are scoped to a single session; no cross-session resumption.
- Lock service is single-process SQLite only.
- Auto-compaction is disabled by default.
- No automatic retry without operator invocation.

### Architecture
- `create-runtime.ts` remains a large factory with no DI boundary.
- `AgentLoop` retains coupling in prompt assembly and memory context injection.
- Bun lock-in prevents Node execution.

## Files Changed in v0.0.4

- `src/channels/delivery-router.ts` (new)
- `src/channels/delivery-router.test.ts` (new)
- `src/channels/handoff-store.ts` (new)
- `src/channels/handoff-store.test.ts` (new)
- `src/channels/surface-pointer-store.ts` (new)
- `src/channels/whatsapp-adapter.ts` (new)
- `src/channels/whatsapp-diagnostics.ts` (new)
- `src/channels/email-adapter.ts` (new)
- `src/channels/email-delivery.ts` (new)
- `src/channels/discord-adapter.ts` (new)
- `src/cron/cron-execution-store.ts` (new)
- `src/cron/cron-lock.ts` (new)
- `src/cli/gateway-commands.ts` (new)
- `src/cli/gateway-commands.test.ts` (new)
- `src/cli/cli-sessions.test.ts` (new)
- `src/cron/cron-command.test.ts` (new)
- `src/test/proof-of-life.test.ts` (new)
- `src/test/fakes/*` (new)
- `src/channels/channel-gateway.ts` (modified)
- `src/channels/telegram-adapter.ts` (modified)
- `src/channels/channel-approval-store.ts` (modified)
- `src/cron/cron-runner.ts` (modified)
- `src/cron/cron-store.ts` (modified)
- `src/cron/cron-command.ts` (modified)
- `src/session/sqlite-session-db.ts` (modified)
- `src/cli/cli.ts` (modified)
- `src/config/runtime-config.ts` (modified)
- `package.json` (modified — discord.js dependency)
- `vitest.config.ts` (new)
- `README.md` (updated)
- `ROADMAP.md` (updated)
- `docs/architecture/overview.md` (updated)
- `docs/subsystems/channels.md` (updated)
- `docs/subsystems/cron.md` (updated)
- `docs/subsystems/security.md` (updated)
- `docs/operations/operator-controls.md` (updated)
- `docs/operations/v0.9-validation-report.md` (new)

## Tag

- **Tag:** `v0.9.0`
- **Commit:** `ad42530`
- **Date:** 2026-05-04
