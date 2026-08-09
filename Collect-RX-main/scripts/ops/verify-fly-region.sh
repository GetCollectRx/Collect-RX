#!/usr/bin/env bash
# Compares each live Fly machine's region against fly.toml's primary_region. Usage: ./verify-fly-region.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLY_TOML="$SCRIPT_DIR/../../fly.toml"

if ! command -v fly >/dev/null 2>&1; then
  echo "flyctl not found — install it first: https://fly.io/docs/flyctl/install/" >&2
  exit 1
fi

if [[ ! -f "$FLY_TOML" ]]; then
  echo "fly.toml not found at $FLY_TOML" >&2
  exit 1
fi

# Read the top-level `app = '...'` key only — stop at the first [section] header
# so we don't match `[processes] app = 'npm run start'` further down the file.
APP_LINE=$(awk '/^\[/{exit} /^app[[:space:]]*=/{print; exit}' "$FLY_TOML")
APP_NAME=$(printf '%s' "$APP_LINE" | sed -E "s/^app[[:space:]]*=[[:space:]]*['\"]([^'\"]+)['\"].*/\1/")

PRIMARY_REGION_LINE=$(grep -m1 -E "^primary_region[[:space:]]*=" "$FLY_TOML" || true)
PRIMARY_REGION=$(printf '%s' "$PRIMARY_REGION_LINE" | sed -E "s/^primary_region[[:space:]]*=[[:space:]]*['\"]([^'\"]+)['\"].*/\1/")

if [[ -z "$APP_NAME" || -z "$PRIMARY_REGION" ]]; then
  echo "Could not parse app / primary_region from $FLY_TOML" >&2
  exit 1
fi

echo "App: ${APP_NAME}   Expected primary_region (fly.toml): ${PRIMARY_REGION}"

if ! MACHINES_JSON=$(fly machine list -a "$APP_NAME" --json 2>&1); then
  echo "'fly machine list -a ${APP_NAME} --json' failed:" >&2
  echo "$MACHINES_JSON" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found — install it to parse machine JSON: https://jqlang.org/download/" >&2
  exit 1
fi

MISMATCHES="$(printf '%s' "$MACHINES_JSON" | jq -r --arg region "$PRIMARY_REGION" \
  '.[] | select(.region != $region) | "\(.id)  region=\(.region)"')"

if [[ -z "$MISMATCHES" ]]; then
  echo "PASS: all machines are running in primary_region '${PRIMARY_REGION}'."
  exit 0
else
  echo "FAIL: machine(s) not in primary_region '${PRIMARY_REGION}':"
  echo "$MISMATCHES"
  exit 1
fi
