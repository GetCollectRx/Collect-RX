#!/usr/bin/env bash
# Fetch the Silero VAD ONNX model (MIT licence) from the silero-vad pip wheel into models/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
pip download silero-vad --no-deps -q -d "$tmp"
unzip -q -o "$tmp"/silero_vad*.whl -d "$tmp/w"
mkdir -p "$here/models"
cp "$tmp/w/silero_vad/data/silero_vad.onnx" "$here/models/"
echo "model in $here/models/silero_vad.onnx"
