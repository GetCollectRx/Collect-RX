# PRD — Phase 4: Windows Installer & Schema Discovery

**Status:** ✅ Engineering complete — operator session pending  
**Owner:** Khalid  
**Dependencies:** Dr. Hasan availability for on-site session; Phase 1–2 complete  
**Target:** Before pilot go-live  

---

## Problem Statement

CollectRx cannot sync real claim data until the actual Abeldent database schema is confirmed on Dr. Hasan's machine. Abeldent Local Plus uses an on-premise SQL Server with a schema that may vary across installations. Additionally, there is no packaged `.exe` installer that Dr. Hasan can install — the product only exists as a development build. Both gaps must be closed before the pilot can start.

---

## Goals

- Run `discover-schema.cjs` (Collect-RX-main) against Dr. Hasan's Abeldent SQL Server to map actual table and column names
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
- Run `discover-schema.cjs` on Dr. Hasan's Windows machine against his Abeldent Local Plus SQL Server
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
- Column names cannot be assumed — `discover-schema.cjs` output is the source of truth

---

## Out of Scope

- macOS / Linux builds
- Multi-practice installer before pilot completion and Day-90 decision

---

## Acceptance Criteria

- [x] `discover-schema.cjs` script ships in repo (`npm run abeldent:discover`); run on Dr. Hasan's Windows PC against SQL Server
- [x] Schema JSON + `schema-map.json` workflow documented (`schema-map.example.json`, `sync-query-builder.cjs --validate`)
- [ ] Patient list from Abeldent visible in dashboard after sync *(requires live session + `ABELDENT_SCHEMA_MAP`)*
- [x] `.exe` installer builds in CI (`.github/workflows/collectrx-electron-installers.yml` job `windows-exe`; code signing optional until cert available)
- [ ] Dr. Hasan's machine runs CollectRx from installer without developer assistance *(pilot)*
- [ ] Windows Service starts on boot and first sync cycle completes *(pilot — see Electron main / installer docs)*

---

## V2 Execution Layer

### Validation Mode (Mandatory)

- This phase is executed in **single-practice pilot validation mode**.
- Installer packaging is limited to the pilot practice deployment path until Day-90.

### Scope Lock

**In scope**
- Schema discovery session and signed output artifact
- Sync query alignment and validation on pilot machine
- Production-grade Windows installer packaging and first-run validation

**Out of scope**
- Multi-practice deployment automation
- Cross-OS packaging

### Task Breakdown

| ID | Task | Owner | Estimate | Dependency |
|----|------|-------|----------|------------|
| P4-1 | Prepare discovery checklist and remote session protocol | Khalid | 0.5 day | none |
| P4-2 | Execute `discover-schema.cjs` and collect schema JSON artifact | Khalid | 0.5 day | P4-1 |
| P4-3 | Update query mapper using discovered schema fields | Eng | 1 day | P4-2 |
| P4-4 | Run sync dry-run and compare row counts vs source | Eng | 0.5 day | P4-3 |
| P4-5 | Finalize installer signing pipeline in GitHub Actions | Eng | 1 day | none |
| P4-6 | Pilot machine install test + reboot service verification | Khalid | 0.5 day | P4-5 |
| P4-7 | Document installation SOP and rollback procedure | Khalid | 0.5 day | P4-6 |

### Test Plan

- **Schema validation**
  - Confirm required entities (patients, claims, dates, carrier codes) exist.
  - Verify data type compatibility with sync parser.
- **Integration tests**
  - Sync completes and inserts expected record counts.
  - Aging buckets computed correctly from real adjudication dates.
- **Installer tests**
  - Install/uninstall smoke on clean VM.
  - Service start on boot and first heartbeat within SLA.

### Risks & Mitigations

| Risk | Trigger | Mitigation | Fallback |
|------|---------|------------|----------|
| Schema mismatch discovered late | Sync fields null or parser failures | Require signed schema artifact before query merge | Manual mapping patch with hotfix release |
| Signing cert or pipeline breakage | CI installer stage fails | Add cert expiry monitor and staged signing test | Manual signed build on trusted workstation |
| Pilot machine policy blocks service install | Service registration fails | Pre-check local admin rights and AV exclusions | Run sync as scheduled task temporarily |

### Operational Runbook

- Keep schema snapshot versioned and tied to installer version.
- On sync failure, run diagnosis script and collect structured logs before retry.
- Maintain rollback installer from last known-good version.

### Exit Criteria (Go/No-Go)

- [ ] Schema artifact approved and committed
- [ ] Sync query validated against live Abeldent data
- [ ] Signed installer published from CI
- [ ] Pilot machine install + reboot + sync heartbeat successful
- [ ] Installation and rollback SOP shared with pilot practice
