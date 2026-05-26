---
title: Quickstart
description: Get EstaCoda running in minutes.
sidebar_position: 2
---

# Quickstart

EstaCoda is a command-line agent system. This page gets you from zero to a working first session. It assumes a POSIX environment with Node.js 22.18.0 or newer.

## Default install

The fastest path is the public installer endpoint:

```bash
curl -fsSL https://estacoda.kemetresearch.com/install.sh | bash
```

This creates a managed-source install under `~/.estacoda/estacoda`, builds the project, writes a wrapper to `~/.local/bin/estacoda`, and runs `estacoda init`.

If `~/.local/bin` is not on your PATH, add it:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then configure your first provider:

```bash
estacoda setup
```

The setup flow walks you through provider selection, model choice, and credential configuration. It writes profile state under `~/.estacoda/profiles/default/`.

After setup, start a session:

```bash
estacoda
```

## Install with flags

Install to a custom directory and skip the initial state bootstrap:

```bash
curl -fsSL https://estacoda.kemetresearch.com/install.sh | bash -s -- --dir <path> --skip-init
```

## Contributor path

If you plan to modify the source, clone the repo and run the setup script:

```bash
git clone https://github.com/KemetResearch/EstaCoda.git
cd EstaCoda
./scripts/setup-estacoda.sh
```

This creates a manual-source install. The checkout is preserved during uninstall and update operates in check-and-advise mode.

## First-run checklist

After install, verify readiness:

```bash
estacoda verify
```

Check provider status:

```bash
estacoda model status
```

Run diagnostics:

```bash
estacoda doctor
```

## What next

- [Installation](./installation.md) — all install paths, OS support, and runtime requirements
- [Uninstall](./uninstall.md) — remove EstaCoda while preserving or deleting user data
- [Updating](./updating.md) — update behavior for each install method
- [CLI Commands](../reference/cli-commands.md) — full command reference
- [State and Files](../reference/state-and-files.md) — where profile state lives
