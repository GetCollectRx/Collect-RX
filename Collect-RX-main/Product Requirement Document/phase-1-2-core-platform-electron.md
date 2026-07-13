# PRD — Phase 1–2: Core Platform & Electron Shell

**Status:** ✅ Complete  
**Owner:** Khalid  
**Target:** Pilot-ready desktop application  

---

## Problem Statement

Dental practice staff need to run CollectRx on a Windows desktop alongside Abeldent, their existing practice management software. A pure web app cannot access the local SQL Server database or run as a background Windows service. The platform needed a desktop shell that bundles the Abeldent sync service while keeping the backend on Railway for Vapi webhook compatibility.

---

## Goals

- Deliver a native Windows `.exe` installer that practices can install and run without IT support
- Sync claim data from Abeldent's local SQL Server into CollectRx's cloud backend
- Surface a web-based dashboard inside the Electron shell for claim queue management
- Enable carrier priority reordering without code changes

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Install time on fresh Windows machine | < 5 minutes |
| Abeldent sync latency | < 60 seconds per cycle |
| Dashboard load time | < 2 seconds |
| Electron shell crashes in testing | 0 |

---

## Functional Requirements

### Electron Shell
- `main.js` / `preload.js` with IPC bridge for frontend ↔ backend communication
- System tray icon with single-instance lock
- Auto-update via `electron-updater`
- Shell renders React dashboard in a webview (backend stays on Railway)
- App menu with standard OS-level actions

### Abeldent Connector
- Node.js service using `mssql` package with Windows Integrated Authentication
- `discover-schema.cjs` to map actual Abeldent table and column names (must run on the practice's machine before sync goes live)
- Aging bucket logic: 30, 45, 60, 90-day claim cohorts
- Carrier filtering: Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS AdjudiCare
- Windows Service installation via `node-windows`

### Backend (Node.js / Railway)
- Queue engine: claim prioritization and call scheduling
- Outcome processor: structured result storage from Vapi webhooks
- Escalation system: routes unresolved claims to human review queue
- `POST /api/queue/priority` endpoint for carrier reorder

### Carrier Priority Panel
- Drag-to-reorder carrier call order in the dashboard
- Persists to backend — no code change required to reprioritize

### Vapi Squad Architecture (4 agents)
- `IVR_Navigator`: navigates carrier phone trees
- `Claims_Agent`: authenticates and queries claim status
- `Escalation_Closer`: handles complex denials, escalates to supervisor
- `Resolution_Closer`: confirms payment details and records ETA
- Per-carrier JSON knowledge bases encoding IVR trees, auth fields, denial codes

---

## Technical Constraints

- Electron is a thin wrapper only — all business logic lives in Node.js backend
- Backend must remain on Railway (Vapi webhook requires public URL)
- PHI never crosses to Vapi — UUID tokens only
- `discover-schema.cjs` must be run on the practice's Abeldent instance before production sync
- Stripe Connect (not standard Stripe) for patient payment collection

---

## Out of Scope

- macOS / Linux packaging
- Multi-practice support (Phase 6+)
- Full UI redesign (Phase 5)

---

## Acceptance Criteria

- [x] `.exe` installer builds cleanly via GitHub Actions
- [x] Windows Service starts on boot and syncs Abeldent on schedule
- [x] Dashboard loads inside Electron webview
- [x] Carrier priority drag-and-drop persists across restarts
- [x] Vapi squad places a test call successfully
- [x] Carrier block event (`CARRIER_BLOCK`) logged and practice-wide calls suspended
