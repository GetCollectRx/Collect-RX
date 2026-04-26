# PRD — Phase 4: Windows Installer & Schema Discovery

**Status:** ⏳ Pending  
**Owner:** Khalid  
**Dependencies:** Dr. Hasan availability for on-site session; Phase 1–2 complete  
**Target:** Before pilot go-live  

---

## Problem Statement

CollectRx cannot sync real claim data until the actual Abeldent database schema is confirmed on Dr. Hasan's machine. Abeldent Local Plus uses an on-premise SQL Server with a schema that may vary across installations. Additionally, there is no packaged `.exe` installer that Dr. Hasan can install — the product only exists as a development build. Both gaps must be closed before the pilot can start.

---

## Goals

- Run `discover-schema.js` against Dr. Hasan's Abeldent SQL Server to map actual table and column names
- Package CollectRx as a signed Windows `.exe` installer via GitHub Actions
- Verify the Abeldent sync query works with the confirmed schema
- Deliver an installable product Dr. Hasan can run without developer involvement

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Schema discovery session completed | 1 on-site or remote session |
| Sync query accuracy with confirmed schema | 100% column name matches |
| `.exe` installer build time in CI | < 10 minutes |
| Install time on Dr. Hasan's machine | < 5 minutes |
| Sync runs without error post-install | ✅ first run |

---

## Functional Requirements

### Schema Discovery
- Run `discover-schema.js` on Dr. Hasan's Windows machine against his Abeldent Local Plus SQL Server
- Output: JSON map of actual table names, column names, and data types
- Update sync query to use confirmed column names — never hardcoded assumptions
- Validate patient list, outstanding claims, and aging data appear correctly in dashboard after sync

### Windows Installer Packaging
- `electron-builder` config targeting Windows `.exe` with code signing
- GitHub Actions CI pipeline: build → sign → artifact upload on each tagged release
- Auto-update channel configured so future releases push to installed instances
- Installer includes: Electron shell, Node.js runtime, Windows Service installer, startup registration

### Sync Validation
- After schema discovery: run sync against Dr. Hasan's Abeldent and confirm patient records appear in dashboard
- Verify aging bucket logic (30/45/60/90 day) against real claim dates
- Confirm carrier filtering returns correct subset of claims

### Credential Verification
- All credentials confirmed rotated (Vapi key, PostgreSQL password, webhook secret)
- No `.env` with real credentials committed to repo
- AWS Parameter Store serving credentials in production build

---

## Technical Constraints

- Must be run on or remotely connected to Dr. Hasan's Windows machine
- Windows Integrated Auth required for SQL Server connection (`mssql` package)
- `node-windows` used for Windows Service registration
- Column names cannot be assumed — `discover-schema.js` output is the source of truth

---

## Out of Scope

- macOS / Linux builds
- Multi-practice installer (single practice packaging only for pilot)

---

## Acceptance Criteria

- [ ] `discover-schema.js` completes without error on Dr. Hasan's machine
- [ ] Schema JSON output reviewed and sync query updated with confirmed names
- [ ] Patient list from Abeldent visible in dashboard after sync
- [ ] `.exe` installer builds and signs cleanly in GitHub Actions
- [ ] Dr. Hasan's machine runs CollectRx from installer without developer assistance
- [ ] Windows Service starts on boot and first sync cycle completes
