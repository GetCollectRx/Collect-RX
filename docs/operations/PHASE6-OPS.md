# Phase 6 — Platform operations & reliability (CollectRx)

Master index for P6-01…P6-10. **Not** a substitute for your host’s own runbooks (Railway, etc.).

| ID | Topic | In repo | You / operator |
|----|-------|---------|----------------|
| **P6-01** | Structured logging | `LOG_JSON`, JSON request lines, `redactString` in [logger.ts](../../Collect-RX-main/src/server/observability/logger.ts); [tests](../../Collect-RX-main/tests/observability-logger.test.ts) | Forward stdout to your log store; set retention; never log raw bodies in prod |
| **P6-02** | Error tracking | Optional **Sentry** server + browser: `SENTRY_DSN`, `VITE_SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_RELEASE` / `RAILWAY_GIT_COMMIT_SHA` | Create Sentry project; set DSNs; tune sampling; link alerts |
| **P6-03** | Golden signals | `GET /api/health/metrics` — in-process `requests`, `errors5xx`, `avgLatencyMs` + `processUptimeSec` | Use Sentry APM, Datadog, or Grafana for **per-route p95** and multi-instance; this endpoint is a **single-node** hint |
| **P6-04** | Uptime / alerts | `GET /api/health` (liveness, no DB) · `GET /api/health/ready` (DB `SELECT 1`, **503** if down) | Configure UptimeRobot / Better Uptime / cloud LB health checks: poll **`/api/health/ready`** for deep checks; ` /api/health` for “process up only”; alert if **ready** down **> N min** |
| **P6-05** | Backups + restore | [Backups (below)](#database-backups-p6-05) + [DATABASE.md](../DATABASE.md) | Enable auto backups on Postgres; **quarterly** restore to staging; write **RPO/RTO** in your op doc |
| **P6-06** | Deploy & rollback | [Deploy/rollback (below)](#deploy--rollback-p6-06) | Railway “rollback deployment” or re-tag previous image; `prisma migrate deploy` after deploy |
| **P6-07** | Failed webhook replay | [Webhook replay (below)](#webhook-replay-p6-07) | Prefer Stripe **Dashboard** resend after fix; or CLI with care for signature age |
| **P6-08** | Staging = prod | [Parity (below)](#staging-parity--smoke-p6-08) | Same `NODE_ENV` shape, same Prisma migrate path; smoke [curl](#smoke) after prod deploy |
| **P6-09** | Status / comms | Optional: `STATUS_PAGE_URL` in your internal wiki or vendor status (Atlassian Statuspage, Instatus) | Link in customer comms; or email template for incidents |
| **P6-10** | On-call / SLA | Document **explicit** “no 24/7” in Terms **or** a real rotation | [On-call (below)](#on-call--sla-p6-10) |

## Database backups (P6-05)

- **RPO** (max acceptable data loss): = your provider’s **backup interval** (e.g. 24h daily snapshot → 24h RPO unless you use PITR).
- **RTO** (time to become live again): restore to new instance + `DATABASE_URL` + smoke test; measure in a **fire drill** once a quarter.
- **Test restore (staging):** create a new DB, `pg_dump` from backup or provider “restore to fork”, set `DATABASE_URL` on a staging app, `npm run db:migrate -w dental-ar-system`, smoke [curl](#smoke). Do not use prod credentials on developer laptops in violation of your policy.

## Deploy & rollback (P6-06)

**Deploy (typical monorepo root):** `git pull` → set env on host → `npm run db:migrate -w dental-ar-system` (or your CI does this) → `npm run build -w dental-ar-system` / start `tsx src/server/index.ts` or `node` dist.

**Rollback:** redeploy the **previous** good commit (Railway: redeploy; Docker: previous tag). Migrations: **do not** auto-downgrade in prod without a DBA; forward-fix data if a migration already ran.

**Feature flags:** not in app v1; use env or separate route if needed.

## Webhook replay (P6-07)

- **Stripe:** [Dashboard](https://dashboard.stripe.com/) → **Developers → Webhooks** → find failed delivery → **Resend** after the bug is fixed. Idempotency: `ProcessedStripeEvent` in DB (`evt_…`).
- **SendGrid / Vapi / Twilio:** resend is provider-specific; avoid double-posting: rely on your **idempotency** tables and logs.
- **Max age:** if Stripe rejects very old webhooks, fix forward and use Dashboard replay or a controlled manual settlement with audit.

## Staging parity + smoke (P6-08)

- Same `ALLOWED_ORIGINS`, same integration keys **type** (test keys on staging, live on prod), same `prisma migrate deploy` pipeline.
- **Smoke** after each prod deploy (or CI against staging):

### Smoke (curl)

```bash
# Liveness
curl -sf "https://YOUR_API_HOST/api/health" | jq .

# Readiness (fails if DB down)
curl -sf "https://YOUR_API_HOST/api/health/ready" | jq .

# Metrics
curl -sf "https://YOUR_API_HOST/api/health/metrics" | jq .
```

**Login** via browser or scripted session cookie is a stronger smoke; keep minimal for CI.

## On-call & SLA (P6-10)

- If you **do not** offer 24/7: state it in **Terms of Service** and support page.
- If you **do**: define pager rotation (Opsgenie, PagerDuty) and response windows; this repo does not configure on-call.

## Sentry as “metrics dashboard” (P6-02 / P6-03)

- After `SENTRY_DSN` is set, open your Sentry project for **error rate**, **traces** (if `SENTRY_TRACES_SAMPLE_RATE` > 0), and **releases** (if `SENTRY_RELEASE` is set in CI). That satisfies “dashboard link” in spirit for a small team; wire Datadog later if you need SLOs.

## Status page (P6-09)

- Optional: create a public status page and add the URL in your help desk auto-reply. No in-app link required for v1.

---

*Index for [OUTSTANDING-FIXES-PRODUCT-READY.md](../OUTSTANDING-FIXES-PRODUCT-READY.md) Phase 6.*
