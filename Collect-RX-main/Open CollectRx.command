#!/bin/bash
# Double-click to open CollectRx — native Swift app, or browser fallback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/dist-macos/CollectRx.app"
DESKTOP_APP="$HOME/Desktop/CollectRx.app"
if [[ -d "$DESKTOP_APP" ]]; then
  open -a "$DESKTOP_APP"
elif [[ -d "$APP" ]]; then
  open -a "$APP"
else
  open "https://collect-rx.fly.dev/login"
fi

