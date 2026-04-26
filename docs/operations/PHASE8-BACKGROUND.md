# Phase 8 — Background processing & scale (engineering)

Maps **P8-01…P8-04** in [OUTSTANDING-FIXES-PRODUCT-READY.md](../../OUTSTANDING-FIXES-PRODUCT-READY.md). ADR: [0002](../adr/0002-background-jobs-bullmq-redis.md).

## What runs where

| Component | In-process (no `REDIS_URL`) | With `REDIS_URL` |
|----------|----------------------------|------------------|
| **HTTP API** | Express, same as today | Express; registers BullMQ **repeatable** jobs on boot (see below) |
| **Rules tick (legacy `Balance` stages)** | `setInterval` 60s | Worker runs `runRulesEngineTick` |
| **Patient reminders (`PatientBalance`)** | `node-cron` (`REMINDER_CRON`) | Worker same cron **pattern** from env via Bull `repeat` |

**Deploy a worker:** from repo root, after build:

```bash
# Collect-RX-main, production-style
cd Collect-RX-main
npm run worker
```

`package.json` defines `worker` to run the BullMQ worker entrypoint. Set the **same** `DATABASE_URL` and `REDIS_URL` (and `JWT_SECRET`, etc.) on the worker service as on the web service.

## Environment

| Variable | Required | Purpose |
|----------|----------|--------|
| `REDIS_URL` | For queue mode | Redis connection string (`redis://` or `rediss://` with TLS) |
| `REMINDER_CRON` | No | Default `0 9 * * *` (9:00 daily). Also used in queue mode for the repeat pattern. |
| `DISABLE_SCHEDULER` | No | If `1` or `true`, the **API** does not register repeatables (use a dedicated scheduler process later). |

**Public `GET /api/health/queue`:** when `REDIS_URL` is set on the **API** process, returns BullMQ `getJobCounts` for the AR queue (waiting, active, delayed, failed, …) for P8-03. If Redis is not configured, returns `mode: in_process`.

## Horizontal scaling and duplicate repeatables

- **Multiple web replicas:** each boot may call the scheduler. The implementation **removes** existing Bull repeatable keys for the same queue name before re-adding, to avoid unbounded growth. In high-churn autoscaling, prefer **one** release of the app that runs schedulers or set `DISABLE_SCHEDULER=1` on all but one instance (operational policy).
- **Multiple workers:** safe for throughput; `REMINDER_CYCLE` and `RULES_TICK` are idempotent where it matters (see P8-04 + `ReminderSendLedger`).

## Alerts (P8-03)

- **Queue depth / age:** point Datadog/APM at `GET /api/health/queue` or your vendor’s **Redis** metrics (Bull uses Redis lists/streams by key prefix). **Alert** if `waiting` or `delayed` grows for longer than a threshold, or if `failed` &gt; 0 sustained.
- **“Webhook burst”** (voice/SMS) is still separate from this queue; see [PHASE7-QA.md](PHASE7-QA.md#webhook-burst--p7-06-operational).

## Idempotent reminders (P8-04)

Before sending, the reminder engine uses DB row **`ReminderSendLedger`** (unique `id` per `balance:nextStatus:dayUtc`). On processing failure after insert, the row is removed so the same day can retry. On success, the row remains for the day.

## Local dev

Omit `REDIS_URL` in `.env` to use in-process timers (simplest). To test the worker path locally, run Redis (`docker run redis:7` or `brew services redis`), set `REDIS_URL`, and run the API and `npm run worker` in two terminals.
