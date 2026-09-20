# CollectRx — operations runbook (condensed)

## Logs

- **App:** `tsx src/server/index.ts` (or built `node` in production) — stdout with `console` for server errors, Stripe webhooks, rules engine. Forward to your log aggregator in staging/prod.
- **PII/PHI:** Do not log request bodies, tokens, or patient names in shared logs. Redact on calls to external webhooks and SMS/email.

## Health (Phase 6)

- `GET /api/health` — liveness (no DB).
- `GET /api/health/ready` — readiness; **503** if database unreachable.
- `GET /api/health/live` — process liveness; **503** `blocked` if event-loop lag crosses `HEALTH_LIVE_BLOCKED_MS` (default 2000ms).
- `GET /api/health/metrics` — in-process request/error/latency counters + Vapi circuit breaker + desk-queue health + BullMQ job counts/DLQ backlog. JSON, not Prometheus format (no scrape-based consumer in this stack — alerting is push-based via SMS/email/webhook).
- `GET /api/diagnostics` — one-stop incident view: Vapi circuit breaker, DB latency, desk-queue tick health, BullMQ/DLQ depth. Requires `Authorization: Bearer <HEALTH_METRICS_TOKEN>` in production (fails closed if the token was never configured).
- Alarms, backups, Sentry, deploy/rollback, smoke: [PHASE6-OPS.md](../operations/PHASE6-OPS.md).

## Database

- Migrations: `npm run db:migrate -w dental-ar-system` against `DATABASE_URL`.
- Backups: Use your Postgres provider’s automated backups; test restore on a schedule. See [DATABASE.md](../DATABASE.md).

## Secrets rotation

- See [CREDENTIAL_ROTATION.md](../CREDENTIAL_ROTATION.md) for `JWT_SECRET`, `STRIPE_*`, `DATABASE_URL`, and integration keys.

## Stripe

- **Webhook** URL: `POST /api/stripe/webhook` with raw JSON body. Configure the same path in the Stripe dashboard; idempotency uses the `ProcessedStripeEvent` table (`evt_` IDs).

## Incident (short)

1. Triage: auth breach vs DB vs payment vs third-party.  
2. Contain: rotate creds, disable account if needed.  
3. Notify: per your policy and regulatory obligations.  
4. Record: post-incident log with timeline.
