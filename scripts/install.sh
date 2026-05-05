#!/usr/bin/env bash
set -euo pipefail

ESTACODA_HOME="${ESTACODA_HOME:-$HOME/.estacoda}"
ESTACODA_BIN="$ESTACODA_HOME/bin"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

# Normalize architecture names
if [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
elif [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
fi

PLATFORM="${OS}-${ARCH}"

echo "EstaCoda installer"
echo "Platform: $PLATFORM"

# Check for Bun
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required but not found."
  echo "Install Bun: https://bun.sh/docs/installation"
  exit 1
fi

BUN_VERSION="$(bun --version 2>/dev/null || echo "0.0.0")"
echo "Bun: $BUN_VERSION"

mkdir -p "$ESTACODA_BIN"

# Try to determine release artifact URL
# v0.1.0 dev fallback: no prebuilt binaries yet
RELEASE_BASE="https://github.com/kemetresearch/estacoda/releases/latest"
ARTIFACT_URL=""

# Probe for a published artifact (this will 404 until v0.1.0 is tagged)
if command -v curl >/dev/null 2>&1; then
  ARTIFACT_URL="${RELEASE_BASE}/download/estacoda-${PLATFORM}"
  if ! curl -fsSL -I "$ARTIFACT_URL" >/dev/null 2>&1; then
    ARTIFACT_URL=""
  fi
fi

if [ -n "$ARTIFACT_URL" ]; then
  echo "Downloading release artifact..."
  curl -fsSL "$ARTIFACT_URL" -o "$ESTACODA_BIN/estacoda"
  chmod +x "$ESTACODA_BIN/estacoda"
else
  echo "No prebuilt binary found for $PLATFORM."
  echo "Installing Bun-backed wrapper (dev fallback for v0.1.0)..."

  # Determine repo root relative to this script
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

  cat > "$ESTACODA_BIN/estacoda" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="REPO_ROOT_PLACEHOLDER"
exec bun run "$REPO_ROOT/src/index.ts" "$@"
WRAPPER

  sed -i.bak "s|REPO_ROOT_PLACEHOLDER|$REPO_ROOT|g" "$ESTACODA_BIN/estacoda"
  rm -f "$ESTACODA_BIN/estacoda.bak"
  chmod +x "$ESTACODA_BIN/estacoda"
fi

# Add to PATH if not already present
add_to_path() {
  local shell_rc=""
  case "${SHELL:-}" in
    */zsh) shell_rc="$HOME/.zshrc" ;;
    */bash) shell_rc="$HOME/.bashrc" ;;
    */fish) shell_rc="$HOME/.config/fish/config.fish" ;;
    *) shell_rc="$HOME/.profile" ;;
  esac

  if [ -n "$shell_rc" ] && [ -f "$shell_rc" ]; then
    if ! grep -q "ESTACODA_HOME" "$shell_rc" 2>/dev/null; then
      echo ""
      echo "# EstaCoda" >> "$shell_rc"
      echo 'export ESTACODA_HOME="$HOME/.estacoda"' >> "$shell_rc"
      echo 'export PATH="$ESTACODA_HOME/bin:$PATH"' >> "$shell_rc"
      echo "Added to $shell_rc"
    fi
  fi

  # Also try ~/.local/bin if it exists in PATH
  if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
    if [ ! -e "$HOME/.local/bin/estacoda" ]; then
      ln -sf "$ESTACODA_BIN/estacoda" "$HOME/.local/bin/estacoda" 2>/dev/null || true
    fi
  fi
}

add_to_path

echo ""
echo "EstaCoda installed to $ESTACODA_BIN/estacoda"
echo ""
echo "Next steps:"
echo "  1. Restart your shell or run: export PATH=\"$ESTACODA_HOME/bin:\$PATH\""
echo "  2. Run: estacoda init"
echo "  3. Run: estacoda verify"
echo "  4. Run: estacoda"
