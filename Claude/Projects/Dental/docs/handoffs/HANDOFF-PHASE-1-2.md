# CollectRx Desktop — Phase 1-2 Handoff

## What's Built

Complete Electron desktop shell with React/Vite/Tailwind frontend for CollectRx dental insurance AR automation platform. 28 source files, ~5,300 lines.

### Electron Core
- `src/electron/main.js` — App lifecycle, BrowserWindow, system tray, 15+ IPC handlers, window state persistence, auto-start
- `src/electron/preload.js` — Secure contextBridge with all IPC methods (PHI never touches renderer)
- `electron-builder.json` — Windows NSIS installer config, auto-update, code signing placeholders

### React UI (Clean Medical SaaS Design)
- **Dashboard** — 4 KPI cards, AR aging bar chart, call queue status, resolution trend area chart, carrier donut chart, active claims table, escalations panel
- **Analytics** — Resolution trends, carrier performance, call outcome distribution
- **Balances** — Aging breakdown by carrier, trend charts, filterable table
- **Patient AR** — Patient balances table with search, reminder actions
- **Estimate** — Pre-treatment estimate form (Phase 3 scope, UI ready)
- **Outbox** — Communication history table (Phase 2+ scope, UI ready)
- **Admin** — Practice settings, queue config, sync controls, danger zone
- **Carrier Priority Panel** — Drag-and-drop reorder with @dnd-kit, confidence bars, enable/disable toggles
- **Navigation** — Collapsible sidebar with lucide-react icons

### Design System
- Primary: Emerald Green (#10B981)
- Light backgrounds, subtle borders, Stripe-like metric cards
- Inter font, thin scrollbars, smooth transitions
- Standard Tailwind v4 utility classes throughout

### Backend Integration
- `src/backend/routes/priority.js` — POST/GET carrier priority (PostgreSQL, auth middleware)
- `src/backend/routes/index.js` — Route index with health check

### Services
- `syncManager.js` — Abeldent sync lifecycle (periodic, retry, IPC status broadcasts)
- `windowsService.js` — node-windows service install/uninstall/status
- `autoUpdater.js` — electron-updater with progress tracking

### Data Layer
- `useApi.js` hook maps endpoint keys → preload methods with polling + mock fallback
- Rich mock data for all endpoints (realistic Canadian dental claims)
- `formatters.js` — Currency (CAD), dates, aging buckets, status colors

## Setup

```bash
# Clone into your repo
cd Collect-RX-main
cp -r collectrx-desktop/* .

# Install dependencies
npm install

# Development
npm run dev
# Opens Vite on :5173 then launches Electron

# Production build
npm run build:win
# Outputs to dist/ — Windows .exe installer
```

## Environment Variables

```
COLLECTRX_API_URL=https://collectrx-api.railway.app
```

## File Tree

```
collectrx-desktop/
├── electron-builder.json
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── electron/
│   │   ├── main.js
│   │   ├── preload.js
│   │   └── services/
│   │       ├── autoUpdater.js
│   │       ├── syncManager.js
│   │       └── windowsService.js
│   ├── backend/
│   │   └── routes/
│   │       ├── index.js
│   │       └── priority.js
│   └── renderer/
│       ├── main.jsx
│       ├── App.jsx
│       ├── styles/globals.css
│       ├── hooks/useApi.js
│       ├── utils/formatters.js
│       └── components/
│           ├── navigation/Navigation.jsx
│           ├── carrier-priority/CarrierPriorityPanel.jsx
│           ├── shared/
│           │   ├── MetricCard.jsx
│           │   ├── StatusBadge.jsx
│           │   └── DataTable.jsx
│           └── tabs/
│               ├── DashboardTab.jsx
│               ├── AnalyticsTab.jsx
│               ├── BalancesTab.jsx
│               ├── PatientARTab.jsx
│               ├── EstimateTab.jsx
│               ├── OutboxTab.jsx
│               └── AdminTab.jsx
└── assets/icons/
```

## Integration Checklist (Pre-Pilot)

- [ ] Set COLLECTRX_API_URL to Railway production URL
- [ ] Add app icon to `assets/icons/` (icon.ico for Windows, icon.png for tray)
- [ ] Run `discover-schema.js` on Dr. Hasan's machine
- [ ] Rotate credentials (Vapi API key, Railway PostgreSQL, webhook secret)
- [ ] Test IPC → backend API flow for each endpoint
- [ ] Test carrier priority drag-reorder → POST /api/queue/priority
- [ ] Test Windows Service install/uninstall for sync service
- [ ] Test auto-updater with a staged release
- [ ] Code sign the .exe (get a certificate, update electron-builder.json)
- [ ] Test single-instance lock
- [ ] Verify system tray icon and menu work on Windows 10/11

## What's Next (Phase 3+)

- Eligibility agent logic (Estimate tab — complex insurance rules, CDT codes)
- Patient payment collection via Stripe Connect (Patient AR tab actions)
- Full outbox/communication pipeline (Outbox tab)
- Real-time sync status via WebSocket (replace polling)
- Dark mode toggle (CSS variables are ready)
