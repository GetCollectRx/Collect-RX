# CollectRx Release Readiness Agent

**Purpose:** Pre-deployment and post-deployment verification. Ensures nothing ships broken, no PHI boundary is violated by a new build, and the system is confirmed healthy after deploy. Run before every production deployment and within 15 minutes after.

---

## Context

CollectRx deploys to Railway (backend + PostgreSQL) and as an Electron `.exe` installer for Windows desktop. CI builds trigger on version tags. The Electron build must be code-signed — unsigned builds must never reach a practice machine.

CI reference: `.github/workflows/ci-collectrx.yml`
Release process: `docs/RELEASING.md`
Changelog: `CHANGELOG.md`

---

## Pre-Deployment Checklist

### Code Quality Gates

- [ ] `npm test` passes — all tests green including:
  - `tests/eligibility.test.ts` (deductible, annual max, COB, reconciliation — money-affecting rules)
  - Auth tests (validate the 2026-05-29 auth fail-open fix is still in place)
  - Outcome confidence tests (anti-hallucination gate)
- [ ] `npm run lint` — zero errors
- [ ] `tsc --noEmit` — zero type errors
- [ ] Semgrep CI scan passes (configured in `ci-collectrx.yml`)
- [ ] `npm audit --omit=dev` — no new critical or high severity advisories

### PHI Boundary Review (for any PR touching Vapi, queue, or detokenization)

- [ ] Search the diff for any new variable passed to `vapiService.startCall()` or `initiateCall()` that could contain patient data
- [ ] Search for any new `console.log` near PHI fields
- [ ] If the Vapi payload shape changed: re-verify no PHI variables were added

### CHANGELOG Update

- [ ] `CHANGELOG.md` has an entry for this version
- [ ] The entry describes user-visible changes (not just "refactoring")
- [ ] Version number follows semantic versioning

### Database Migrations

- [ ] If new Prisma migrations exist: `prisma migrate deploy` is scripted into the deploy process (not manual)
- [ ] New NOT NULL columns have a default value (to avoid locking issues on non-empty tables)
- [ ] Migration has been tested against staging DB first

### Environment Variables

- [ ] No new required env vars were added without updating `.env.example`
- [ ] No existing required env var was renamed without a migration path
- [ ] New secrets are documented in the secrets runbook (`docs/operations/SECRETS-GO-LIVE.md`)

### Electron Build (if desktop is in scope for this release)

- [ ] Build runs on `windows-latest` CI (required for NSIS + code signing)
- [ ] Code signing uses `CSC_LINK` and `CSC_KEY_PASSWORD` secrets (confirm they are still set in GitHub Actions)
- [ ] Build produces a signed `.exe` (verify signature: `signtool verify /pa installer.exe`)
- [ ] `electron-updater` version channel is correct (don't push a beta to the stable update channel)

---

## Deployment Steps

1. Tag the release: `git tag vX.Y.Z && git push origin vX.Y.Z`
2. CI builds backend, runs tests, runs Semgrep
3. If Electron is in scope: CI builds and signs the Windows installer
4. Railway auto-deploys on successful CI (or manually trigger if not configured)
5. Run `prisma migrate deploy` against production (if migrations are pending)
6. Proceed to Post-Deployment Verification immediately

---

## Post-Deployment Verification (within 15 minutes of deploy)

### Health Endpoints

```bash
# Liveness
curl -f https://api.collectrx.ca/api/health

# Readiness (DB connection)
curl -f https://api.collectrx.ca/api/health/ready

# Queue health (requires HEALTH_METRICS_TOKEN)
curl -H "Authorization: Bearer $HEALTH_METRICS_TOKEN" https://api.collectrx.ca/api/health/metrics
```

- [ ] `/api/health` returns 200
- [ ] `/api/health/ready` returns 200 (if 503, DB connection is down — rollback)
- [ ] `/api/health/metrics` returns valid JSON with deployment flags

### WebSocket Connectivity

- [ ] Log in as `front_desk` and navigate to `/console`
- [ ] Confirm WebSocket connects (no "connection failed" message in LiveConsole)
- [ ] Confirm no 401/4001 rejection in browser dev tools WebSocket tab

### Vapi Webhook

- [ ] Send a test ping to `POST /api/webhooks/vapi` (or check Vapi dashboard for last successful webhook delivery)
- [ ] Confirm webhook is receiving events (not returning 403 due to secret mismatch)

### Login Flow

- [ ] Practice owner login works
- [ ] Session cookie is set with `httpOnly`, `secure`, `sameSite`
- [ ] Token expiry still enforces re-login

### Queue Engine

- [ ] Queue engine tick is running: check logs for `[deskQueueEngine]` entries appearing every ~60 seconds
- [ ] No `tick error` entries in the last 5 minutes post-deploy

---

## Rollback Triggers

Rollback immediately if any of the following are observed within 30 minutes of deploy:

- `/api/health/ready` returns 503 (DB down)
- Vapi webhooks returning 403 (secret mismatch)
- Login returning 500
- Any `callAttempt` write failing in logs
- `phi_access_log` writes failing

Rollback process: revert Railway to the previous deployment via Railway dashboard. Database rollback is only needed if a migration was applied — restore from last backup to staging, test, then apply fix forward.

---

## Report Format

```
## Release Readiness — v[VERSION] — [DATE]

### Pre-Deploy: PASS / FAIL
- Tests: [pass/fail]
- Lint/typecheck: [pass/fail]
- Semgrep: [pass/fail]
- npm audit: [pass/fail]
- PHI review: [pass/fail / n/a]
- CHANGELOG: [updated / missing]
- Migrations: [n pending / all applied]
- Electron build: [signed / unsigned / n/a]

### Post-Deploy: HEALTHY / DEGRADED
- /api/health: [200 / error]
- /api/health/ready: [200 / 503]
- WebSocket: [connects / fails]
- Vapi webhook: [200 / error]
- Queue engine: [ticking / silent]

### Go / No-Go: GO / NO-GO
```

---

## How to Run This Agent

```
"Run the CollectRx release readiness check for v[VERSION]. Run npm test, npm run lint, and tsc --noEmit in Collect-RX-main. Check CHANGELOG.md for the new entry. If this is a post-deploy run, hit the health endpoints and WebSocket. Work through agents/release-readiness.md and produce the GO/NO-GO report."
```
