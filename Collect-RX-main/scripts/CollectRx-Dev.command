#!/bin/bash
# Double-click this file in Finder to start CollectRx (backend + Vite + Electron).
# Do NOT open Electron.app inside node_modules — that only shows the empty Electron screen.

set -e
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "Starting CollectRx from: $(pwd)"
echo "A Terminal window will stay open while the app runs. Quit Electron or press Ctrl+C to stop."
npm run dev:electron
