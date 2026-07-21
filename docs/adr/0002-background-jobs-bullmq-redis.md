# ADR 0002: Background jobs — BullMQ + Redis

**Status:** Accepted  
**Date:** 2026-04-25  
**Context:** P8-01 (Phase 8)

## Context

CollectRx runs A/R work on two paths today:

- **Rules engine (legacy `Balance` model):** a periodic evaluation loop (stages, outreach events).
- **Patient reminder engine (`PatientBalance`):** a daily cycle (email/SMS + Stripe link), implemented in `runReminderCycle`.

Originally these were intended to run **in-process** with the HTTP server (`setInterval`, `node-cron`). For horizontal scaling and clearer ops boundaries, background work should move to **dedicated worker processes** backed by a **durable queue** with visibility into depth and age.

## Decision

1. **Queue + broker:** use **BullMQ** (Redis-backed job queue for Node) with a **single Redis** connection URL from **`REDIS_URL`**.

2. **Alternatives considered (not chosen for v1 in-repo implementation):**  
   - **AWS SQS / GCP Pub/Sub:** fine for orgs already on those clouds; adds vendor SDK, IAM, and a second operational surface. Revisit if Redis is not acceptable.  
   - **Cloud Tasks (HTTP push):** good for serverless pull; we’d still need an idempotency store (DB) and a separate HTTP surface; more moving parts.  
   - **Only cron + no queue:** one worker is OK; does not give queue depth or cross-region scaling.

3. **Worker vs API process:** when **`REDIS_URL`** is set, the **API** enqueues **repeatable jobs** only (scheduling); a separate **`npm run worker`** process runs **Bull workers** that execute `RULES_TICK` and `REMINDER_CYCLE`. When **`REDIS_URL` is unset**, the monolith **falls back** to the previous in-process `setInterval` + `node-cron` (local dev, tests).

4. **Scaling rule:** you may run **multiple API** replicas; schedule registration should run in a way that does not duplicate repeatables (we remove existing repeatables of the same logical job before re-registering on API boot, or you run a **single** “scheduler” release job—see [PHASE8-BACKGROUND.md](../operations/PHASE8-BACKGROUND.md)). Run **one or more workers**; job handlers use **DB idempotency** (P8-04) so retries are safe for reminders.

5. **Redis hosting:** any compatible Redis 6+ (Upstash, ElastiCache, self-hosted, etc.). TLS URLs must be supported by the deployment’s `ioredis` config if required by the host.

## Consequences

- **Ops:** add Redis to production/staging; set `REDIS_URL`; add a second service (or process type) for `node ... workerEntry`.  
- **Failure modes:** if Redis is down, API still serves HTTP; workers stop processing until Redis returns (repeatables resume).  
- **CI:** can omit `REDIS_URL`; unit/integration tests use in-process or skip queue metrics.

## Related

- [PHASE8-BACKGROUND.md](../operations/PHASE8-BACKGROUND.md) — runbook, env, metrics, alerts.  
- [0001-primary-application-stack.md](0001-primary-application-stack.md) — canonical app path.
