# Runbook: Background job failures and DLQ backlog

**Severity: Critical.** Covers alert catalog ID `worker_job_failed` (`alertCatalog.ts`). This is the BullMQ AR queue (`collectrx-ar`, run by `Collect-RX-main/src/server/workerEntry.ts`) — repeatables like `RULES_TICK`, `TRIAGE_CREDENTIAL_HEALTH`, `LEARNING_CYCLE`, marketing jobs, and the `DLQ_RETENTION_SWEEP` itself. This is **not** the desk queue engine — if the call-dispatch loop is what's failing, use `call-queue-stalled.md` instead.

## Detection

- `dispatchOpsAlert({ alertId: 'worker_job_failed', ... })` fires from `workerEntry.ts`'s `worker.on('failed', ...)` handler once a job exhausts all `attempts` (3, with exponential backoff, per job).
- Every job that triggers this alert is also inserted into the dead-letter queue (`insertDeadLetter()` — same handler, same gate) — the two always happen together for the same event.

## Assessment

1. `GET /api/health/metrics` or `/api/diagnostics` — read `bullmq`:
   - `configured` — `false` means `REDIS_URL` isn't set on this instance; if you expected BullMQ to be running and it says `false`, that's the actual problem.
   - `jobCounts` — `failed`/`delayed`/`waiting`/`active` counts from BullMQ itself.
   - `dlqPending` — unresolved `WorkerDeadLetter` rows (`retriedAt IS NULL`).
2. `GET /api/admin/dlq` (platform-admin auth) — paginated list of dead-lettered jobs, newest first, with full per-attempt error history.
3. `fly logs -a collect-rx --process worker` (or `npm run worker` locally) — the failure handler logs `[worker] job failed` with `attemptsMade`/`attemptsAllowed` and the underlying error for every failure, not just the ones that exhaust retries.
4. Identify which job is failing — the alert detail includes job name and ID. `RULES_TICK` failing repeatedly means AR follow-up scheduling is falling behind; `TRIAGE_CREDENTIAL_HEALTH` failing means credential-expiry monitoring is blind; marketing jobs failing has no practice-facing impact.

## Escalation

- **`RULES_TICK` or `TRIAGE_CREDENTIAL_HEALTH` failing repeatedly is a page** — these are core AR-recovery and credential-safety jobs.
- Marketing/learning job failures (`LEARNING_CYCLE`, marketing sequence jobs) are lower urgency — fix during business hours unless the DLQ backlog itself is growing large enough to be a signal of a systemic Redis/DB issue.
- If `bullmq.configured: false` where it should be `true` (Redis expected but `REDIS_URL` unset or unreachable), treat as equivalent to the whole BullMQ subsystem being down — escalate immediately, since **every** repeatable job stops, not just one.

## Mitigation

1. Fix the root cause first (check the error in the DLQ entry / worker logs — commonly a DB or Redis connectivity issue, or a code regression in the job handler).
2. Once fixed, retry the dead-lettered job(s) rather than waiting for the next scheduled repeat:
   ```
   POST /api/admin/dlq/:id/retry
   ```
   This re-enqueues with a fresh attempts budget. Returns 404 if the DLQ record doesn't exist, 409 if it was already retried — don't retry the same ID twice.
3. If the root cause can't be fixed immediately, the repeatable job will simply not run again until its next scheduled fire (per-job cron/interval in `registerSchedulers.ts`) — for `RULES_TICK` (every 60s) that's fine; for `TRIAGE_CREDENTIAL_HEALTH` (daily) or `LEARNING_CYCLE`, decide whether to retry manually once fixed rather than waiting a full cycle.

## Verification

1. `GET /api/health/metrics` — `bullmq.jobCounts.failed` back to baseline, `dlqPending` decreasing (or zero, if you retried everything).
2. `GET /api/admin/dlq` — confirm the retried entries show `retriedAt` set and no new failures for the same job name since.
3. Watch the next natural scheduled run of the affected job succeed on its own, not just the manual retry.

## Postmortem

Required for any job that paged (`RULES_TICK`, `TRIAGE_CREDENTIAL_HEALTH`) or any DLQ backlog large enough to require a bulk retry. `pruneOldDeadLetters()` (30-day default retention, `DLQ_RETENTION_DAYS`) means old entries disappear — capture the DLQ IDs and error detail in the postmortem before they age out if you need them for the writeup.
