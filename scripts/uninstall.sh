#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if command -v estacoda >/dev/null 2>&1; then
  exec estacoda uninstall "$@"
fi

if [ -f "$REPO_ROOT/dist/index.js" ]; then
  exec node "$REPO_ROOT/dist/index.js" uninstall "$@"
fi

cat >&2 <<'EOF'
EstaCoda uninstall could not find an installed estacoda command or a built local dist/index.js.

If this was an npm install, run:
  npm uninstall -g estacoda

If this was a pnpm install, run:
  pnpm remove -g estacoda

If this was a Homebrew install, run:
  brew uninstall estacoda

For a source checkout, build first with:
  pnpm install --frozen-lockfile
  pnpm run build
  node dist/index.js uninstall
EOF
exit 1
