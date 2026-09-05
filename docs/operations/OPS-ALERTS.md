# Ops alerts — impact and suggested fixes

CollectRx can notify you when something breaks, with **what is impacted** and **how to fix it** (not just “check failed”).

## Startup scan (every app launch)

When the **API server** starts (production) or the **Electron app** opens, CollectRx runs a smoke scan (health, DB ready, auth guard). If anything fails, one **digest email** is sent with impact + fixes.

Default recipient: **khalid@collectrx.ca** (override with `STARTUP_ALERT_EMAIL_TO`).

Required in `.env` / host secrets:

```bash
SENDGRID_API_KEY=...
SENDGRID_FROM_EMAIL=ops@collectrx.ca   # must be verified in SendGrid
STARTUP_ALERT_EMAIL_TO=khalid@collectrx.ca
```

- **Production API:** scan runs automatically on boot (`NODE_ENV=production`).
- **Electron:** scan runs on every open (background script); targets `COLLECTRX_API_ORIGIN` or `http://127.0.0.1:3000` in dev.
- **Disable:** `STARTUP_HEALTH_SCAN_ENABLED=0`
- **Manual:** `npm run startup-scan`

## Enable alerts (ongoing ops)

`OPS_ALERTS_ENABLED` and `OPS_MONITOR_ENABLED` **default to on in production** (`NODE_ENV=production`) and off everywhere else — you no longer need to set either explicitly on a production host just to activate the pipe. Set `OPS_ALERTS_ENABLED=0` / `OPS_MONITOR_ENABLED=0` explicitly if you genuinely want them off in production (not recommended for a live pilot: with alerting off, a queue stall, a DB outage, or a DLQ pile-up pages no one). The startup digest scan's `ops_alerting_disabled` check reports the *effective* state (after this default), not just whether the env var was literally set, so a production boot with no channel configured still shows up as failing that check even though the flags themselves are on by default.

What still requires an explicit host secret either way is a **delivery channel** — enabling the pipe without a channel means alerts are computed and logged but never delivered:

```bash
ALERT_SMS_TO=+1XXXXXXXXXX          # existing Twilio on-call number(s), comma-separated
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...
```

Recommended additional channels:

```bash
OPS_ALERT_EMAIL_TO=you@example.com,oncall@example.com
SENDGRID_API_KEY=...               # same as patient email
SENDGRID_FROM_EMAIL=ops@collectrx.ca
OPS_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...   # Slack incoming webhook
```

Runtime monitoring interval (while API is running):

```bash
OPS_MONITOR_INTERVAL_MS=300000     # default 5 minutes
```

See [Collect-RX-main/.env.example](../../Collect-RX-main/.env.example) for thresholds (`OPS_ALERT_5XX_*`, `OPS_ALERT_EMR_MIN_FAILED`, cooldown).

## What triggers alerts

| Source | When | Alert IDs (examples) |
|--------|------|-------------------------|
| `npm run diagnose -- --alert` | After failed typecheck, env, DB, tests, or live smoke | `typescript`, `env`, `database`, `tests`, `live` |
| `npm run smoke:live` | HTTP smoke fails (if `OPS_ALERTS_ENABLED` or `OPS_ALERTS_ON_SMOKE_FAIL`) | `liveness`, `readiness`, `metrics`, … |
| API **ops monitor** | DB ping fails, high 5xx rate, EMR outbox failures | `database_readiness`, `high_5xx_rate`, `emr_outbox_failures` |
| GitHub Actions | CI job fails (if repo secret set) | `ci_failure` (via webhook payload) |

Alerts use a **cooldown** (default 60 minutes per issue) so the same failure does not spam SMS.

## Example alert (SMS / email)

```text
CollectRx ALERT [CRITICAL]
Database not ready

IMPACT:
• Load balancers should mark the instance unhealthy
• Authenticated routes that need DB will fail

AFFECTED:
PostgreSQL, Prisma

DETAIL:
503 from /api/health/ready

FIX:
1. Test: curl $HOST/api/health/ready
2. Restore Postgres connectivity; run prisma migrate deploy
3. Check connection pool limits and DATABASE_URL

Host: https://www.collectrx.ca
Ref: readiness
Source: smoke-live
```

## Commands

```bash
cd Collect-RX-main

# Diagnose + notify on failure
npm run diagnose -- --alert

# Diagnose only (no notify)
npm run diagnose

# Live smoke + notify on failure (server must be running)
OPS_ALERTS_ENABLED=1 npm run smoke:live

# Send alerts from last manual diagnosis (advanced)
npm run alert:diagnosis -- --skip-tests
```

## Host cron (post-deploy smoke)

Add a cron or GitHub Action that runs after deploy:

```bash
SMOKE_BASE_URL=$PUBLIC_APP_URL OPS_ALERTS_ENABLED=1 npm run smoke:live
```

## CI failure webhook

In GitHub → Settings → Secrets, add `OPS_ALERT_WEBHOOK_URL`. The CI workflow posts a structured Slack message when the verify job fails.

## Catalog

Alert copy lives in code: [Collect-RX-main/src/server/observability/alertCatalog.ts](../../Collect-RX-main/src/server/observability/alertCatalog.ts). Add new `id` entries when you introduce new subsystems.

## Related

- [BREAKAGE-DIAGNOSIS.md](./BREAKAGE-DIAGNOSIS.md) — local breakage report without notifications
- [PHASE6-OPS.md](./PHASE6-OPS.md) — uptime and `/api/health/ready`
