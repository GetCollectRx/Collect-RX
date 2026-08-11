# Incident runbooks

Per-incident runbooks for the CollectRx API/worker in production. Each follows the same six-stage structure: **detection → assessment → escalation → mitigation → verification → postmortem**. Every "assessment" command below is a real command or endpoint that exists in this repo today — `npm run <script>` names come straight from `Collect-RX-main/package.json`, and every `curl` targets a route that actually exists in `Collect-RX-main/src/server/index.ts`. If you find one that's drifted (a renamed script, a moved route), fix the runbook in the same change — a runbook that lies is worse than no runbook, because it costs time during an actual incident before anyone realizes it's wrong.

## Before you need these

- `docs/operations/OPS-ALERTS.md` — how alerting itself is configured (channels, cooldown, defaults).
- `docs/operations/PRODUCTION-SAFETY-BACKLOG.md` — what's implemented vs. still backlog; check here if a runbook references something that "should" exist.
- `Collect-RX-main/src/server/observability/alertCatalog.ts` — the canonical impact/fix text every ops alert carries. These runbooks expand on the catalog entries with detection signals, assessment commands, and escalation/verification steps the catalog itself doesn't carry — the catalog is the single source of truth for wording an actual alert; keep the two in sync when either changes.

## Assessment endpoints used throughout

- `GET /api/health` — liveness, no DB (also reports ClickHouse mock/connected status).
- `GET /api/health/ready` — 503 if Postgres is unreachable.
- `GET /api/health/live` — 503 `blocked` if the event loop is stuck (added P1.2).
- `GET /api/health/metrics` — request/error counters, Vapi circuit breaker, desk-queue health, BullMQ/DLQ counts. JSON. In production, `deployment` is redacted unless you send `Authorization: Bearer <HEALTH_METRICS_TOKEN>`.
- `GET /api/diagnostics` — the same subsystem checks as `/api/health/metrics` plus DB round-trip latency, all in one response. Requires `Authorization: Bearer <HEALTH_METRICS_TOKEN>` in production, even if the token was never configured (fails closed).
- `fly status -a collect-rx` / `fly logs -a collect-rx` — process-level state and live logs.

## Runbook index

| Runbook | Covers alert ID(s) | Severity |
|---|---|---|
| [`carrier-block-detected.md`](./carrier-block-detected.md) | (no catalog ID — dedicated SMS/email path via `sendCarrierBlockAlert`) | Critical — the single most important operational rule in this codebase |
| [`database-unreachable.md`](./database-unreachable.md) | `database`, `database_readiness`, `readiness`, `migration_drift` | Critical |
| [`call-queue-stalled.md`](./call-queue-stalled.md) | `queue_dispatch_stalled`, `desk_queue_tick_failing`, `call_attempt_stuck` | Critical / High |
| [`vapi-circuit-breaker-open.md`](./vapi-circuit-breaker-open.md) | `vapi_circuit_open` | Critical |
| [`worker-job-failures-and-dlq.md`](./worker-job-failures-and-dlq.md) | `worker_job_failed` | Critical |
| [`api-errors-or-down.md`](./api-errors-or-down.md) | `liveness`, `high_5xx_rate` | Critical / High |
| [`emr-sync-failures.md`](./emr-sync-failures.md) | `emr_outbox_failures` | High |
| [`desktop-connector-sync-issues.md`](./desktop-connector-sync-issues.md) | `connector_stale`, `connector_sync_failed` | High |
| [`cogs-breaker-tripped.md`](./cogs-breaker-tripped.md) | `cogs_breaker` | High |
| [`ops-alerting-disabled.md`](./ops-alerting-disabled.md) | `ops_alerting_disabled` | Critical (nothing else will page anyone until this is fixed) |
| [`deploy-rollback.md`](./deploy-rollback.md) | (procedure, not an alert ID) | — used after a deploy-correlated regression from any of the above |

**Deliberately not given a dedicated runbook:** `typescript`, `tests`, `env`, `ci_failure`, `auth-guard`, `live`, `metrics` — these fire from `npm run diagnose` / CI, not from production traffic; the alert catalog's own `suggestedFixes` (run the named script, read its output) is already the complete runbook for a build-time failure. `recovery-practice-attention` is a practice-facing nudge (open gates, payment traces due), not an operator incident. If any of these starts happening in a way that genuinely needs an on-call runbook, write one then — don't pre-build for a failure mode that hasn't shown up.

## Keep runbooks honest

A runbook is only as good as the last time someone actually ran its commands. When you use one during a real incident:
1. If a command or endpoint in it is wrong, stale, or missing something you needed — fix the runbook in the same PR as your postmortem, not "later."
2. Write the postmortem (`POSTMORTEM-TEMPLATE.md`) within 48 hours. If the runbook's action items from a past postmortem are still open, that's a signal this list needs re-prioritizing, not a reason to skip writing the new one.
