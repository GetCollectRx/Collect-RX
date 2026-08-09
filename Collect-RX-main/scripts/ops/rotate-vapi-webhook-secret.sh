#!/usr/bin/env bash
# Rotates VAPI_WEBHOOK_SECRET on Fly and prints the manual Vapi-dashboard follow-up. Usage: ./rotate-vapi-webhook-secret.sh
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

if [[ -z "$APP_NAME" ]]; then
  echo "Could not parse app name from $FLY_TOML" >&2
  exit 1
fi

NEW_SECRET="$(openssl rand -hex 32)"

echo "Setting VAPI_WEBHOOK_SECRET on Fly app '${APP_NAME}'..."
fly secrets set "VAPI_WEBHOOK_SECRET=${NEW_SECRET}" -a "$APP_NAME"

cat <<EOF

Fly secret set for app '${APP_NAME}'.

New value (shown once here, never written to a file or log):

  ${NEW_SECRET}

Remaining manual step — cannot be scripted without Vapi API credentials:
  1. Log into the Vapi dashboard: https://dashboard.vapi.ai
  2. Find the webhook / custom-credential configuration used for this
     app's POST /api/webhooks/vapi endpoint (server URL secret).
  3. Paste the exact value above as the new secret there.
  4. Send a test webhook, or place a test call, and confirm the app logs
     a 200 with no signature-verification errors.

This script only sets the Fly-side secret. Rotation is NOT complete until
step 3 above is done by hand in the Vapi dashboard.
EOF
