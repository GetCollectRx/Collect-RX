#!/bin/bash
# Install native Swift CollectRx.app to Desktop (or path you pass).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dist-macos/CollectRx.app"
if [[ ! -d "$SRC" ]]; then
  echo "Missing $SRC — run: bash scripts/build-macos-swift.sh"
  exit 1
fi
DEST="${1:-$HOME/Desktop/CollectRx.app}"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true
echo "Installed: $DEST"
echo "Native Swift app — no Electron."
