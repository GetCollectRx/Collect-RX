# Internal setup runbook — pilot practice

Use this when onboarding the first AbelDent (or PMS) pilot. Target: practice does nothing after day-one setup.

## Pre-flight (CollectRx ops)

1. **Production API** live at `https://www.collectrx.ca` (Fly).
2. **Practice account** created; owner invited.
3. **PMS** set under Practice Settings → AbelDent, ingest mode `desktop_connector`.
4. **Stripe / Twilio / VAPI** configured per `CLIENT-READINESS-CHECKLIST.md` (calls must work before go-live).
5. **Desktop installers** built from tag `v1.0.0-pilot` (GitHub Releases: mac zip, Windows NSIS).

## Day 0 — remote prep (no practice PC yet)

1. Owner logs into CollectRx → **Admin → Sync ops**.
2. Click **Mint connector token** — copy token to 1Password / secure note (shown once).
3. Send practice:
   - Download link: `https://www.collectrx.ca/download`
   - Connector token (for `COLLECTRX_API_TOKEN`)
   - `docs/pilot/PRACTICE-ASK.md`

## Day 1 — on-site / remote with IT (~30–60 min)

### Install desktop agent (Windows)

1. Install CollectRx desktop from release `.exe`.
2. Edit **`%ProgramData%\CollectRx\agent-config.json`** (created by installer from template):

```json
{
  "apiUrl": "https://www.collectrx.ca",
  "apiToken": "<minted connector token>",
  "abeldentServer": "(local)\\ABELDENT",
  "abeldentDatabase": "AbelDent",
  "syncIntervalMinutes": 15
}
```

No manual environment variables required when using this file. See `desktop/config/agent-config.example.json`.

3. Run **`desktop/scripts/windows-install-mssql.ps1`** as Administrator (installs ODBC + mssql).
4. For schema mapping on site, follow **`docs/pilot/SCHEMA-DISCOVERY-RUNBOOK.md`** (<60 min).
5. Launch app — tray icon should appear; hosted UI opens to dashboard.
5. Confirm sync: **Admin → Sync ops** shows connector **Online** and a recent import run.

### Verify pipeline

1. Import run status `success` or `partial` (not `validation_failed`).
2. **Insurance → Queue** shows work items for imported claims.
3. Trigger a test call only if practice approves.

## Connector API (for debugging)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/connector/heartbeat` | Bearer connector token | Liveness + sync telemetry |
| `POST /api/connector/claims/import` | Bearer connector token | PMS rows → same pipeline as CSV |
| `GET /api/admin/connector/agents` | Owner JWT | List agents + health |
| `POST /api/admin/connector/agents` | Owner JWT | Mint token |
| `DELETE /api/admin/connector/agents/:id` | Owner JWT | Revoke |

Health states: `healthy` (&lt;30m heartbeat), `stale`, `error` (last sync failed), `revoked`, `never`.

## Failure playbooks

| Symptom | Check |
|---------|--------|
| 401 on sync | Token revoked or wrong — mint new token, update PC env, revoke old |
| `mssql not available` | Install ODBC Driver 17+ and `mssql` on practice PC |
| SQL connection failed | `ABELDENT_SERVER` / Windows auth / firewall to SQL port |
| Stale heartbeat | PC asleep, app not running, or no outbound HTTPS |
| Import validation_failed | Row mapping — use Sync ops run details; adjust schema map |

## Post go-live

- Monitor **Admin → Sync ops** connector table daily for first week.
- Audit log actions: `connector.claims.import`, `connector.agent.mint`, `connector.agent.revoke`.
- Do **not** ask practice for recurring CSVs unless connector is down &gt;24h.

## Not validated until real PC

AbelDent SQL sync is **not certified** until tested on a live practice Windows machine with AbelDent SQL Server. Mac dev builds only prove packaging.
