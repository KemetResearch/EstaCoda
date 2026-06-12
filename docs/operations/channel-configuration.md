---
title: "Channel Configuration"
description: "Config schema, fields, and examples for all four channels."
---

# Channel Configuration

Channel configuration lives in the selected profile config: `~/.estacoda/profiles/<id>/config.json`. All four channels share a common base structure with adapter-specific fields.

## Common Fields

Every channel object supports:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Whether the adapter is loaded by `estacoda gateway run` or by an installed service started with `estacoda gateway start`. |
| `busyPolicy` | `"reject" \| "queue" \| "interrupt"` | `"reject"` | Behavior when a new message arrives during an active turn. |
| `queueDepth` | `number` | `3` | Maximum buffered messages when `busyPolicy` is `"queue"`. Clamped to `[1, 10]`. |

## Telegram

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botTokenEnv": "ESTACODA_TELEGRAM_BOT_TOKEN",
      "allowedUserIds": ["123456789"],
      "allowedChatIds": ["-1001234567890"],
      "groupSessionsPerUser": true,
      "threadSessionsPerUser": false,
      "sessionResetPolicy": "idle",
      "sessionIdleResetMinutes": 30,
      "pollTimeoutSeconds": 30,
      "maxAttachmentBytes": 10485760,
      "busyPolicy": "queue",
      "queueDepth": 5
    }
  }
}
```

Guided setup asks for:

- Telegram bot API token.
- Allowed Telegram user IDs.
- Allowed Telegram group chat IDs.

Guided setup does not ask for the bot-token env-var name. The token is written to the selected profile `.env` as `ESTACODA_TELEGRAM_BOT_TOKEN`, and the profile config uses `botTokenEnv: "ESTACODA_TELEGRAM_BOT_TOKEN"`. Config review and setup output must redact the raw token.

Use `@BotFather` and `/newbot` to get the bot API token. Use `@userinfobot` and `/start` to get Telegram user IDs. For group chats, add the EstaCoda bot and either `@getidsbot` or `@chatIDrobot` to the group; the ID bot replies with the group chat ID, usually a long negative number.

## Discord

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "botTokenEnv": "ESTACODA_DISCORD_TOKEN",
      "allowedUsers": ["123456789"],
      "allowedGuilds": ["123456789"],
      "allowedChannels": ["123456789"],
      "freeResponseChannels": ["123456789"],
      "voiceChannel": {
        "enabled": false,
        "autoJoinOnCommand": true
      },
      "busyPolicy": "reject",
      "queueDepth": 3
    }
  }
}
```

`channels.discord.voiceChannel.enabled` defaults to `false`. When enabled, EstaCoda requests `GatewayIntentBits.GuildVoiceStates` and `/voice channel` can delegate to Discord voice capability methods. `autoJoinOnCommand` defaults to `true`. The bot must have `Connect`, `Speak`, and `UseVAD` permissions before joining; missing optional voice dependencies or permissions return structured setup errors.

See [Voice Operations](./voice.md) for optional package and troubleshooting details.

## Email

```json
{
  "channels": {
    "email": {
      "enabled": true,
      "imapHost": "imap.example.com",
      "imapPort": 993,
      "smtpHost": "smtp.example.com",
      "smtpPort": 587,
      "username": "bot@example.com",
      "passwordEnv": "EMAIL_PASSWORD",
      "ownAddress": "bot@example.com",
      "homeAddress": "operator@example.com",
      "allowedSenders": ["operator@example.com"],
      "allowAllUsers": false,
      "pollIntervalSeconds": 30,
      "maxAttachmentBytes": 10485760,
      "busyPolicy": "reject",
      "queueDepth": 3
    }
  }
}
```

## WhatsApp

Use the single setup wizard:

```bash
estacoda whatsapp
```

The wizard uses QR-only device pairing and renders the QR code in the terminal. It checks the isolated bridge package under `scripts/whatsapp-bridge/`; if dependencies are missing, it asks before running the repair/install step. It does not silently install dependencies or write WhatsApp config until QR pairing succeeds.

