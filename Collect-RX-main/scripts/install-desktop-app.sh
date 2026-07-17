#!/bin/bash
# Deprecated: CollectRx is not an Electron app. Use the browser launcher instead.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/install-macos-launcher.sh" "$@"
