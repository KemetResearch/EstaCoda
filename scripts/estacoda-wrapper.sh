#!/usr/bin/env bash
set -euo pipefail

# EstaCoda Bun-backed wrapper
# Used when no prebuilt binary is available for the current platform.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

exec bun run "$REPO_ROOT/src/index.ts" "$@"
