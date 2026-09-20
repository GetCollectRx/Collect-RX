# Runbook: Database unreachable or schema drift

**Severity: Critical.** Covers alert catalog IDs `database`, `database_readiness`, `readiness`, `migration_drift` (`alertCatalog.ts`).

## Detection

- `GET /api/health/ready` returns `503 { status: 'not_ready' }`.
- `dispatchOpsAlert({ alertId: 'database_readiness', ... })` fires from `opsMonitor.ts`'s 5-minute tick when `SELECT 1` throws.
- `migration_drift` fires from the startup health scan (`startupHealthScan.ts`'s `checkMigrationDrift()`) when a migration file shipped with the running code was never applied to the connected database.
- Fly's own health check (`fly.toml`'s `[[http_service.checks]]`, if it targets `/api/health/ready`) will mark the instance unhealthy and stop routing it traffic.

## Assessment

1. `GET /api/health/ready` — confirm it's actually down, not a one-off blip.
2. `GET /api/diagnostics` (with `Authorization: Bearer <HEALTH_METRICS_TOKEN>` in production) — check `database.ok` and `database.latencyMs`/`database.error` for the exact failure, plus whether other subsystems (desk queue, BullMQ) are also failing as a result — a DB outage cascades.
3. `fly postgres list` / `fly status -a collect-rx` — is the Postgres app itself up? Check CPU/connection counts on the Fly dashboard.
4. If the DB is up but queries fail: `npm run db:verify-tables` — checks for missing tables/columns (schema drift), the most common cause of `migration_drift`.
5. Check `DATABASE_URL`'s TLS mode — `Collect-RX-main/src/server/databaseTls.ts`'s `assertPostgresTlsInProduction()` will refuse to boot a fresh process in production without `sslmode=require` (or stricter), so if a *new* instance won't start at all (not just report unhealthy), check its boot logs for that specific fatal log line before assuming a network issue.

## Escalation

- **Any 503 on `/api/health/ready` lasting more than a few minutes in production is an all-hands page**, not a wait-and-see — every practice's login, claims view, and the entire call queue are blocked while this is down.
- If `migration_drift` fires and the fix requires `prisma migrate deploy` against production data, and you are not confident about the migration's blast radius (a destructive column change, a large table lock) — get a second person to review the migration file before running it. Applying the wrong migration to a live database is worse than staying down a few more minutes.

## Mitigation

- **DB itself down (Fly Postgres):** follow your Postgres provider's incident process — this is infra, not app-level. Once it's back, verify the API reconnects (Prisma reconnects automatically; if not, restart the API: `fly machine restart` / redeploy).
- **Schema drift (`migration_drift`):**
  ```
  fly ssh console -a collect-rx -C "npx prisma migrate deploy"
  ```
  or run `npm run db:migrate` (`prisma migrate deploy`) from a machine with the production `DATABASE_URL`. Confirm the deploy pipeline's `release_command` (`fly.toml`'s `[deploy]` block) actually ran on the last release — a skipped or failed release step is the most common way drift happens in the first place.
- **TLS misconfiguration on a fresh boot:** fix `DATABASE_URL` to include `?sslmode=require` (or `verify-full`/`verify-ca`), or `ssl=true` in the query string, then redeploy. Do not disable this check to "get unblocked faster" — it exists to satisfy PHIPA/PIPEDA encryption-in-transit requirements (`Collect-RX-main/docs/operations/DATA-ENCRYPTION.md`).

## Verification

1. `GET /api/health/ready` returns `200 { status: 'ready' }`.
2. `GET /api/diagnostics` — `database.ok: true`, latency back to a normal baseline (compare against recent history if you have it; a few hundred ms is a bad sign, single-digit-to-low-double-digit ms is normal for a same-region Postgres).
3. `GET /api/health/metrics` — `queue` and `bullmq` blocks are populated again (both depend on the DB), not `{ error: ... }`.
4. Confirm a real practice login and claims-list load successfully — the health checks proving the DB is reachable is not the same as proving the app is actually usable end-to-end.

## Postmortem

Required for any outage that paged on-call or lasted more than a few minutes. If the cause was schema drift, the action items must include closing the gap in the deploy pipeline that let it happen (missing `release_command`, a manual deploy that bypassed it) — not just applying the missing migration this one time.
