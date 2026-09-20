# Runbook: API down or elevated error rate

**Severity: Critical / High.** Covers alert catalog IDs `liveness` (API not responding at all) and `high_5xx_rate` (`alertCatalog.ts`).

## Detection

- **Fully down (`liveness`):** Fly's health checks fail, or a live smoke run (`npm run smoke:live`) fails outright. Nothing responds — not even `GET /api/health`.
- **Elevated 5xx (`high_5xx_rate`):** `opsMonitor.ts`'s 5-minute tick computes `errors5xx / requests` from `getMetrics()`'s `http` counters and fires once the ratio crosses `OPS_ALERT_5XX_RATIO` (default 0.1) with at least `OPS_ALERT_5XX_MIN_REQUESTS` (default 20) requests in the window.

## Assessment

**If fully down:**
1. `fly status -a collect-rx` — is the machine actually running?
2. `fly logs -a collect-rx` — look for a crash-on-boot stack trace. Common causes: a startup assertion failing (`assertPostgresTlsInProduction`, `assertJwtConfigAtStartup`, `assertPhiEncryptionAtRestConfigured`, etc. — these `process.exit(1)` deliberately rather than boot half-configured).
3. Check `fly.toml`'s `[http_service]` `internal_port` (3000) and health-check path still match what the app actually serves.

**If up but erroring:**
1. `GET /api/health/metrics` — `http.requests`, `http.errors5xx`, `http.avgLatencyMs`. Compare against a healthy baseline if you have one recorded.
2. `GET /api/diagnostics` — check whether the errors correlate with a specific subsystem being unhealthy (DB latency spiking, Vapi breaker OPEN, desk queue failing) rather than being a generic API bug.
3. Check Sentry (`SENTRY_DSN`, if configured) for stack traces grouped by error — this tells you *which* route/handler is throwing, which the counters alone don't.
4. Did a deploy just happen? `fly releases -a collect-rx` — correlate the error-rate spike's start time against the most recent release.

## Escalation

- **Full outage: page immediately, no exceptions.** Every practice, the Electron desktop app, and all incoming webhooks (Stripe, Vapi, SendGrid) are unreachable.
- **Elevated 5xx:** page if the rate keeps climbing or if it's clearly tied to a specific user-facing flow (login, claims list) rather than a background/webhook endpoint. A brief spike that's already recovering by the time you look can be logged and reviewed at lower urgency — use judgment, but err toward paging if unsure.

## Mitigation

- **Crash-on-boot:** fix whatever the boot assertion is complaining about (missing/invalid env var, unreachable DB) and redeploy. Do not remove or bypass the assertion to "get unblocked" — every one of them exists to prevent a specific known failure mode (PHI encryption, JWT config, TLS) from silently shipping.
- **Deploy-correlated error spike:** roll back to the previous release (`fly releases` + `fly deploy --image <previous-image>`, or your team's documented rollback command) while the fix is prepared, rather than leaving broken code live during investigation.
- **Not deploy-correlated (e.g. a dependency outage, DB slowness):** follow the relevant other runbook (`database-unreachable.md`, `vapi-circuit-breaker-open.md`) — the 5xx spike here is usually a downstream symptom.

## Verification

1. `GET /api/health` and `GET /api/health/ready` both return 200.
2. `GET /api/health/metrics` — `http.errors5xx` growth rate back to near-zero over a fresh observation window (the cumulative counter itself won't reset without a restart — watch the *rate*, not the raw total).
3. Run `npm run smoke:live` (or `smoke:staging` against the right target) — confirms the real user-facing paths work end-to-end, not just that health checks pass.

## Postmortem

Required for any full outage. For a 5xx spike, required if it paged or lasted more than a few minutes — include the specific route(s) affected and, if deploy-correlated, what test or check should have caught the regression before it shipped.
