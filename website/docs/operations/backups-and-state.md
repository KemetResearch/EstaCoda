---
title: Backups and State
description: What to back up, what to leave alone, and where state lives.
sidebar_position: 4
---

# Backups and State

EstaCoda stores state in two scopes: global and profile-local. Understanding the boundary matters when you back up, migrate, or recover.

## Global state

Default root: `~/.estacoda/`

| Path | What it holds | Back up? |
|------|--------------|----------|
| `active-profile.json` | Active profile pointer | No. Easy to recreate. |
| `trust.json` | Workspace trust grants | Yes. Losing it means re-trusting workspaces. |
| `workspace-approvals.json` | Persistent workspace approvals | Yes. Losing it means re-approving scopes. |
| `sessions.sqlite` | Session database with `profile_id` scoping | Yes. Contains session history, trajectories, and eval records. |
| `update-cache.json` | Update check cache | No. Ephemeral. |
| `packs/registry.jsonl` | Global pack cache | No. Re-downloadable. |
| `memory/shared/` | Global shared memory snippets | Yes. Contains cross-profile knowledge. |

## Profile-local state

Profile root: `~/.estacoda/profiles/<id>/`

| Path | What it holds | Back up? |
|------|--------------|----------|
| `config.json` | Runtime configuration | Yes. Recreating it requires re-running setup. |
| `.env` | Secrets and API keys | Yes. Irreplaceable. Store it encrypted. |
| `auth.json` | OAuth tokens (e.g., Codex) | Yes. Re-authentication required if lost. |
| `USER.md` | User preferences and style | Yes. Learned context. |
| `SOUL.md` | Identity and safety memory | Yes. Learned context. |
| `MEMORY.md` | Learned facts and conventions | Yes. Learned context. |
| `promotions.json` | Promotion metadata | Yes. Part of learned context. |
| `gateway/` | Gateway sessions, approvals, voice mode, handoff codes | Yes. Active gateway state. |
| `cron/jobs.json` | Scheduled job definitions | Yes. Re-creating jobs is tedious. |
| `skills/` | Installed skills and evolution state | Yes. Custom skills are not reproducible. |
| `logs/` | Runtime and gateway logs | No. Logs are ephemeral. |
| `channel-media/` | Downloaded attachments | Optional. Re-downloadable in most cases. |
| `audio-cache/` | Audio cache | No. Regenerable. |
| `image-cache/` | Generated image cache | No. Regenerable. |
| `temp/` | Temporary files | No. Ephemeral. |
| `external-memory/` | File-backed external memory records | Yes, if external memory is enabled. |

## What not to edit blindly

- `sessions.sqlite` — Do not edit directly. The schema is internal. Use CLI commands for inspection.
- `.env` and `auth.json` — Store encrypted backups. These files contain credentials.
- `gateway/` — Do not delete while the gateway is running. Stop the gateway first.
- `promotions.json` — Do not hand-edit unless you understand the promotion schema. Corrupting it can suppress memory entries.
- `skills/.evolution/` — Contains proposal metadata. Editing it manually can break the evolution pipeline.

## Backup workflow

```bash
# Back up a single profile
rsync -av ~/.estacoda/profiles/work/ /backup/estacoda-profiles/work/

# Back up global state
rsync -av ~/.estacoda/trust.json ~/.estacoda/workspace-approvals.json \
  ~/.estacoda/sessions.sqlite ~/.estacoda/memory/shared/ /backup/estacoda-global/
```

Exclude `logs/`, `temp/`, `audio-cache/`, `image-cache/`, `channel-media/`, `update-cache.json`, and `packs/` from routine backups.

## Recovery workflow

```bash
# Restore a profile
rsync -av /backup/estacoda-profiles/work/ ~/.estacoda/profiles/work/

# Restore global state
rsync -av /backup/estacoda-global/ ~/.estacoda/

# Verify
estacoda settings profile --profile work
estacoda gateway diagnose --profile work
```

## Migration notes

- Sessions are profile-scoped. A session from profile `default` does not appear in profile `work`.
- Global state is shared. Restoring `trust.json` affects all profiles.
- `active-profile.json` is a pointer, not state. You can switch profiles without migrating data.

## Related docs

- [State and Files](../reference/state-and-files.md) — full path reference
- [FAQ](../reference/faq.md) — where does state live
- [Gateway Operations](./gateway-operations.md) — gateway state management
