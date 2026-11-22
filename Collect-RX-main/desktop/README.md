# Desktop packaging resources

The desktop app lives in `electron-shell/`. This folder only holds
`config/agent-config.example.json`, which the installer copies to
`%ProgramData%\CollectRx\agent-config.json` on first install.

Run the desktop app: `npm run dev:electron` from `Collect-RX-main/`.
