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
- `discover-schema.cjs` to map actual Abeldent table and column names (must run on Dr. Hasan's machine before sync goes live)
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
- `discover-schema.cjs` must be run on Dr. Hasan's Abeldent instance before production sync
- Stripe Connect (not standard Stripe) for patient payment collection

---

## Out of Scope

- macOS / Linux packaging
- Multi-practice support before pilot completion and Day-90 decision
- Full UI redesign (Phase 5)

---

## Acceptance Criteria

- [ ] `.exe` installer builds cleanly via GitHub Actions
- [ ] Windows Service starts on boot and syncs Abeldent on schedule
- [ ] Dashboard loads inside Electron webview
- [ ] Carrier priority drag-and-drop persists across restarts
- [ ] Vapi squad places a test call successfully
- [ ] Carrier block event (`CARRIER_BLOCK`) logged and practice-wide calls suspended

---

## V2 Execution Layer

### Validation Mode (Mandatory)

- This phase is executed in **single-practice pilot validation mode**.
- No multi-practice tenancy, onboarding, or admin features are allowed before the Phase 6 Day-90 decision.

### Scope Lock

**In scope**
- Electron shell stability, installer packaging, service lifecycle, and sync plumbing
- Railway-backed dashboard rendering in desktop shell
- Carrier priority persistence and retrieval

**Out of scope**
- Cross-platform desktop builds
- Multi-practice tenancy and role management

### Task Breakdown

| ID | Task | Owner | Estimate | Dependency |
|----|------|-------|----------|------------|
| P12-1 | Harden Electron main/preload IPC contracts and permission boundaries | Eng | 1 day | none |
| P12-2 | Implement single-instance + tray recovery + crash telemetry | Eng | 0.5 day | P12-1 |
| P12-3 | Finalize Windows Service install/start/stop/restart behavior | Eng | 1 day | none |
| P12-4 | Add service recovery policy (restart on failure, max retries) | Eng | 0.5 day | P12-3 |
| P12-5 | Add CI release pipeline for installer build/sign/artifact | Eng | 1 day | none |
| P12-6 | Validate dashboard webview routing and offline/error states | Eng | 0.5 day | P12-1 |
| P12-7 | End-to-end sync validation with sample Abeldent payloads | Eng | 1 day | P12-3 |

### Test Plan

- **Unit tests**
  - IPC channel contract tests for allowed message patterns.
  - Queue priority API serialization/deserialization tests.
- **Integration tests**
  - Service boot test: machine restart -> service auto-start -> sync event emitted.
  - Installer smoke test on clean Windows VM.
- **Manual QA**
  - Tray lifecycle (open/hide/quit) behavior.
  - Dashboard load under slow network and backend downtime.

### Risks & Mitigations

| Risk | Trigger | Mitigation | Fallback |
|------|---------|------------|----------|
| Installer signing failure | CI fails at signing stage | Pre-flight cert expiration check in CI | Distribute unsigned internal build for blocked pilot prep only |
| Service fails after reboot | No sync heartbeat in 5 min post boot | Add startup delay + dependency checks | Manual service recovery script |
| Webview fails to load Railway app | Repeated `did-fail-load` events | Retry/backoff and visible offline page | Launch browser fallback link for staff |

### Operational Runbook

- Validate sync heartbeat every 5 minutes; alert if missing for 15 minutes.
- Keep signed installer artifact and checksum per release.
- Provide uninstall + reinstall standard operating procedure.

### Exit Criteria (Go/No-Go)

- [ ] Installer builds and signs in CI with reproducible artifact
- [ ] Service survives reboot and auto-recovers from crash
- [ ] Dashboard fully usable inside Electron
- [ ] Sync heartbeat observed continuously for 24 hours in test env
- [ ] Pilot machine installation completed without developer intervention
