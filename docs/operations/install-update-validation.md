# Install/Update Validation

This document describes the repo-side validation matrix for v0.1.0 install and update readiness.

## Commands

Run the full matrix:

```bash
pnpm run validate:install
```

Run focused helpers:

```bash
pnpm run validate:source-install
pnpm run validate:docker
pnpm run validate:homebrew
pnpm run verify:package-bin
```

## Coverage

`pnpm run validate:install` covers:

- npm package tarball verification through `pnpm run verify:package-bin`
- temp-prefix global install from the packed tarball
- source installer help and managed-source install with temp `HOME`
- manual source setup help and manual-source setup in a temp clone
- Homebrew and package-manager update routing tests
- managed-source update simulation in a temp local clone
- managed-source `--check` and `--dry-run`
- managed-source default backup behavior
- managed-source `--no-backup`
- managed-source dirty worktree refusal
- Homebrew handoff formula syntax check
- Docker image build/run when Docker is available

Uninstall support and uninstall validation are deferred to PR-I10A. Do not treat this matrix as final release-complete until uninstall behavior is implemented and validated.

## Docker Behavior

Docker validation is skipped by default when Docker is unavailable:

```text
SKIP: docker unavailable. Set ESTACODA_REQUIRE_DOCKER=1 to make this a failure.
```

Set `ESTACODA_REQUIRE_DOCKER=1` in CI jobs where Docker is expected.

## Homebrew Behavior

Homebrew validation is skipped by default when `brew` is unavailable, but the draft formula is still syntax-checked with Ruby when Ruby is available:

```text
SKIP: Homebrew is unavailable; validating draft formula Ruby syntax only.
```

Set `ESTACODA_REQUIRE_HOMEBREW=1` in CI jobs where Homebrew is expected.

## Safety

The validation scripts use temporary homes, prefixes, install directories, and clones. They must not write to the real `~/.estacoda` or require provider credentials.

The managed-source simulation uses a local Git remote and does not use GitHub network access. The `.install-method.json` stamp is ignored by git so managed-source checkouts do not appear dirty solely because they are stamped.

Failures should be interpreted as release-surface regressions unless the output says a dependency was intentionally skipped. For optional Docker/Homebrew checks, enable the corresponding `ESTACODA_REQUIRE_*` flag in environments where the dependency is guaranteed to exist.
