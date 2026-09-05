# Runbook: Call queue not dispatching

**Severity: Critical.** Covers alert catalog IDs `queue_dispatch_stalled`, `desk_queue_tick_failing`, `call_attempt_stuck` (`alertCatalog.ts`). This is the desk queue engine (`Collect-RX-main/src/server/frontDesk/queueEngine.ts`) — a plain `setInterval` loop, **not** a BullMQ job. If BullMQ (`worker_job_failed`) is what's actually failing, use `worker-job-failures-and-dlq.md` instead.

## Detection

- `queue_dispatch_stalled` — due claims have been waiting past the stall threshold (`OPS_ALERT_QUEUE_STALL_MINUTES`, default 5 min) while the call window is open.
- `desk_queue_tick_failing` — `runDeskQueueTick()` has thrown on 3+ consecutive ticks; the engine is backing off exponentially between retries (P0.5).
- `call_attempt_stuck` — a `CallAttempt` row has had no `completedAt` for longer than `OPS_ALERT_ATTEMPT_STUCK_MINUTES` (default 150 min) — usually a lost end-of-call webhook, and it holds that practice's single-call dispatch lock the whole time.

## Assessment

1. `GET /api/health/metrics` (or `/api/diagnostics`) — read the `queue` block:
   - `duePendingCount` / `oldestDuePendingAgeMinutes` — how big and how old is the backlog.
   - `lastSuccessfulTickAt` / `consecutiveTickFailures` / `lastTickFailureAt` — is the tick loop actually running, or stuck failing?
   - `openCallAttempts` / `oldestOpenAttemptAgeMinutes` — is a stuck attempt holding a practice's dispatch lock?
2. `fly logs -a collect-rx` — grep for `[deskQueueEngine]`. A tick failure logs the underlying error with `consecutiveTickFailures` and `nextRetryInMs`.
3. Check the cross-replica lease — a crashed replica can leave a stale claim:
   ```sql
   SELECT * FROM queue_engine_lease;
   ```
   If `locked_by` refers to a replica that's no longer running and `locked_until` is in the future, no other replica can claim the tick until it expires (`LEASE_TTL_MS`, 90s) — this self-heals within two tick intervals; if it's been longer than that, something is wrong with lease renewal itself, not just one stale row.
4. Rule out an upstream cause before assuming the queue engine itself is broken: `GET /api/diagnostics` also reports `vapiCircuitBreaker` and `database` — if Vapi's breaker is OPEN or the DB is unreachable, the queue tick failing is a *symptom*, not the root cause (use `vapi-circuit-breaker-open.md` or `database-unreachable.md` instead).
5. Is `isTickRunning` genuinely stuck (not just "in progress")? A tick normally completes well under 60s. If logs show no new `[deskQueueEngine]` activity for several minutes and `consecutiveTickFailures` isn't climbing (meaning it's not even reaching the failure path), the process itself may be wedged — check `GET /api/health/live` for `status: 'blocked'` (event-loop stuck).

## Escalation

- **Any stall longer than 15–20 minutes during the call window is an all-hands page** — a full day of zero outbound calls for a practice can go unnoticed without this alert, per the original design intent of this signal.
- If `consecutiveTickFailures` is climbing and the underlying error is unclear from logs alone, don't wait out the exponential backoff (it caps at 15 minutes between attempts) — investigate and fix in parallel; the backoff exists to avoid hammering a failing dependency, not as an acceptable resolution timeline on its own.

## Mitigation

- **Stuck `isTickRunning` / wedged process:** restart the API (`fly machine restart` or redeploy). The graceful-shutdown path (`drainDeskQueueEngine()`) will wait briefly for an in-flight tick before force-exiting.
- **Stale lease row from a crashed replica:** normally self-heals in ≤2 tick intervals (~2 min) as `LEASE_TTL_MS` expires; if it hasn't, and you're certain the referenced replica is actually gone, clear the row manually — `UPDATE queue_engine_lease SET locked_until = now() WHERE id = 'global';` — but confirm the replica is really dead first; clearing a live replica's lease risks two replicas dispatching simultaneously.
- **Stuck `CallAttempt`:** confirm with the Vapi dashboard that the call actually ended, then close the row manually so the dispatch lock releases (`stale call attempt — closing` is exactly what the engine's own automatic sweep does for attempts older than 3 hours; if you need it released sooner than that, do it by hand and record why in the postmortem).
- **Consecutive tick failures from a real bug:** fix the underlying error (DB, Redis, or a code regression in `runDeskQueueTick()`); no manual reset is needed — the next successful tick clears `consecutiveTickFailures` automatically.

## Verification

1. `GET /api/health/metrics` — `queue.consecutiveTickFailures` back to `0`, `lastSuccessfulTickAt` updating every ~60s.
2. `queue.duePendingCount` trending down, not flat or climbing.
3. Watch at least one real dispatch happen end-to-end (`Console`/live desk view shows a call actually placed) before considering it resolved — the counters resetting doesn't by itself prove calls are going out.

## Postmortem

Required. If the cause was a stale lease or a stuck `CallAttempt`, the action items should address why the self-healing mechanisms (lease TTL, the automatic stale-attempt sweep) didn't catch it in time — not just this one manual fix.
