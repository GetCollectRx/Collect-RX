# Dentrix connector spike (P4-07)

**Time-box:** 2 days research + 5–8 days build for file-drop MVP.

## Finding

| Approach | Feasibility | Time | “Set and forget” |
|----------|-------------|------|------------------|
| Direct SQL to Dentrix DB | Low — closed schema, vendor lock | N/A | No |
| Dentrix API / eConnector | Medium — partner program required | 8–12 weeks | Yes, if approved |
| **Scheduled CSV/XML export to folder** | **High** — practices already can schedule exports | **5–8 days eng** | **Yes** (watch folder) |
| Manual CSV upload (current) | Shipped | 0 | No |

## Recommended MVP: export folder watcher

1. Dentrix scheduled export → `C:\DentrixExports\claims_*.csv`
2. CollectRx desktop watches folder (chokidar)
3. On new file: parse CSV → `POST /api/connector/claims/import` with `pmsVendor: dentrix`
4. Move file to `processed/` subfolder

## Engineering tasks

- [ ] `desktop/services/dentrix-export-watcher.js`
- [ ] Config: `dentrixExportPath` in `agent-config.json`
- [ ] Idempotency: file hash in local state file
- [ ] Runbook: `docs/pilot/DENTRIX-SETUP.md`
- [ ] Enable `supportsDesktopConnector: true` in `pmsRegistry.ts` when shipped

## Dependencies

- AbelDent Pilot-0 complete (connector auth pattern proven)
- Practice willing to schedule Dentrix export (5 min IT setup)

## Out of scope for spike

- Real-time Dentrix API
- Write-back to Dentrix ledger
