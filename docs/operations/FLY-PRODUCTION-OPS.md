# Fly.io production operations (Phase 4–6)

**Authoritative stack (2026-07):** App **`collect-rx`**, Postgres **`collect-rx-db`** (region **yyz**), Redis via **`REDIS_URL`**. Railway Postgres is **retired** — rotate any stale Railway credentials and remove from local `.env`.

## Local dev → Fly Postgres

Fly Postgres uses internal **`flycast`** hostnames. From your Mac:

```bash
# Terminal 1 — keep running
fly proxy 15432:5432 --app collect-rx-db --bind-addr 127.0.0.1
```

```env
DATABASE_URL=postgresql://collect_rx:PASSWORD@127.0.0.1:15432/collect_rx?sslmode=disable
```

## Sync secrets to Fly

From repo root (reads `Collect-RX-main/.env`, never committed):

```bash
# Preview keys only
DRY_RUN=1 node Collect-RX-main/scripts/sync-fly-secrets.mjs

# Push to collect-rx
node Collect-RX-main/scripts/sync-fly-secrets.mjs
```

Required for production safety:

| Secret | Purpose |
|--------|---------|
| `PHI_ENCRYPTION_KEY` | Application-layer PHI at rest (`openssl rand -hex 32`) |
| `SENTRY_DSN` | Server error tracking |
| `VITE_SENTRY_DSN` | Client error tracking (build-time) |
| `JWT_SECRET` | Session cookies |
| `VAPI_WEBHOOK_SECRET` | Vapi webhook HMAC |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing |
| `SENDGRID_API_KEY` | Transactional email |
| `TWILIO_*` | SMS / voice |
| `REDIS_URL` | BullMQ worker (shared with app) |

Generate missing keys:

```bash
openssl rand -hex 32   # PHI_ENCRYPTION_KEY, JWT_SECRET
```

## Phase 4 go-live checklist (operator)

See [PHASE4-GO-LIVE.md](PHASE4-GO-LIVE.md). Fly-specific additions:

- [ ] **SendGrid:** Event webhook → `https://collect-rx.fly.dev/api/webhooks/sendgrid` (or custom domain)
- [ ] **Twilio:** Inbound SMS URL matches `TWILIO_SMS_INBOUND_URL` exactly
- [ ] **Stripe:** Live webhook → production URL; Connect onboarding complete
- [ ] **Vapi:** Server URL → `/api/vapi/webhook`; secret matches `VAPI_WEBHOOK_SECRET`
- [ ] **DNS:** SPF/DKIM/DMARC on `collectrx.ca` sending domain
- [ ] **CSP:** Enabled automatically in production (`CSP_DISABLED=1` to override)

## Phase 6 observability (operator)

- [ ] **Sentry:** Create project, set `SENTRY_DSN` + `VITE_SENTRY_DSN`, redeploy, trigger test error
- [ ] **Uptime:** Monitor `GET https://collect-rx.fly.dev/api/health/ready` (503 = DB down)
- [ ] **Backups:** `fly postgres backup list --app collect-rx-db`; test restore to staging quarterly
- [ ] **On-call:** See [PHASE6-OPS.md](PHASE6-OPS.md) and [OPS-ALERTS.md](OPS-ALERTS.md)
- [ ] **Post-deploy smoke:** `npm run smoke:live` against production URL after each release

## Deploy

```bash
cd Collect-RX-main
fly deploy --app collect-rx
```

Release command runs `prisma migrate deploy` automatically (`fly.toml`).
