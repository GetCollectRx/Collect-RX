# PMS engineering epics (post–AbelDent Pilot-0)

Turn `docs/product/PMS-INTEGRATION-PLAN.md` into shippable work. Each vendor follows the same pattern: **discover → schema-map → scheduled pull → connector token auth → import pipeline**.

## Epic template (all vendors)

| Story | Points | Deliverable |
|-------|--------|-------------|
| Vendor discovery script | 3 | SQL or file schema → `schema-discovery.json` |
| Schema map + validation | 2 | `schema-map.json` + `npm run abeldent:validate-queries` equivalent |
| Desktop or file-drop worker | 5 | POST `/api/connector/claims/import` |
| Pilot runbook | 1 | `docs/pilot/<vendor>-SETUP.md` |
| Field validation | 3 | One practice PC proof |

## EPIC-45: Dentrix

**Spike conclusion:** Dentrix does not expose SQL on the LAN like AbelDent. Options (pick one for v1):

1. **Scheduled export watcher** — Dentrix Office exports claims CSV to a folder; desktop agent uploads via connector import (no SQL).
2. **Dentrix API** — Requires Dentrix developer program + per-practice credentials (8–12 week lead).
3. **Manual CSV fallback** — Already shipped; not “forget it.”

**Recommendation:** File-drop watcher reusing `runPmsImportPipeline` with `pmsVendor: dentrix`. Estimate: **5–8 eng days** after AbelDent proof.

See `docs/product/DENTRIX-CONNECTOR-SPIKE.md`.

## EPIC-46: Open Dental / generic

- Reuse AbelDent `schema-map` + `discover-schema` pattern against MySQL (Open Dental default).
- New worker: `open-dental-sync.js` or extend `abeldent-sync.js` with driver switch.
- Estimate: **10–15 eng days** (new DB driver + discovery).

## EPIC-47: Canadian write-back

- ✅ API: `PmsWritebackLog`, `/api/connector/writeback-pending`, `/api/connector/writeback-ack`
- ✅ Desktop: `abeldent-sync.js` `runWritebackCycle()` executes `payload.sql` UPDATE on-prem
- Follow-up: structured payload templates (avoid raw SQL) — **3 eng days**

## EPIC-48: Registry maintenance

- `pmsRegistry.ts` — set `supportsDesktopConnector: true` per shipped vendor
- `SyncOpsDashboard.tsx` — vendor-specific install copy
- Practice Settings `pmsIngestMode: desktop_connector`

## Priority order

1. AbelDent field proof (Pilot-0)
2. Dentrix file-drop watcher
3. Open Dental MySQL connector
4. Write-back payload hardening
