# Platform Health Dashboard — Spec

Status: draft, not started
Owner: TBD
Depends on: none (independent of the Fly.io migration)
Repo: GetCollectRx/Collect-RX

## Problem

Khalid (platform_dev) currently has no single place to see how CollectRx is performing across all client practices at once. The only cross-practice view today is business-metric-only (claims resolution), and there is no operational/infra health signal: no visibility into per-practice errors, stuck jobs, failed integrations, or degraded service, without going practice-by-practice or reading raw logs.

## Non-goals

- No patient-identifiable data (PHI) of any kind. Every field on this dashboard must be derivable without touching patient records, insurance claim content, clinical notes, or the PII vault.
- Not a replacement for `/api/health` and `/api/health/ready` (machine-level liveness/readiness). This is a practice-level operational view, one layer up.
- Not a support/debugging tool for reproducing a specific practice's bug with real data. That's a separate, harder problem (see Open Questions).

## What already exists (do not rebuild)

- `src/server/routes/groupAdminRoutes.ts` — `GET /api/group/practices-summary`. Role-gated via `authorizeRole('group_admin')`; per `authorizeRole.ts`, `platform_dev` always passes the hierarchy check, so platform_dev already has access to this route today. Returns per practice: `id`, `name`, `timezone`, `subscriptionStatus`, `totalClaims`, `resolvedClaims`, `resolutionRate`, `activeUsers`. All PHI-free by construction (aggregate counts only, no claim or patient content).
- `/api/health` and `/api/health/ready` — machine-level liveness/readiness, already used in the Fly migration's smoke testing.
- `src/server/observability/sessionHealthCheck.ts`, `runStartupScan.ts` — per-boot internal checks (DB, ClickHouse, PII vault rehydration).
- `src/server/observability/opsAlerts.ts`, `startupAlerts.ts` — existing SendGrid-based alerting pattern (email on startup failure). This is the natural mechanism to extend for "notify me when a practice goes unhealthy," rather than inventing a new notification path.
- BullMQ queue `collectrx-ar` on shared Redis, with named repeatables (`RULES`, `LEARNING`, `MARKETING`, `MARKETING_LEARNING`) visible in worker boot logs — currently no way to see per-practice job success/failure from a UI, only from raw Fly logs.
- Prisma `practice` model already has `subscriptionStatus`, confirmed via the existing endpoint.

## Proposed scope — Phase 1

Extend `GET /api/group/practices-summary` (or add a sibling endpoint, e.g. `GET /api/group/practices-health`) with an operational block per practice:

- `lastActivityAt` — timestamp of the most recent claim/job touched for this practice, so a practice going silent is visible without knowing what "normal" volume looks like for them.
- `failedJobsLast24h` / `failedJobsLast7d` — count of BullMQ job failures scoped to this practice, if jobs carry a practiceId (needs confirming against the job payload shape in `workerEntry.ts`).
- `integrationStatus` — per practice, whether the integrations that practice actually uses are configured and last succeeded (e.g., VAPI call attempted/succeeded, SendGrid delivery attempted/succeeded). Boolean/enum only, no content.
- `subscriptionStatus` — already present, keep as-is.
- `errorRate24h` — a simple ratio (failed / attempted) over the last 24h for whatever the practice's primary automated workflow is (claim submission, follow-up calls, etc.).

All of the above are counts, timestamps, and booleans. None require reading a claim's content or a patient's name.

## Proposed scope — Phase 2 (optional, lower priority)

- A platform-wide rollup view (not per-practice): total active practices, total practices in a degraded state, aggregate job failure rate, aggregate queue depth.
- Threshold-based alerting: reuse the `opsAlerts.ts` SendGrid pattern to notify Khalid automatically when a practice crosses an error-rate or silence threshold, rather than requiring him to check the dashboard.
- A lightweight UI page under the platform_dev-gated section of the app (there is currently a developer login path with "Full ops and config access without patient-identifiable data" per the login screen; this dashboard should live there).

## Data model changes needed

- Confirm whether BullMQ job payloads for the `collectrx-ar` queue already carry `practiceId`. If not, this needs to be added before per-practice failure counts are possible. (Not yet verified — check `workerEntry.ts` and the job producer code before starting implementation.)
- No Prisma schema changes anticipated for Phase 1 beyond possibly indexing `practiceId` + `createdAt` on whatever table backs job/attempt logging, for query performance at scale.

## Access control

No changes needed. `authorizeRole('group_admin')` already permits `platform_dev`. Any new route should reuse the same gate as `practices-summary`, not invent a new role check.

## Security / compliance notes (PHIPA scope)

- Every new field must be reviewed against "could this leak PHI indirectly" (e.g., a claim count of exactly 1 for a tiny practice could theoretically be identifying in combination with other public info — low risk here given practice-level, not patient-level, granularity, but worth a second pair of eyes before shipping).
- Log access to this dashboard itself (who viewed it, when) for audit purposes, consistent with general PHIPA operational discipline even though the dashboard itself carries no PHI.
- Do not add a raw log tail or stack-trace viewer to this surface. Error counts and timestamps are fine; error messages/stack traces can leak PHI incidentally (e.g., a validation error message that echoes back a patient's name) and should stay in Fly's log viewer / Sentry, not in this dashboard.

## Open questions for Khalid

1. Does "how it's performing at all times" mean you want push notifications/alerts (extend `opsAlerts.ts`), or is a dashboard you check on your own cadence sufficient for now?
2. Should Phase 1 ship as an extension of the existing `/api/group/practices-summary` response, or a new endpoint? New endpoint is cleaner (avoids slowing down the existing business-metrics call with new joins) but means two calls from the frontend instead of one.
3. For "break-glass" access to real practice data when a specific practice reports a bug that can't be reproduced with synthetic data — out of scope for this spec, but worth deciding separately whether you want that built at all, given the audit/compliance overhead it carries under PHIPA.

## Suggested sequencing

Not started until after the Fly.io migration (Tasks 22–26) is complete and stable. This is additive, not migration-blocking.
