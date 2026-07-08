# Go-live engineering runbook (ops execution)

Execute these on Fly / provider dashboards. Canonical production URL: **https://www.collectrx.ca** (Fly app `collect-rx`, region `yyz`).

Set `OPS_ALERTS_ENABLED=1`, `OPS_ALERT_EMAIL_TO`, and `CONNECTOR_MONITOR_ENABLED=1` on Fly before pilot.

---

## 1. Re-point webhooks to Fly (item #13)

| Provider | Dashboard path | URL to set |
|----------|----------------|------------|
| **Stripe** | Developers → Webhooks | `https://www.collectrx.ca/api/stripe/webhook` |
| **Vapi** | Assistant / Server URL | `https://www.collectrx.ca/api/webhooks/vapi` |
| **SendGrid** | Settings → Mail Settings → Event Webhook | `https://www.collectrx.ca/api/webhooks/sendgrid` |
| **Twilio** | Phone number → Messaging | `https://www.collectrx.ca/api/twilio/sms` (if SMS enabled) |

**Verify:** After save, trigger a test event (Stripe CLI `stripe trigger`, Vapi test call). Check `fly logs -a collect-rx`.

---

## 2. Stripe live keys + Connect (#14)

```bash
fly secrets set -a collect-rx \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_WEBHOOK_SECRET=whsec_...
```

In CollectRx Admin → Integrations: complete Stripe Connect onboarding for the practice. Confirm **charges enabled**.

---

## 3. SendGrid production (#15)

- Verify domain SPF/DKIM/DMARC in SendGrid
- Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` on Fly
- Enable Event Webhook → URL in §1

---

## 4. Secrets audit (#16)

```bash
cd Collect-RX-main && npm run check:env
```

Rotate any Railway-era values. Minimum set:

- `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`
- `VAPI_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`
- `SENDGRID_*`, `TWILIO_*`
- `GITHUB_RELEASES_TOKEN` (for `/api/desktop/releases`)

See `docs/operations/SECRETS-GO-LIVE.md`.

---

## 5. Postgres encryption at rest (#17)

Fly Postgres: encryption at rest is enabled by default on Fly managed Postgres. Document in your compliance folder:

- Provider: Fly.io
- App: `collect-rx`
- Evidence: Fly security docs + `fly postgres list` output screenshot

---

## 6. Backups + restore test (#18)

```bash
fly postgres backup list -a <postgres-app-name>
fly postgres backup create -a <postgres-app-name>
```

Restore to a staging DB quarterly. Document RPO/RTO in your ops wiki (suggested: RPO 24h, RTO 4h).

---

## 7. Uptime monitoring (#19)

Point UptimeRobot / Better Stack / Pingdom at:

- `https://www.collectrx.ca/api/health` (expect 200)
- `https://www.collectrx.ca/api/health/ready` (expect 200 when DB up)

Alert on 2 consecutive failures.

---

## 8. Sentry (#20)

```bash
fly secrets set -a collect-rx \
  SENTRY_DSN=https://...@sentry.io/... \
  VITE_SENTRY_DSN=https://...@sentry.io/...
```

Redeploy. Trigger a test error; confirm event in Sentry.

---

## 9. Worker + Redis (#10)

```bash
fly secrets set -a collect-rx REDIS_URL=redis://...
fly scale count worker=1 -a collect-rx
fly logs -a collect-rx --process worker
```

Expect: `[worker] listening on queue "collectrx-ar"`.

---

## 10. Staging (#21)

Option A — **Pilot on prod only** (document decision in PILOT-BACKLOG-STATUS.md).

Option B — Deploy `fly.staging.toml` as app `collect-rx-staging` with separate `DATABASE_URL` and test keys only.

---

## 11. Deploy + migrate

```bash
git push origin main
fly deploy -a collect-rx
# release_command runs prisma migrate deploy automatically
```

---

## 12. Pilot installer (#26)

```bash
git tag v1.0.0-pilot
git push origin v1.0.0-pilot
```

Download Windows `.exe` from GitHub Releases. Hand to practice IT with `docs/pilot/PRACTICE-ASK.md`.

---

## 13. Connector ops alerts (#5)

```bash
fly secrets set -a collect-rx \
  OPS_ALERTS_ENABLED=1 \
  CONNECTOR_MONITOR_ENABLED=1 \
  OPS_ALERT_EMAIL_TO=ops@collectrx.ca
```

Stale connectors (>30m heartbeat) and sync failures trigger `connector_stale` / `connector_sync_failed` alerts.
