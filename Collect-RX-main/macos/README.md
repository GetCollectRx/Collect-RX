# CollectRx — native macOS app (Swift)

Native macOS command center. **No Electron.**

## What it is

- **SwiftUI + WebKit** (system browser engine, not Chromium)
- Loads the hosted command center at `https://collect-rx.fly.dev`
- Same login, dashboard, queue, live console, and claims as the web app
- External links open in Safari/Chrome; CollectRx stays in-app

The React UI remains on Fly. This is a native Mac shell — the same pattern as many production Mac apps, without bundling Electron.

## Build

```bash
bash scripts/build-macos-swift.sh
```

Output: `dist-macos/CollectRx.app`

## Install to Desktop

```bash
bash scripts/install-macos-swift.sh
```

## Open in Xcode

```bash
open macos/CollectRx/CollectRx.xcodeproj
```

## Override server URL

- Environment: `COLLECTRX_APP_ORIGIN=https://collect-rx.fly.dev`
- File: `~/Library/Application Support/CollectRx/app-origin.txt` (one line, no trailing slash)

## Requirements

- macOS 13+
- Xcode 15+ (`xcodebuild` on PATH)

## Electron

Electron is **not** used for the Mac product. The `electron-shell/` tree is legacy (optional Windows AbelDent connector only).
