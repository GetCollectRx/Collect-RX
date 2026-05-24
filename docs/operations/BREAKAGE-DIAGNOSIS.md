# Breakage diagnosis — what broke and where to look

When something fails (local dev, after deploy, or in CI), use one command for a categorized report:

```bash
cd Collect-RX-main
npm run diagnose
```

## What it checks

| Step | Subsystem | Fails when |
|------|-----------|------------|
| 1 | **TypeScript** | Types don’t compile (`npm run typecheck`) |
| 2 | **Environment** | Required env vars missing for `NODE_ENV` (`npm run check:env`) |
| 3 | **Database** | `DATABASE_URL` set but schema/tables wrong (`npm run db:verify-tables`) |
| 4 | **Tests** | Any Vitest failure — lists first failing test in `test-results/failures.txt` |
| 5 | **Live API** (optional) | Running server doesn’t pass HTTP smoke |

## Live / staging smoke (server must be running)

```bash
npm run smoke:live
SMOKE_BASE_URL=https://your-staging-host npm run smoke:live
npm run diagnose -- --live
```

Checks: `/api/health`, `/api/health/ready`, `/api/health/metrics`, auth guard on `/api/insurance/claims`.

## Vitest subsystem names

Tests under `tests/smoke/breakage-map.smoke.test.ts` use describe names like `breakage map: database` so `npm test` output points at the area that broke. Deeper coverage lives in `tests/app.integration.test.ts`, `tests/canadianExpansion.test.ts`, etc.

## CI

GitHub Actions runs `npm test` on every push/PR to `main`. In CI, Vitest also writes `Collect-RX-main/test-results/junit.xml` for the Actions “Tests” tab when the workflow uploads that artifact.

## Quick manual curls (production)

See [PHASE6-OPS.md](./PHASE6-OPS.md#smoke-curl) for liveness/readiness curls after deploy.

## Alerts (notify on failure)

To **SMS / email / Slack** with impact and fix steps (not just console output):

```bash
OPS_ALERTS_ENABLED=1 npm run diagnose -- --alert
```

Full setup: [OPS-ALERTS.md](./OPS-ALERTS.md).
