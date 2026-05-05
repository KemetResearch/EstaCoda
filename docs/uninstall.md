# Uninstall EstaCoda

## Remove binary and state

```bash
# Remove the binary
rm -f ~/.estacoda/bin/estacoda
rm -f ~/.local/bin/estacoda

# Remove state (this deletes all config, memory, skills, and sessions)
rm -rf ~/.estacoda

# Remove PATH entries from shell rc files
# Edit ~/.bashrc, ~/.zshrc, or ~/.config/fish/config.fish
# and remove the lines that reference ESTACODA_HOME.
```

## Preserve state before removal

If you want to keep your configuration for a future reinstall:

```bash
# Back up state
cp -r ~/.estacoda ~/.estacoda-backup-$(date +%Y%m%d)

# Later, restore it:
mv ~/.estacoda-backup-YYYYMMDD ~/.estacoda
```

## Protected paths

The following paths are preserved during updates and should be backed up before uninstall:

- `~/.estacoda/config.json`
- `~/.estacoda/trust.json`
- `~/.estacoda/.env`
- `~/.estacoda/sessions.sqlite`
- `~/.estacoda/memory/`
- `~/.estacoda/skills/local/`
- `~/.estacoda/skills/.evolution/`
- `~/.estacoda/cron/`
- `PROJECT_ROOT/.estacoda/config.json`
