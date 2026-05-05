# Changelog

## v0.1.0 (upcoming)

### Distribution and Lifecycle
- `estacoda` with no arguments launches interactive session or onboarding as appropriate
- `estacoda --version`, `estacoda -v`, `estacoda version` print the current version
- `estacoda init` bootstraps state directories with safe defaults (no provider setup required)
- `estacoda update` shows available updates without modifying files (dry-run by default)
- `estacoda update --apply` applies updates only when `ESTACODA_UPDATE_ARTIFACT` is defined and testable
- Install script at `scripts/install.sh` with Bun-backed dev fallback
- State preservation rules define protected paths for backup/restore
- `estacoda verify` checks config syntax and state directory backup readiness
- `estacoda doctor` reports state directory health, config syntax validity, and capability directory existence

### Documentation
- Added `docs/install.md` and `docs/uninstall.md`
- Added `CHANGELOG.md`

### Security
- No silent security policy weakening
- All install/remove operations create backups
- Secrets are never logged in verify, doctor, or update output

## v0.0.5

- See `Release_Notes_v0.0.5.md`

## v0.0.4

- See `Release_Notes_v0.0.4.md`

## v0.0.3

- See `Release_Notes_v0.0.3.md`
