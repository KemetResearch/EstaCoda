# Homebrew Release Handoff

This is the repo-side handoff for the v0.1.0 Homebrew launch path. The real formula lives outside this repository.

## Target

- Tap repo: `KemetResearch/homebrew-tap`
- Formula path: `Formula/estacoda.rb`
- Install: `brew install kemetresearch/tap/estacoda`
- Upgrade: `brew upgrade kemetresearch/tap/estacoda`
- Uninstall: `brew uninstall estacoda`

## Source Strategy

Use the GitHub source tarball as the primary formula source:

```ruby
url "https://github.com/KemetResearch/EstaCoda/archive/refs/tags/vX.Y.Z.tar.gz"
```

Do not use the npm-pack tarball as the primary Homebrew source for v0.1.0. The npm package does not vendor prebuilt `better-sqlite3` binaries for macOS/Linux. Homebrew should build `better-sqlite3` and any other native dependencies on the target machine against the local Node/Homebrew environment.

## Build Behavior

The formula should build from source using Node, Corepack, and pnpm:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm prune --prod
```

The installed payload should include the built `dist/`, production `node_modules`, `package.json`, bundled `skills/`, `assets/`, `workers/`, `acp_registry/`, and required notices/licenses. The formula should expose `estacoda` through a wrapper that executes:

```bash
node "$LIBEXEC/dist/index.js" "$@"
```

## Checksum Strategy

After the release tag exists, compute the SHA-256 for the GitHub source tarball:

```bash
curl -L -o estacoda-vX.Y.Z.tar.gz \
  https://github.com/KemetResearch/EstaCoda/archive/refs/tags/vX.Y.Z.tar.gz
shasum -a 256 estacoda-vX.Y.Z.tar.gz
```

The formula `sha256` must match that source tarball.

## Version Bump Process

1. Final release PR in this repo bumps `package.json` to `X.Y.Z`.
2. Maintainer tags `vX.Y.Z` in `KemetResearch/EstaCoda`.
3. The tag creates the GitHub source tarball.
4. Update `Formula/estacoda.rb` in `KemetResearch/homebrew-tap` with the tag URL and SHA-256.
5. Validate formula install, upgrade, uninstall, and test behavior.
6. Merge the tap PR only after validation passes.

## External Tap Requirements

The external tap formula should:

- depend on Homebrew `node`
- set an isolated build cache/home where needed
- enable Corepack/pnpm for the build
- run `pnpm install --frozen-lockfile`
- run `pnpm run build`
- prune to production dependencies before installation
- install only runtime-needed files
- create a `bin/estacoda` wrapper
- include a test block for `--version` and `--help`

Corepack risk: `corepack enable` should be tested inside the Homebrew sandbox with the selected Node formula. If Corepack cannot prepare pnpm reliably in that environment, prefer an explicit Homebrew-compatible pnpm setup in the external tap over falling back to npm artifacts.

## Validation Commands

Run these in or against the external tap:

```bash
brew install --build-from-source kemetresearch/tap/estacoda
estacoda --version
estacoda --help
brew test kemetresearch/tap/estacoda
brew upgrade kemetresearch/tap/estacoda
brew uninstall estacoda
```

Before release completion, also verify EstaCoda update routing from a Homebrew-style install still points users to:

```bash
brew upgrade kemetresearch/tap/estacoda
```

## Notes

The draft formula in `docs/operations/homebrew/Formula/estacoda.rb.example` is non-authoritative. Copy or adapt it into `KemetResearch/homebrew-tap`; do not treat this repository as the tap. Do not copy it without filling the release version, URL, SHA-256, and validating the formula inside the external tap.
