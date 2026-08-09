#!/usr/bin/env bash
# Sets a new TWILIO_AUTH_TOKEN on Fly (the value must come from the Twilio console — this script cannot generate it). Usage: ./rotate-twilio-auth-token.sh [new-token]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLY_TOML="$SCRIPT_DIR/../../fly.toml"

cat <<'EOF'
Twilio Auth Token rotation — manual step first (cannot be scripted):
  1. Log into the Twilio Console: https://console.twilio.com
  2. Go to Account -> API keys & tokens.
  3. Rotate / regenerate the primary Auth Token.
  4. Copy the new token value — you will need it below.

EOF

NEW_TOKEN="${1:-${TWILIO_AUTH_TOKEN:-}}"

if [[ -z "$NEW_TOKEN" ]]; then
  echo "No new token provided. Pass it as the first argument, or set TWILIO_AUTH_TOKEN:" >&2
  echo "  ./rotate-twilio-auth-token.sh '<new-token-from-twilio-console>'" >&2
  echo "  TWILIO_AUTH_TOKEN='<new-token-from-twilio-console>' ./rotate-twilio-auth-token.sh" >&2
  exit 1
fi

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

echo "Setting TWILIO_AUTH_TOKEN on Fly app '${APP_NAME}'..."
fly secrets set "TWILIO_AUTH_TOKEN=${NEW_TOKEN}" -a "$APP_NAME"

cat <<EOF

Fly secret set for app '${APP_NAME}'.

Remaining steps:
  - 'fly secrets set' triggers a rolling deploy automatically — confirm all
    machines come up healthy (fly status -a ${APP_NAME}).
  - Place a test outbound call or SMS against a known-safe number/staging
    line and confirm it succeeds.
  - Twilio only keeps one Auth Token active per rotation, so the old token
    was already invalidated the moment you rotated it in the console above
    — no separate revoke step needed unless you created a secondary
    credential instead of rotating the primary token.
EOF
