# Production safety backlog — Operator workstream

**Status: partially implemented.** This document governs the order and shape of ongoing implementation work on observability, reliability, and incident response. Do not start coding against it without re-reading the "current state" column for the item you're picking up — this repo moves fast and this doc will drift like every other one; if you find it stale, fix it in the same change (per the repo-root `CLAUDE.md` rule).

## Shipped ahead of schedule (unsupervised pilot go-live safety pass)

The full backlog below is a multi-month effort (see the timeline discussion in this workstream's chat history — roughly 10–14 weeks of engineering plus staging soak time, solo). Given an unsupervised pilot go-live, the following narrow slice was pulled forward and **is implemented, tested, and passing CI** as of this pass — everything else below is still backlog:

- **Production startup check for ops alerting** (`checkOpsAlertingConfigured()` in `startupHealthScan.ts`) — fails the existing boot-time digest scan (independent of `OPS_ALERTS_ENABLED` itself) if `OPS_MONITOR_ENABLED`/`OPS_ALERTS_ENABLED`/a delivery channel aren't all configured in production. New catalog entry `ops_alerting_disabled`.
- **New alert catalog entries** for `queue_dispatch_stalled`, `call_attempt_stuck` (previously fell back to the generic "Unknown issue" text even though `queueHealth.ts` already emitted these IDs), and `worker_job_failed`.
- **BullMQ retry** — every repeatable job in `registerSchedulers.ts` (`RULES_TICK`, `TRIAGE_CREDENTIAL_HEALTH`, `LEARNING_CYCLE`, marketing jobs) now gets `attempts: 3` + exponential backoff instead of BullMQ's default of a single silent attempt.
- **Worker failure alerting** — `workerEntry.ts`'s `worker.on('failed', ...)` now dispatches a real `worker_job_failed` ops alert once a job exhausts its attempts, via the existing `dispatchOpsAlert` channel (previously `console.error` only). Decision logic extracted to `src/server/jobs/jobFailureAlert.ts` for unit testability.
- **Graceful shutdown for the API process — P0.1, now fully complete** (scope: the API process only; the BullMQ worker already had correct phased shutdown before this pass — see `workerEntry.ts`, untouched): `SIGTERM`/`SIGINT` drive a phased shutdown — `/api/health/ready` flips to 503 immediately, `/ws/desk` clients get a real 1001 close frame (`closeAllDeskConnections()` in `deskWs.ts`), the desk queue tick finishes in flight rather than being abandoned mid-dispatch (`drainDeskQueueEngine()` in `queueEngine.ts`), then the HTTP server drains in-flight requests and Prisma disconnects — bounded by `GRACEFUL_SHUTDOWN_JOB_TIMEOUT_MS`/`GRACEFUL_SHUTDOWN_TOTAL_TIMEOUT_MS` with a force-exit fallback. Replaces the previous bare `SIGTERM`-only handler that called `prisma.$disconnect()` with no drain at all.
  - The orchestration is now split into `runGracefulShutdownSequence()` (exported, pure of `process.exit`/`process.on` — testable directly) and `exitCodeForShutdownResult()` (pure exit-code mapping), with `registerGracefulShutdown()` left as a thin wrapper that's the only place touching real signals and `process.exit`. Every shutdown log line carries a `correlationId` (one `randomUUID()` per shutdown, generated in the real wrapper) for end-to-end tracing across the deskWs/queueEngine/index.ts modules it spans.
  - All of the doc's original P0.1 acceptance criteria are now verified for the API process: zero dropped HTTP requests (proven against a real listening server with a genuinely slow in-flight request, not a mock of `server.close()`), WebSocket clients get real 1001 frames, force-exit on timeout with the correct exit code (1 on timeout, 0 otherwise), `/api/health/ready` returns 503 immediately, and every shutdown event carries a correlation ID. The BullMQ "active jobs allowed to complete" criterion is met by the worker's pre-existing `Worker.close()` behavior, not new work in this pass.
- Tests: `tests/gracefulShutdown.test.ts`, `tests/deskWsShutdown.test.ts`, `tests/healthReadyShutdown.test.ts`, `tests/opsAlertingConfigCheck.test.ts`, `tests/registerSchedulersRetry.test.ts`, `tests/gracefulShutdownSequence.test.ts` (real end-to-end HTTP-drain test against a real server), `tests/gracefulShutdownSequenceMocked.test.ts` (timeout/ordering/correlation-ID tracing) — 48 new tests, all passing. Full suite (1464 tests) verified green against a real Postgres instance with CI-matching role/env setup, including the safety-critical `workflowDispatchSafetyRules` suite.

- **Vapi circuit breaker — P0.2, now done** (`src/vapi/circuitBreaker.ts`, new file): CLOSED/OPEN/HALF_OPEN state machine wrapping `src/vapi/client.ts`'s single `vapiRequest()` choke point (so every Vapi call — `initiateCall`, `endVapiCall`, status/list/transfer — is covered automatically, no per-function changes needed). Failure classification (timeout/5xx/4xx/network/unknown) from the existing thrown-error shapes. Exponential backoff on repeated re-opens (capped), HALF_OPEN probe rate-limiting, and a fleet-wide early-exit check added to `runDeskQueueTick()` (`src/server/frontDesk/queueEngine.ts`) so an OPEN breaker skips the whole tick with one structured log line instead of every candidate claim failing into its own 15-minute deferral. New `vapi_circuit_open` alert (critical, fires once per OPEN transition) and metrics exposed via the existing `getMetrics()`/`/api/health/metrics` JSON body (confirmed: that endpoint is JSON, not Prometheus format — resolves one of this doc's open questions). All of the doc's original acceptance criteria verified: opens within the configured failure count, OPEN rejects immediately without calling the wrapped function, HALF_OPEN probes are rate-limited and CLOSED-after-N-successes/OPEN-after-1-failure both work, the queue tick genuinely does not hang and never reaches `initiateCall` while OPEN (proven against the real `runDeskQueueTick()`, not a reimplementation), and the breaker's scope is structurally limited to `src/vapi/client.ts` — Stripe/SendGrid/DB code never imports it, so nothing else can be affected. Existing `isTickRunning` guard, lease, and slot budget are untouched — this check is purely additive. 73 new tests total across P0.1's completion pass and P0.2, all passing.

