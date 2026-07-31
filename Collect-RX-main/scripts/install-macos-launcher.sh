#!/bin/bash
# Deprecated: use scripts/install-macos-swift.sh (native Swift app).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/install-macos-swift.sh" "$@"
