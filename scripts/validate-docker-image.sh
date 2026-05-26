#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQUIRE_DOCKER="${ESTACODA_REQUIRE_DOCKER:-0}"

echo "==> Docker image validation"

if ! command -v docker >/dev/null 2>&1; then
  if [ "$REQUIRE_DOCKER" = "1" ]; then
    echo "Error: docker is unavailable and ESTACODA_REQUIRE_DOCKER=1 was set." >&2
    exit 1
  fi
  echo "SKIP: docker unavailable. Set ESTACODA_REQUIRE_DOCKER=1 to make this a failure."
  exit 0
fi

cd "$ROOT"

docker build -t estacoda:test .
docker run --rm estacoda:test --version
docker run --rm estacoda:test --help

echo "Docker image validation passed."
