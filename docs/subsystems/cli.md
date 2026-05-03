---
title: "CLI & Onboarding"
description: "CLI commands, interactive session loop, and first-run onboarding."
---

# CLI & Onboarding

## Files

| File | Lines | Role |
|------|-------|------|
| `src/cli/cli.ts` | 2,562 | CLI command surface and dispatch |
| `src/cli/session-loop.ts` | 906 | Interactive terminal loop |
| `src/cli/cli-session-store.ts` | ~120 | Persisted active session pointer |
| `src/cli/one-shot.ts` | ~140 | One-shot prompt execution |
| `src/cli/slash-menu.ts` | ~180 | Slash command menu rendering |
| `src/cli/tool-activity-renderer.ts` | ~160 | Tool activity display |
| `src/onboarding/interactive-onboarding.ts` | 1,155 | First-run setup wizard |
| `src/onboarding/onboarding-copy.ts` | 956 | Localized onboarding text |
| `src/onboarding/onboarding-flow.ts` | ~280 | Onboarding state machine |

## Commands

```bash
bun run dev                    # Interactive CLI
bun run dev -- setup           # Run setup wizard
bun run dev -- verify          # Verify configuration
bun run dev -- settings        # Show current settings
bun run dev -- doctor --live   # Live provider check
bun run dev -- telegram setup  # Configure Telegram
bun run dev -- gateway start --telegram  # Start gateway
```

## Interactive Session Loop

In-session commands:

| Command | Purpose |
|---------|---------|
| `/sessions` | List active sessions |
| `/search <query>` | Search session history |
| `/switch <session-id>` | Switch to another session |
| `/reset` | Start fresh session |
| `/trust` | Show workspace trust status |
| `/yolo` | Toggle open approval mode |
| `/skills` | List visible skills |
| `/tools` | List available tools |
| `/security` | Show recent security decisions |
| `/security debug` | Detailed security audit |
| `/cron` | List scheduled tasks |
| `/reload-mcp` | Reload MCP servers |
| `/exit` | Exit session |

## Session Resume

CLI startup restores the active workspace session from `cli-session-store.ts`. Fresh launches are no longer forced back to the default `scaffold` session.

## First-Run Onboarding

**Evidence:** `live-proven` (English and Arabic)

Setup sequence:

1. Interface language and expression style
2. Workspace trust prompt
3. Primary provider and model selection
4. Optional backup model
5. Hosted-provider API key capture (masked input, saved to `~/.estacoda/.env` with `0600`)
6. Security mode selection
7. Workflow-learning mode selection
8. Optional capabilities (Telegram, voice, vision, browser)
9. Setup verification
10. Immediate session start

**Arabic support:**
- Selector chrome is localized
- Technical tokens (provider names, paths, env vars, commands) remain in English with LTR isolation
- Full runtime CLI localization is **not** complete

## Profile / UI Foundation

Global config supports:

| Setting | Values |
|---------|--------|
| `ui.language` | `en`, `ar` |
| `ui.flavor` | aesthetic flavor presets |
| `agent.mode` | behavior mode |
| `agent.responseLanguage` | response language policy |

**Evidence:** `smoke-tested`
