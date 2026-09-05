# Runbook: Desktop connector offline or sync failed

**Severity: High.** Covers alert catalog IDs `connector_stale`, `connector_sync_failed` (`alertCatalog.ts`). Only relevant for AbelDent-connected practices running the CollectRx desktop app — CSV-only practices don't have a connector to go stale.

## Detection

- `sweepConnectorHealth()` (`Collect-RX-main/src/server/services/connectorSyncMonitor.ts`) runs on a cron sweep (`CONNECTOR_MONITOR_CRON`, default every 15 min) and dispatches:
  - `connector_stale` — no heartbeat within the staleness window, or the connector agent has never checked in.
  - `connector_sync_failed` — the last sync cycle reported an error.
- Each alert is also written to the audit log (`connector.alert.stale` / `connector.alert.sync_failed`).

## Assessment

1. `Admin → Sync ops` — find the connector agent row for the affected practice; check `lastHeartbeatAt`, `lastSyncMessage`, and health status directly.
2. Confirm the practice's desktop app is actually running (tray icon) — the most common cause of `connector_stale` is simply the practice PC being off or the app closed, not a CollectRx-side problem.
3. If heartbeats are present but sync is failing (`connector_sync_failed`): check `lastSyncMessage` for the specific error. Common causes:
   - `COLLECTRX_API_TOKEN` revoked or expired — check token status in `Admin → Sync ops`.
   - AbelDent SQL Server unreachable from the practice LAN, or credentials changed.
   - A schema-map mismatch — `ABELDENT_SCHEMA_MAP` pointing at column names that no longer match the practice's AbelDent install (happens after an AbelDent version upgrade).
4. Ask the practice directly if anything changed recently on their end (new PC, AbelDent update, network change) — this is frequently faster than debugging blind.

## Escalation

- Not an immediate page for a single practice — claims still import via manual CSV as a fallback while the connector is down, and existing queued calls are unaffected. Escalate to whoever owns AbelDent connector support during business hours.
- Escalate faster if it's affecting multiple practices simultaneously (points to a shared cause — API token issuance, a CollectRx-side desktop-app regression) rather than one practice's local environment.

## Mitigation

- **Practice PC/app not running:** ask the practice to relaunch the CollectRx tray app. Nothing to fix server-side.
- **Revoked/expired token:** re-mint the connector token in `Admin → Sync ops` and have the practice update their desktop app config.
- **Schema-map drift after an AbelDent upgrade:** re-run schema discovery against the practice's updated AbelDent instance:
  ```
  npm run abeldent:discover -- --server "<practice-sql-server>" --database AbelDent --out schema-discovery.json
  npm run abeldent:validate-queries
  ```
  update `schema-map.json` to match, and redeploy the corrected map to the practice's desktop config.
- **Meanwhile, unblock the practice:** they can use CSV import (`Admin → Import` or the CSV upload flow) as an immediate fallback so claim follow-up doesn't stall while the connector is being fixed — CSV-first is the default onboarding path for a reason.

## Verification

1. `Admin → Sync ops` — connector shows a fresh `lastHeartbeatAt` and a successful `lastSyncMessage`.
2. Confirm new/updated claims from the practice's PMS actually appear in CollectRx after the next sync cycle.
3. If a schema-map fix was applied, run `npm run abeldent:validate-queries` against the corrected discovery output before considering the fix complete — don't just deploy and hope.

## Postmortem

Not required for a routine practice-side outage (PC off, network blip) that self-resolves. Required if the cause was a CollectRx-side issue (token issuance bug, desktop-app regression) or if it affected multiple practices.
