# PRD — Phase 4: Windows Installer & Schema Discovery

**Status:** ✅ Engineering complete — operator session pending  
**Owner:** Khalid  
**Dependencies:** Pilot site availability for on-site/remote AbelDent session; Phase 1–2 complete  
**Target:** Before pilot go-live  

---

## Problem Statement

CollectRx cannot sync real claim data until the actual AbelDent database schema is confirmed on a **pilot site's Windows machine**. AbelDent Local Plus uses on-premise SQL Server with a schema that may vary across installations. Additionally, practices need a packaged `.exe` installer they can run without developer involvement. Both gaps must be closed before the pilot can start.

**Note:** CSV import is the primary onboarding path for new tenants; the AbelDent connector is optional and only required for PMS-connected practices.

---

## Goals

- Run `discover-schema.cjs` against the pilot site's AbelDent SQL Server to map actual table and column names
- Package CollectRx desktop connector as a signed Windows `.exe` installer via GitHub Actions
- Verify the AbelDent sync query works with the confirmed schema (`schema-map.json` per installation)
- Deliver an installable product the pilot site can run without developer involvement

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Schema discovery session completed | 1 on-site or remote session |
| Sync query accuracy with confirmed schema | 100% column name matches |
| `.exe` installer build time in CI | < 10 minutes |
| Install time on pilot Windows machine | < 5 minutes |
| Sync runs without error post-install | ✅ first run |

---

## Functional Requirements

### Schema Discovery
- Run `discover-schema.cjs` on the pilot Windows machine against AbelDent Local Plus SQL Server
- Output: JSON map of actual table names, column names, and data types
- Update sync query to use confirmed column names — never hardcoded assumptions
- Validate patient list, outstanding claims, and aging data appear correctly in dashboard after sync (scoped to that practice's `practiceId`)

### Windows Installer Packaging
- `electron-builder` config targeting Windows `.exe` with code signing
- GitHub Actions CI pipeline: build → sign → artifact upload on each tagged release
- Auto-update channel configured so future releases push to installed instances
- Installer includes: Electron shell, Node.js runtime, Windows Service installer, startup registration

### Sync Validation
- After schema discovery: run sync and confirm records appear in dashboard for the bound tenant only
- Verify aging bucket logic (30/45/60/90 day) against real claim dates
- Confirm carrier filtering returns correct subset of claims

### Credential Verification
- All credentials confirmed rotated (Vapi key, PostgreSQL password, webhook secret)
- No `.env` with real credentials committed to repo
- Production secrets on Fly.io (or host secret manager)

---

## Technical Constraints

- Must be run on or remotely connected to the pilot site's Windows machine
- Windows Integrated Auth required for SQL Server connection (`mssql` package)
- `node-windows` used for Windows Service registration
- Column names cannot be assumed — `discover-schema.cjs` output is the source of truth
- Desktop connector authenticates with practice-scoped API token (`desktop_connector_agents`)

---

## Out of Scope

- macOS / Linux builds
- Single installer bundling multiple practices (one connector agent per tenant)

---

## Acceptance Criteria

- [x] `discover-schema.cjs` script ships in repo (`npm run abeldent:discover`); run on pilot Windows PC against SQL Server
- [x] Schema JSON + `schema-map.json` workflow documented (`schema-map.example.json`, `sync-query-builder.cjs --validate`)
- [ ] Patient list from AbelDent visible in dashboard after sync *(requires live session + `ABELDENT_SCHEMA_MAP`)*
- [x] `.exe` installer builds in CI (`.github/workflows/collectrx-electron-installers.yml` job `windows-exe`; code signing optional until cert available)
- [ ] Pilot site runs CollectRx from installer without developer assistance *(pilot)*
- [ ] Windows Service starts on boot and first sync cycle completes *(pilot — see Electron main / installer docs)*
