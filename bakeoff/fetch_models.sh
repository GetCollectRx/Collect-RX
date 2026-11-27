#!/usr/bin/env bash
# Fetch the Silero VAD ONNX model (MIT licence) from the silero-vad pip wheel into models/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
pip download silero-vad --no-deps -q -d "$tmp"
unzip -q -o "$tmp"/silero_vad*.whl -d "$tmp/w"
mkdir -p "$here/models"
cp "$tmp/w/silero_vad/data/silero_vad.onnx" "$here/models/"
# Whisper small.en (int8) via sherpa-onnx release assets on GitHub. About 640 MB download, 200 MB kept.
wdir="$here/models/whisper-small.en"
if [ ! -f "$wdir/small.en-encoder.int8.onnx" ]; then
  curl -sL -o "$tmp/whisper.tar.bz2" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.en.tar.bz2
  tar xjf "$tmp/whisper.tar.bz2" -C "$tmp" sherpa-onnx-whisper-small.en/small.en-encoder.int8.onnx sherpa-onnx-whisper-small.en/small.en-decoder.int8.onnx sherpa-onnx-whisper-small.en/small.en-tokens.txt
  mkdir -p "$wdir"; mv "$tmp"/sherpa-onnx-whisper-small.en/* "$wdir/"
fi
echo "model in $here/models/silero_vad.onnx"
