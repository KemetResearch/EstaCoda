# Uninstall Behavior

This is the operational uninstall contract for v0.1.0 release readiness.

## Command

```bash
estacoda uninstall
estacoda uninstall --purge --yes
```

The default mode is keep-data. It removes managed install code, known source wrappers, installer-owned PATH entries, and gateway services where the existing service-manager abstraction can do so. It preserves `~/.estacoda`, including profiles, memory, sessions, config, auth, and trust files.

`--yes` by itself does not delete user data. Full user-data deletion requires `--purge --yes`.

## Ownership

Managed-source uninstall is allowed only when a valid `.install-method.json` stamp proves installer ownership. The stamp must declare `method: managed-source` and include trusted source metadata such as `sourceUrl`, branch metadata, and `installDir`.

Ambiguous installs are treated as manual-source. A plain git checkout is never deleted just because it looks like EstaCoda.

## Method Behavior

| Method | Default uninstall behavior |
|---|---|
| managed-source | Gateway teardown first, remove known wrappers/PATH lines, remove managed install dir, preserve `~/.estacoda` |
| manual-source | Gateway teardown first, remove known wrappers/PATH lines, leave the clone alone, preserve `~/.estacoda` |
| npm-global | Print `npm uninstall -g estacoda`; package-manager-owned wrappers are not manually removed |
| pnpm-global | Print `pnpm remove -g estacoda`; package-manager-owned wrappers are not manually removed |
| Homebrew | Print `brew uninstall estacoda`; `brew untap kemetresearch/tap` is not automatic |
| Docker | Print container/image guidance; containers, images, and volumes are not removed automatically |
| unknown | Remove only known source wrappers/PATH lines and preserve user data |

## Purge

`estacoda uninstall --purge --yes` removes user data after gateway teardown and install-code cleanup.

If other named profiles exist, the safe v0.1.0 behavior preserves them. The active profile can be removed, but bulk named-profile removal requires a future explicit flag and review. This prevents `--yes` from silently deleting unrelated profiles.

## Gateway Teardown

Gateway service teardown happens before code or user-state removal. The implementation uses the existing service-manager abstraction. It does not add raw `pkill`, `killall`, `systemctl`, or `launchctl` calls in the uninstall path.

Termux is best-effort: system service removal is skipped and known `$PREFIX/bin/estacoda` source wrappers are removed when they can be safely identified.

## Windows

Native Windows uninstall is not supported in v0.1.0. WSL2 remains best-effort.
