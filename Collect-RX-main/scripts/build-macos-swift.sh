#!/bin/bash
# Build native CollectRx macOS app (Swift + WebKit). No Electron.
set -euo pipefail
export COPYFILE_DISABLE=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/macos/CollectRx/CollectRx.xcodeproj"
SCHEME="CollectRx"
OUT="$ROOT/dist-macos"
DERIVED="$OUT/DerivedData"

xattr -cr "$ROOT/macos" 2>/dev/null || true
rm -rf "$OUT/Build/Products"
mkdir -p "$DERIVED"

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_ALLOWED=NO \
  build

APP_SRC="$DERIVED/Build/Products/Release/CollectRx.app"
xattr -cr "$APP_SRC" 2>/dev/null || true
/usr/bin/codesign --force --sign - --deep "$APP_SRC"

APP_DST="$OUT/CollectRx.app"
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"
xattr -cr "$APP_DST" 2>/dev/null || true

echo "Built: $APP_DST"
