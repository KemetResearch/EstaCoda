#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORMULA_EXAMPLE="$ROOT/docs/operations/homebrew/Formula/estacoda.rb.example"
REQUIRE_HOMEBREW="${ESTACODA_REQUIRE_HOMEBREW:-0}"

echo "==> Homebrew handoff validation"

if command -v brew >/dev/null 2>&1; then
  brew --version | head -n 1
else
  if [ "$REQUIRE_HOMEBREW" = "1" ]; then
    echo "Error: Homebrew is unavailable and ESTACODA_REQUIRE_HOMEBREW=1 was set." >&2
    exit 1
  fi
  echo "SKIP: Homebrew is unavailable; validating draft formula Ruby syntax only."
fi

if ! command -v ruby >/dev/null 2>&1; then
  echo "Error: ruby is required to syntax-check $FORMULA_EXAMPLE" >&2
  exit 1
fi

ruby -c "$FORMULA_EXAMPLE"

echo "Homebrew handoff validation passed."
