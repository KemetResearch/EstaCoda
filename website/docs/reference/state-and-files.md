---
title: State and Files
description: Global and profile-local state paths.
sidebar_position: 7
---

# State and Files

EstaCoda stores state in two scopes: global (under `~/.estacoda/`) and profile-local (under `~/.estacoda/profiles/<profile-id>/`). The active profile is tracked globally; everything else is owned by the selected profile.

## Global state

Default root: `~/.estacoda/`

| Path | Purpose | Created by |
|------|---------|------------|
| `active-profile.json` | Active profile pointer | `estacoda init`, `estacoda profile switch` |
| `trust.json` | Workspace trust grants | `estacoda workspace trust` |
| `workspace-approvals.json` | Workspace approval grants | Approval commands |
| `sessions.sqlite` | Global session database with `profile_id` scoping | Runtime initialization |
| `update-cache.json` | Update check cache | Update command |
| `packs/registry.jsonl` | Global pack cache | Pack operations |
| `memory/shared/` | Global shared memory snippets | Memory operations |

Global state is not deleted when a profile is removed. If you want a clean slate, delete the global root. Backup your sessions database first if you care about history.

## Profile-local state

Profile root: `~/.estacoda/profiles/<id>/`

| Path | Purpose | Created by |
|------|---------|------------|
| `config.json` | Selected profile runtime configuration | `estacoda init`, `estacoda setup`, manual edit |
| `.env` | Selected profile secrets | Setup flows, secret store |
| `auth.json` | Selected profile OAuth auth state | Codex OAuth setup |
| `USER.md` | Profile user preferences and communication style | Memory promotion, `memory.curate` |
| `SOUL.md` | Profile identity and safety memory | `memory.curate` |
| `MEMORY.md` | Profile learned facts and conventions | Memory promotion, `memory.curate` |
| `promotions.json` | Promotion metadata | Memory promotion |
| `gateway/` | Gateway state: sessions, approvals, voice mode, handoff codes | Gateway runtime |
| `cron/jobs.json` | Cron job definitions | `estacoda cron create` |
| `skills/` | Profile-installed skills | Skill operations, learning |
| `skills/.usage.json` | Skill usage telemetry | Runtime |
| `skills/.evolution/` | Skill evolution proposals and manifests | Skill evolution |
| `logs/` | Profile logs | Gateway, runtime |
| `channel-media/` | Channel attachment downloads | Gateway adapters |
| `audio-cache/` | Audio cache | Voice tools |
| `image-cache/` | Generated image cache | `image.generate` |
| `temp/` | Temporary files | Various operations |
| `temp/audio/` | CLI recordings, auto-TTS temps, Telegram conversion, Discord receive audio | Voice operations |
| `external-memory/` | File-backed external memory records | External memory (if enabled) |

## Ownership rule

- Global files are shared across all profiles.
- Profile-local files belong to exactly one profile.
- Commands that create state report which profile owns the change.
- Commands that inspect state require the selected profile or an explicit `--profile` flag.

## Recovery and inspection

```bash
# See which profile is active
cat ~/.estacoda/active-profile.json

# Inspect profile config
estacoda config show

# List all profiles
estacoda profiles list

# Check a specific profile's state tree
ls -la ~/.estacoda/profiles/work/

# View logs for the selected profile
tail -f ~/.estacoda/profiles/work/logs/gateway.log
```

## What not to do

- Do not edit `sessions.sqlite` directly unless you know the schema.
- Do not copy `.env` files between profiles without updating the paths and secrets.
- Do not delete `gateway/` while the gateway is running; stop the gateway first.

## Related docs

- [Configuration](./configuration.md) — config file content
- [Environment Variables](./environment-variables.md) — env var storage
- [Profiles](../user-guide/profiles.md) — profile management
- [Memory](../user-guide/memory.md) — memory file behavior
