#!/usr/bin/env bash
# Builds a self-contained Carrier Twin deploy folder. Never touches your working tree or any existing folder
# except OUT (default ~/twin-build-out). Needs node 22 and `npm ci` already run in Collect-RX-main.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
OUT="${1:-$HOME/twin-build-out}"
mkdir -p "$OUT"
cd "$ROOT"
npx tsx "$HERE/gen.ts" "$OUT/scenarios.json"
npx esbuild "$HERE/server.ts" --bundle --platform=node --target=node22 --format=esm --outfile="$OUT/server.mjs" \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" --log-level=warning
cp "$HERE/Dockerfile" "$HERE/fly.toml" "$HERE/rotate-sink-secret.sh" "$OUT/"
echo "Built in $OUT:"; ls -la "$OUT"