**Deliberately not done in this pass, still fully backlog:** the 531-call-site logging consolidation (P0.3), BullMQ dead-letter queue + admin endpoints (P0.4's DLQ half — retry landed, DLQ did not), desk-queue-tick-level retry/backoff (P0.5), deep `/api/diagnostics` (P1.2), Prometheus-format metrics work if that's ever wanted instead of JSON (P1.3), runbooks (P2.1), deploy/rollback rehearsal (P2.2), and the rest of P3. Rushing the logging migration in particular was explicitly rejected — see rationale in this workstream's chat history.

**Action still owed by a human, not code:** confirm `OPS_MONITOR_ENABLED=1`, `OPS_ALERTS_ENABLED=1`, and at least one real delivery channel (`ALERT_SMS_TO`+Twilio, `OPS_ALERT_EMAIL_TO`+SendGrid, or `OPS_ALERT_WEBHOOK_URL`) are set as actual `fly secrets` on the pilot host. The startup check above will now flag it loudly in the boot digest if not, but it cannot set the secrets itself.

**Source:** an external "CLAUDE INSTANCE #1 — THE OPERATOR" ship-plan document proposing a 34-day, P0–P3 production-hardening plan. That document assumed a generic `src/server.ts` / `src/queue/queueEngine.ts` / `src/ops/*` layout that **does not match this repo**. This backlog re-maps every item onto the real code in `Collect-RX-main/`, and corrects several "current state" claims that turned out to already be built. Treat the original doc as a prompt for *what kinds of gaps to look for*, not as a source of truth about what exists.

**Authority:** per repo-root `CLAUDE.md`, `docs/operations/PATH-TO-DELIVERY.md` is the live launch-readiness tracker; this file is a detailed backlog *for the ops-hardening slice of it* (roughly Group F). If the two disagree on status, PATH-TO-DELIVERY wins.

---

## 0. Reality check — what the source doc got wrong

| Doc's claim | Actual state in `Collect-RX-main/` |
|---|---|
| Paths like `src/server.ts`, `src/websocket/websocketServer.ts`, `src/queue/queueEngine.ts`, `src/ops/*`, `src/config/database.ts` | None of these exist verbatim. Real backend is `src/server/index.ts` (single 34KB entrypoint) plus feature folders — see §1 for the corrected map. |
| "No `server.close()`, no request draining" | True for the API (`src/server/index.ts:671-675` — SIGTERM only, no SIGINT, no drain). **False for the worker** — `src/server/workerEntry.ts:177-188` already has a real `shutdown()`: closes health server, `worker.close()`, `prisma.$disconnect()`, `connection.quit()`, on both SIGTERM and SIGINT. |
| "371 console.error calls" | 531 `console.log/error/warn` call sites across 117 files. Two parallel loggers already exist and are **not unified**: `src/server/observability/logger.ts` (JSON-line logger with PHI redaction via `redactString()`/`safeMeta()`) and a separate `src/logger.cjs` used by `queueEngine.ts` and others. Consolidation, not creation from scratch, is the job. |
| "No circuit breaker[,] queue starves practices" | Still true — `src/vapi/client.ts:216-231` has only a 30s `AbortSignal.timeout`, no retry/circuit-breaker. |
| Assumes BullMQ everywhere (P0.2/P0.4/P0.5/P1.3) | BullMQ (`collectrx-ar` queue, ADR 0002) only runs `RULES_TICK`, `TRIAGE_CREDENTIAL_HEALTH`, `REMINDER_CYCLE` (disabled), `LEARNING_CYCLE`, marketing jobs, and pre-visit jobs — see `src/server/jobs/registerSchedulers.ts`. **The desk call queue (`runDeskQueueTick` / Vapi dispatch) is not BullMQ at all** — it's a custom Postgres-lease loop in `src/server/frontDesk/queueEngine.ts` with its own `isTickRunning` guard and a cross-replica `queue_engine_lease` table. These are two different subsystems needing two different retry strategies.
| "No retry, no alert dispatch" for BullMQ jobs | Confirmed accurate — every `q.add(...)` call in `registerSchedulers.ts` passes only `{ repeat: ... }`, no `attempts`/`backoff`/DLQ. BullMQ default (`attempts: 1`, no backoff) is what's running today. |
| "`OPS_MONITOR_ENABLED` off by default[,] 2am incident = console-only" | Partially true (defaults are off), but the *system* is already substantial, not a blank slate: `src/server/observability/opsAlerts.ts` (SMS/email/webhook dispatch, cooldown), `opsMonitor.ts` (5-min tick: DB readiness, 5xx ratio, EMR outbox failures, queue health), `alertCatalog.ts`, `startupAlerts.ts`, `queueHealth.ts` all exist and are documented in `docs/operations/OPS-ALERTS.md`. The gap is coverage (no circuit-breaker/DLQ/queue-stall alert IDs yet) and defaults, not a missing system. |
| "No diagnostics endpoint to distinguish Vapi slow vs DB slow vs code bug" | Accurate. `/api/health/ready` (`src/server/index.ts:344`) only does `SELECT 1`. `/api/health/metrics` exists but is a deployment fingerprint + queue health, not a deep diagnostic. No `/api/diagnostics`. |
| "No zero-downtime deployment procedure" | Fly.io (`fly.toml`) is already the deploy target, with `npm run smoke:live` / `smoke:staging` scripts. The doc's blue-green bash-script plan should be replaced with Fly-native rollout config + existing smoke scripts as gates, not a from-scratch pipeline. |

---

## 1. Corrected file map

| Concern | Real location |
|---|---|
| Server entrypoint / boot / shutdown | `Collect-RX-main/src/server/index.ts` (boot at line ~591, SIGTERM at line ~671) |
| WebSocket server | `Collect-RX-main/src/server/frontDesk/deskWs.ts` (`ws`, path `/ws/desk`, attached via `attachDeskWebSocket(server)`) |
| Desk call queue (Vapi dispatch loop) | `Collect-RX-main/src/server/frontDesk/queueEngine.ts` (`runDeskQueueTick`, module-level `isTickRunning`, `claimTickLease()`) |
| BullMQ AR queue (background jobs) | `Collect-RX-main/src/server/jobs/arQueue.ts` (queue), `registerSchedulers.ts` (repeatables), `Collect-RX-main/src/server/workerEntry.ts` (worker process) |
| Vapi HTTP client | `Collect-RX-main/src/vapi/client.ts` (top-level `src/vapi/`, not under `server/`) |
| Structured logger (JSON + PHI redaction) | `Collect-RX-main/src/server/observability/logger.ts` |
| Legacy CJS logger (still in use) | `Collect-RX-main/src/logger.cjs` |
| Ops alerting | `Collect-RX-main/src/server/observability/{opsAlerts,opsMonitor,alertCatalog,queueHealth,startupAlerts,startupHealthScan,sessionHealthCheck}.ts` |
| Metrics | `Collect-RX-main/src/server/observability/metrics.ts` |
| Health routes | Inline in `Collect-RX-main/src/server/index.ts` (`/health`, `/api/health`, `/api/health/ready`, `/api/health/metrics`) — no standalone `healthRoutes.ts` file |
| Rules-tick worker | `Collect-RX-main/src/server/rulesEngine.ts` (`runRulesEngineTick`) |
| Triage/credential health worker | `Collect-RX-main/src/server/triage/triageCredentialHealthJob.ts` |
| Auth routes | `Collect-RX-main/src/server/routes/authRoutes.ts` |
| Insurance routes | `Collect-RX-main/src/routes/insurance.ts` (top-level `src/routes/`, not `src/server/routes/`) |
| Vapi webhook | `Collect-RX-main/src/webhooks/vapi.ts` (mounted route) — also `src/server/vapi/vapiWebhook.ts` (larger file, carrier-block/claims-validator logic); **confirm which is canonical before editing either** |
| Stripe webhook | `Collect-RX-main/src/server/routes/stripeApiRoutes.ts` (`stripeWebhookHandler`) |
| SendGrid webhook | `Collect-RX-main/src/server/sendgrid/handleSendgridEventWebhook.ts` |
| Prisma client singleton | `Collect-RX-main/src/lib/prisma.ts` (not `src/config/database.ts`) |
| Postgres TLS enforcement | `Collect-RX-main/src/server/databaseTls.ts` |
| CARRIER_BLOCK core logic | `Collect-RX-main/src/server/frontDesk/carrierBlockService.ts` (+ `carrierBlockPhrases.ts`, checked in `queueEngine.ts`, `vapiWebhook.ts`, `auditAgent.ts`, `carriers/adapter.ts`) |
| Deploy target | `Collect-RX-main/fly.toml`; smoke gates: `npm run smoke:live`, `npm run smoke:staging` |
| Tests | Vitest (`vitest.config.ts`), flat `tests/*.test.ts` + topic subfolders (`tests/{server,eligibility,frontDesk,...}`) |

---

## 2. Backlog — P0 (blocking ship)

### P0.1 — Graceful shutdown (API process) — ✅ DONE
Implemented in full — see "Shipped ahead of schedule" at the top of this doc for the final design (`runGracefulShutdownSequence()` / `exitCodeForShutdownResult()` / `registerGracefulShutdown()` in `index.ts`, `closeAllDeskConnections()` in `deskWs.ts`, `drainDeskQueueEngine()` in `queueEngine.ts`) and the test files that verify it. Nothing left open on this item for the API process. The BullMQ worker's own shutdown (`workerEntry.ts`) was already correct before this pass and was not modified.

### P0.2 — Circuit breaker for Vapi client — ✅ DONE
Implemented in full — see "Shipped ahead of schedule" at the top of this doc. `src/vapi/circuitBreaker.ts` (new), wired into `src/vapi/client.ts`'s `vapiRequest()` and `src/server/frontDesk/queueEngine.ts`'s tick-level dispatch gate. CARRIER_BLOCK check ordering was verified unaffected — the breaker check is a separate early-return before the per-practice loop; CARRIER_BLOCK is still evaluated per-claim inside that loop exactly as before, untouched.

### P0.3 — Structured logging consolidation
**Real gap:** not "replace console with a new logger" — it's **reconcile two existing loggers** (`observability/logger.ts` vs `logger.cjs`) into one interface, then migrate the 531 call sites, heaviest first: `src/server/index.ts` (26), `src/webhooks/vapi.ts` (21), `src/server/routes/authRoutes.ts` (21), `src/routes/insurance.ts` (19), `src/server/compliance/auditAgent.ts` (18), `src/server/workerEntry.ts` (17), `src/server/rulesEngine.ts` (17).
**Build:** decide canonical logger (recommend `observability/logger.ts` — it already has PHI redaction and JSON-line output); give `logger.cjs` callers a migration path; add correlation-ID propagation (header `x-correlation-id` in, same header out, threaded into BullMQ `job.data.correlationId`); add an ESLint rule banning new `console.*` in `src/server/**`, `src/routes/**`, `src/webhooks/**`, `src/workers/**` (allow console in scripts/tooling).
**Verify before extending redaction:** confirm `redactString()`/`safeMeta()` in `observability/logger.ts` actually cover all 7 categories the source doc lists (name, DOB, policy number, phone, email, address, SSN-equivalent) — current agent research only confirmed email/phone-pattern stripping.

### P0.4 — BullMQ job retry & dead-letter handling (AR queue)
**Real gap:** confirmed. `registerSchedulers.ts` adds every repeatable (`RULES_TICK`, `TRIAGE_CREDENTIAL_HEALTH`, `LEARNING_CYCLE`, marketing jobs) with no `attempts`/`backoff` — BullMQ default is `attempts: 1`. `worker.on('failed', ...)` in `workerEntry.ts:171-173` just `console.error`s.
**Build:** add `attempts: 3, backoff: { type: 'exponential', delay: 5000 }` to each `q.add(...)` call in `registerSchedulers.ts`. Add a DLQ path — BullMQ has no built-in DLQ; either use `removeOnFail` + a listener that writes failed jobs (with full error history) to a Postgres table, or the `deadLetterQueue` add-on pattern. Wire DLQ insertion into `opsAlerts.ts` as a new CRITICAL alert ID in `alertCatalog.ts`. Add admin endpoints (`GET /api/admin/dlq`, `POST /api/admin/dlq/:id/retry`).
**Scope boundary:** this item is specifically about the `collectrx-ar` BullMQ queue. Do not conflate with P0.5.

### P0.5 — Desk queue tick error recovery (non-BullMQ)
**Real gap:** this is a **different subsystem** than the doc assumed — `runDeskQueueTick` in `src/server/frontDesk/queueEngine.ts` is a plain `setInterval` loop with `isTickRunning`, not a BullMQ job, so P0.4's fix doesn't cover it. Need to check current error handling around the tick's `setInterval` callback (confirm whether failures are swallowed) before writing retry logic — do this as the first step of implementation, not assumed from the doc.
**Build:** await the tick, structured-log failures with correlation ID, exponential backoff on transient failure, alert after 3 consecutive failures, reduce the stall-alert threshold, expose `queue_last_successful_tick_timestamp` via `queueHealth.ts` (which already backs `/api/health/metrics`).
**Safety note:** must not interact with the cross-replica `claimTickLease()` mechanism in a way that causes two replicas to both back off simultaneously and starve the queue — read that function fully before changing tick scheduling.

---

## 3. Backlog — P1 (critical production readiness)

### P1.1 — Alerting & paging
**Real gap:** smaller than the doc assumed. `opsAlerts.ts` + `opsMonitor.ts` + `alertCatalog.ts` already implement multi-channel (SMS/email/webhook) dispatch with cooldown, documented in `docs/operations/OPS-ALERTS.md`. Remaining work: (a) flip `OPS_MONITOR_ENABLED`/`OPS_ALERTS_ENABLED` defaults for production, with startup validation that fails fast if `ALERT_SMS_TO`/equivalent env is missing in `NODE_ENV=production`; (b) add new alert-catalog entries for circuit-breaker OPEN, queue stall (from P0.5), DLQ insertion (from P0.4) — these three IDs don't exist yet; (c) confirm cooldown window is tunable per the doc's dedup requirement (it already exists — verify default matches 5 min, not just 60 min).

### P1.2 — Health checks & diagnostics
**Real gap:** confirmed. `/api/health/ready` only checks DB. No `/api/health/live` (event-loop-blocked check), no `/api/diagnostics`.
**Build:** add `/api/health/live` (process + event-loop lag check). Add `/api/diagnostics` (admin-auth-gated, reuse the existing bearer-token pattern from `/api/health/metrics`'s `HEALTH_METRICS_TOKEN`) aggregating: Vapi circuit-breaker state + recent error rate (needs P0.2 first), DB pool stats + `SELECT 1` latency, desk-queue tick health (`queueHealth.ts` already has most of this), BullMQ queue depths/DLQ depth (needs P0.4 first). This item is downstream of P0.2 and P0.4 — sequence accordingly.

### P1.3 — Operational metrics
**Real gap:** `observability/metrics.ts` already has in-process counters (`recordHttpRequest`, `recordVapiWebhook`, `recordEmrOutbox`) but the doc's ask is a Prometheus **exposition format** endpoint — confirm whether `/api/health/metrics` today emits Prometheus text or JSON before assuming format work is needed. Add circuit-breaker, desk-queue, and BullMQ-specific metrics per the doc's list, backed by the counters this repo already has where they overlap.

---

## 4. Backlog — P2 (hardening)

### P2.1 — Incident runbooks
No runbooks exist yet under a `runbooks/` directory (only narrative ops docs in `docs/operations/`). Write them per the doc's structure (detection → assessment → escalation → mitigation → verification → postmortem template), but point "assessment commands" at the real endpoints from this repo (`/api/health/ready`, `/api/health/metrics`, and the new `/api/diagnostics` from P1.2) rather than invented ones.

### P2.2 — Deployment & rollback
**Correction:** don't build a bespoke blue-green bash pipeline — this repo already deploys to Fly.io (`fly.toml`) with `smoke:live`/`smoke:staging` scripts and a documented staging pack (`docs/operations/STAGING-SMOKE.md`). The real gap is: (a) a documented, rehearsed rollback command (`fly releases` + `fly deploy --image <previous>` or equivalent) with a target time, (b) wiring `smoke:live`/`smoke:staging` as an automatic post-deploy gate in CI rather than a manual step, (c) confirming Fly's own health-check-gated rollout (`fly.toml` `[[http_service.checks]]`) already provides the canary/auto-rollback behavior the doc wants before building a custom one.

---

## 5. Backlog — P3 (operational excellence)

### P3.1 — WebSocket shutdown handling
Folds into P0.1 — `deskWs.ts` needs a `closeAll()` that sends close code 1001 to all clients in the practice-keyed `Set<Client>`, called from the shutdown orchestrator built in P0.1. Not a separate module.

### P3.2 — Connection pool tuning & stress testing
Collaborative with whoever owns query/index work. `src/lib/prisma.ts` is the real config point (not `src/config/database.ts`). Needs a stress-test pass before any pool-size change is trusted.

### P3.3 — Vapi agent squad handoff protocol docs
Straightforward doc-only item; cross-reference the 5-agent squad description already in the repo-root and `Collect-RX-main` `CLAUDE.md` files (IVR_Navigator, Hold_Sentinel, Claims_Agent, Escalation_Closer, Resolution_Closer) rather than re-describing it from scratch.

---

## 6. Sequencing notes

- **P0.5 depends on reading `queueEngine.ts`'s `claimTickLease()` fully first** — this cross-replica lease mechanism is new relative to what the source doc assumed and changes how retry/backoff must be designed.
- **P1.2 and P1.3 are downstream of P0.2 and P0.4** — diagnostics/metrics for circuit-breaker and DLQ state can't be built before those exist.
- **P0.3's logger consolidation should land before P0.1/P0.2/P0.4/P0.5's structured-logging requirements**, since every other item asks for correlation-ID-bearing structured logs.
- **Any change touching `queueEngine.ts`, `carrierBlockService.ts`, or Vapi webhook handling must preserve the CARRIER_BLOCK check ordering** — this is the repo's stated most-critical safety rule, and it is easy to accidentally reorder during retry/circuit-breaker refactors.
- Before writing code against P0.2/P0.4/P0.5, confirm current error-handling behavior first (this backlog flags where it's "confirmed accurate" vs. "needs re-verification at implementation time") — the source doc's claims were wrong often enough that its unverified claims shouldn't be trusted either.

---

## 7. Open questions to resolve before implementation

1. Which of `src/webhooks/vapi.ts` vs `src/server/vapi/vapiWebhook.ts` is the canonical Vapi webhook handler? Both exist; only one is mounted in `index.ts` today, but this should be confirmed and the unused one either documented as legacy or removed.
2. Does `/api/health/metrics` currently emit Prometheus exposition format or JSON? Determines whether P1.3 is "add metrics" or "add metrics + reformat endpoint."
3. Do `redactString()`/`safeMeta()` in `observability/logger.ts` actually cover all PHI categories (name, DOB, policy number, address) or only email/phone-shaped strings? Needs a direct read before P0.3 claims redaction is "already handled."
4. Is `src/logger.cjs` still load-bearing for any process that can't easily import the ESM `observability/logger.ts` (e.g. a CJS-only entrypoint), which would affect how consolidation is sequenced?
