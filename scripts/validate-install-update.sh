#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT=""
HOST_HOME="${HOME:-}"

cleanup() {
  if [ -n "$TMP_ROOT" ] && [ -d "$TMP_ROOT" ]; then
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup EXIT

die() {
  echo "Error: $*" >&2
  exit 1
}

run_allow_exit() {
  local expected_codes="$1"
  shift
  set +e
  "$@"
  local code=$?
  set -e
  case " $expected_codes " in
    *" $code "*) return 0 ;;
    *)
      echo "Error: command exited with $code, expected one of: $expected_codes" >&2
      echo "Command: $*" >&2
      exit 1
      ;;
  esac
}

CAPTURED_OUTPUT=""
capture_allow_exit() {
  local expected_codes="$1"
  shift
  set +e
  CAPTURED_OUTPUT="$("$@")"
  local code=$?
  set -e
  printf '%s\n' "$CAPTURED_OUTPUT"
  case " $expected_codes " in
    *" $code "*) return 0 ;;
    *)
      echo "Error: command exited with $code, expected one of: $expected_codes" >&2
      echo "Command: $*" >&2
      exit 1
      ;;
  esac
}

write_managed_stamp() {
  local stamp_path="$1"
  local source_url="$2"
  local branch="$3"
  local install_dir="$4"
  node --input-type=module - "$stamp_path" "$source_url" "$branch" "$install_dir" <<'NODE'
import { writeFileSync } from "node:fs";

const [stampPath, sourceUrl, branch, installDir] = process.argv.slice(2);
writeFileSync(stampPath, `${JSON.stringify({
  method: "managed-source",
  sourceUrl,
  branch,
  installDir,
  installedAt: new Date().toISOString(),
  installerVersion: "v0.1.0-validation"
}, null, 2)}\n`);
NODE
}

prepare_state_home() {
  local home_dir="$1"
  mkdir -p "$home_dir/.estacoda/profiles/default" "$home_dir/.estacoda/memory"
  printf '{"profileId":"default"}\n' > "$home_dir/.estacoda/active-profile.json"
  printf '{"trusted":[]}\n' > "$home_dir/.estacoda/trust.json"
}

create_pnpm_shim() {
  local shim_dir="$1"
  local pnpm_version cached_pnpm pnpm_command
  pnpm_version="$(node -e 'const { readFileSync } = require("node:fs"); const pkg = JSON.parse(readFileSync(process.argv[1], "utf8")); console.log(String(pkg.packageManager).replace(/^pnpm@/, ""));' "$ROOT/package.json")"
  cached_pnpm="$HOST_HOME/.cache/node/corepack/v1/pnpm/$pnpm_version/bin/pnpm.cjs"
  pnpm_command="$(command -v pnpm || true)"

  mkdir -p "$shim_dir"
  if [ -f "$cached_pnpm" ]; then
    cat > "$shim_dir/pnpm" <<SHIM
#!/usr/bin/env bash
exec node "$(printf '%s' "$cached_pnpm")" "\$@"
SHIM
    chmod +x "$shim_dir/pnpm"
    return 0
  fi

  if [ -n "$pnpm_command" ]; then
    cat > "$shim_dir/pnpm" <<SHIM
#!/usr/bin/env bash
exec "$(printf '%s' "$pnpm_command")" "\$@"
SHIM
    chmod +x "$shim_dir/pnpm"
    return 0
  fi

  die "cached pnpm $pnpm_version is required for managed-source update validation at $cached_pnpm"
}

validate_managed_source_update() {
  echo "==> Managed-source update validation"
  local branch remote managed writer home_dir pnpm_shim_dir source_url repo_root output
  branch="$(git -C "$ROOT" branch --show-current)"
  [ -n "$branch" ] || die "could not determine current branch"

  TMP_ROOT="$(mktemp -d)"
  remote="$TMP_ROOT/remote.git"
  managed="$TMP_ROOT/managed"
  writer="$TMP_ROOT/writer"
  home_dir="$TMP_ROOT/home"
  pnpm_shim_dir="$TMP_ROOT/pnpm-shim"
  create_pnpm_shim "$pnpm_shim_dir"

  git clone --bare "$ROOT" "$remote"
  git clone --branch "$branch" "$remote" "$managed"
  git clone --branch "$branch" "$remote" "$writer"

  git -C "$writer" config user.name "EstaCoda Validation"
  git -C "$writer" config user.email "validation@example.invalid"
  mkdir -p "$writer/docs/operations"
  printf 'managed-source validation update 1\n' > "$writer/docs/operations/managed-source-validation.txt"
  git -C "$writer" add docs/operations/managed-source-validation.txt
  git -C "$writer" commit -m "validation managed-source update 1"
  git -C "$writer" push origin "$branch"

  printf '\n.install-method.json\n' >> "$managed/.git/info/exclude"
  source_url="$(git -C "$managed" remote get-url origin)"

  (
    cd "$managed"
    export PATH="$pnpm_shim_dir:$PATH"
    pnpm install --frozen-lockfile
    pnpm run build
  )

  repo_root="$(git -C "$managed" rev-parse --show-toplevel)"
  write_managed_stamp "$managed/.install-method.json" "$source_url" "$branch" "$repo_root"
  prepare_state_home "$home_dir"

  run_allow_exit "0 2" env PATH="$pnpm_shim_dir:$PATH" HOME="$home_dir" CI=true node "$managed/dist/index.js" update --check
  run_allow_exit "0 2" env PATH="$pnpm_shim_dir:$PATH" HOME="$home_dir" CI=true node "$managed/dist/index.js" update --dry-run

  capture_allow_exit "0" env PATH="$pnpm_shim_dir:$PATH" HOME="$home_dir" CI=true node "$managed/dist/index.js" update
  output="$CAPTURED_OUTPUT"
  grep -q "Update applied:" <<< "$output"
  grep -q "Backup:" <<< "$output"

  printf 'managed-source validation update 2\n' > "$writer/docs/operations/managed-source-validation.txt"
  git -C "$writer" add docs/operations/managed-source-validation.txt
  git -C "$writer" commit -m "validation managed-source update 2"
  git -C "$writer" push origin "$branch"

  capture_allow_exit "0" env PATH="$pnpm_shim_dir:$PATH" HOME="$home_dir" CI=true node "$managed/dist/index.js" update --no-backup
  output="$CAPTURED_OUTPUT"
  grep -q "Update applied:" <<< "$output"
  grep -q "Backup: skipped (--no-backup)." <<< "$output"

  printf '\nvalidation dirty marker\n' >> "$managed/README.md"
  run_allow_exit "3" env PATH="$pnpm_shim_dir:$PATH" HOME="$home_dir" CI=true node "$managed/dist/index.js" update
}

cd "$ROOT"

echo "==> Package validation"
pnpm run verify:package-bin

"$ROOT/scripts/validate-source-install.sh"

echo "==> Update routing validation"
pnpm exec vitest run src/lifecycle/install-method.test.ts src/cli/update-command.test.ts

validate_managed_source_update

"$ROOT/scripts/validate-homebrew-handoff.sh"
"$ROOT/scripts/validate-docker-image.sh"

echo "Install/update validation matrix passed."