```json
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "experimental": true,
      "authDir": "~/.estacoda/profiles/<id>/gateway/whatsapp-auth",
      "mode": "bot",
      "dmPolicy": "allowlist",
      "groupPolicy": "disabled",
      "allowedUsers": ["1234567890"],
      "allowedGroups": [],
      "replyPrefix": "EstaCoda: ",
      "pairingMode": "qr",
      "busyPolicy": "reject",
      "queueDepth": 3
    }
  }
}
```

If no allowed WhatsApp users are added during setup, `dmPolicy` is set to `"pairing"`. That means the device can be QR-paired, but the channel is not reported as fully ready and messages are not open to arbitrary users. User authorization codes are separate from device QR pairing: codes are displayed once by operator flows, expire after 10 minutes, are single-use, and are persisted only as salted SHA-256 hashes in profile-local state.

WhatsApp DM policies are explicit: `"disabled"` rejects direct messages, `"allowlist"` accepts canonical `allowedUsers`, `"pairing"` only allows authorization-code redemption plus denial handling, and `"open"` accepts all DMs only when configured. Group policy fails closed by default: `"disabled"` ignores groups, `"allowlist"` accepts canonical `allowedGroups`, and `"open"` accepts all groups only when configured.

WhatsApp allowlists use canonical identities. Phone numbers and `@s.whatsapp.net` JIDs normalize to digits, `@lid` IDs normalize case-insensitively, and group IDs normalize as `@g.us` JIDs. LID/phone aliases are stored profile-locally without message content.

Use `mode: "self-chat"` only when the linked account is intentionally used as the operator chat. In self-chat mode EstaCoda prefixes replies with `replyPrefix` and suppresses echoes by recent sent message ID or prefix; in `mode: "bot"`, `fromMe` messages are ignored and no reply prefix is applied.

WhatsApp does not stream visible progress. Tool/provider progress is best-effort typing presence only, and users receive the final reply after the turn finishes. Final text is adapted to WhatsApp formatting and chunked by the adapter. Telegram remains richer for live progress and inline action UX; WhatsApp supports final text, quoted first replies where possible, and media delivery through the isolated bridge.

Rapid normal WhatsApp text messages are debounced at the gateway before runtime execution. Defaults are `textDebounceMs: 5000`, `textDebounceMaxMessages: 10`, and `textDebounceMaxChars: 8000`; set `textDebounceMs: 0` to disable the quiet window. Debounce applies only to normal WhatsApp text turns after authorization and group mention routing. Slash commands, `/stop`, `/status`, `/approve`, `/deny`, authorization-code redemption, and messages with media or other attachments bypass debounce and execute immediately.

WhatsApp media delivery accepts only main-runtime validated local paths. The trusted workspace root and profile-local channel media/temp roots are allowed; arbitrary system paths are rejected before the bridge sees them. Explicitly allowed remote media URLs are downloaded into the profile-local channel media cache first and still obey upload size limits. Text-like inbound document previews are bounded before prompt assembly; binary documents and oversized media surface as structured attachment status rather than injected content.

For WhatsApp voice bubbles, install `ffmpeg` in the operator environment. Voice-hinted audio that is already OGG/Opus is sent as voice/PTT. Incompatible provider audio converts to OGG/Opus in the main runtime under profile-local temp/media roots; if `ffmpeg` is unavailable or conversion fails, EstaCoda falls back to normal audio delivery with a clear fallback caption.

**Important:** WhatsApp requires `experimental: true`. The transport uses the unofficial Baileys API through the isolated bridge package, so account suspension risk remains. See [Security](../security/handoff-preflight-report-v0.9.md) for unofficial-API risk.

## Defaults

If `busyPolicy` or `queueDepth` is omitted for a channel, the runtime uses:
- `busyPolicy`: `"reject"`
- `queueDepth`: `3`

There is no top-level `channels.busyPolicy` or `channels.queueDepth`. Each channel configures its own policy independently.
