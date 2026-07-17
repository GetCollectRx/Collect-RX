# Legacy desktop entry (deprecated)

**Do not use this folder as the Electron main process.**

The active desktop app lives under `electron-shell/`:

| Active | Legacy (this folder) |
|--------|----------------------|
| `electron-shell/main.js` | `desktop/main.js` |
| `electron-shell/preload.js` | `desktop/preload.js` |
| `child_process.spawn` for sync | `utilityProcess.fork` |

`desktop/services/abeldent-sync.js` and `desktop/config/` are still used by the packaged app.

Run the desktop app: `npm run dev:electron` from `Collect-RX-main/`.
