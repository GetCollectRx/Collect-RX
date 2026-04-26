# Phase 7 — Quality assurance & load (engineering)

This document ties **P7-01…P7-08** in [OUTSTANDING-FIXES-PRODUCT-READY.md](../../OUTSTANDING-FIXES-PRODUCT-READY.md) to commands and files in the repo.

## Automated tests (Collect-RX-main)

| Item | What | Command / location |
|------|------|--------------------|
| **P7-01** | E2E: login → dashboard (Playwright) | `npm run e2e -w dental-ar-system` (see below) |
| **P7-02** | Stripe webhook with mock HMAC (no CLI in CI) | `tests/app.integration.test.ts` (Stripe `generateTestHeaderString`) |
| **P7-03** | API integration (health, auth, session) | Same file + `vitest run` |
| **P7-04** | Reproducible fixtures | `db:seed` (CI) + `tests/factories/practice.ts` for factory-created practices |

### Unit + integration (Vitest)

```bash
npm run test -w dental-ar-system
```

Requires a reachable PostgreSQL and `DATABASE_URL` (e.g. local `docker-compose` or CI). `JWT_SECRET` must be set (see `.env.example`).

### E2E (Playwright)

1. `npm run db:migrate -w dental-ar-system && npm run db:seed -w dental-ar-system`
2. `export E2E_PRACTICE_ID=$(npm run e2e:print-id -w dental-ar-system --silent)`  
   (or copy the practice ID from the seed log)
3. `npm run build -w dental-ar-system`
4. In one terminal: `PORT=3000 npm run start -w dental-ar-system`  
5. In another: `E2E_PRACTICE_ID=... npm run e2e -w dental-ar-system`

**CI** runs the same flow: migrate → seed → set `E2E_PRACTICE_ID` from `e2e:print-id` → build → `playwright install` → `e2e:ci` with `webServer` starting the API+static server on port 3000.

Default password for seeded data is `changeme` unless `SEED_PRACTICE_PASSWORD` is set (see `src/server/seed.ts`). Override in E2E with `E2E_PRACTICE_PASSWORD`.

## Load — P7-05 (k6, read-heavy)

**Prerequisite:** k6 [installed](https://k6.io/docs/getting-started/installation/) on your machine; app running and reachable (staging or local with auth if you protect routes).

The sample script hits **liveness** and **readiness** (DB touch). For authenticated read-heavy paths, add a k6 `setup` that obtains a session or use a dedicated load-test key as a follow-up.

```bash
# From repo root, with API at BASE (default http://127.0.0.1:3000)
k6 run Collect-RX-main/perf/k6-read-heavy.js
```

**Thresholds (example):** p95 latency and error rate are defined in the script. Tune `vus` / `duration` to your SLO. Cross-check process metrics from **P6** via `GET /api/health/metrics` (see [PHASE6-OPS.md](PHASE6-OPS.md)) while a run is in progress.

## Webhook burst — P7-06 (operational)

Voice (e.g. Vapi) and SMS (Twilio) webhooks are **synchronous** HTTP requests to the Node process. For burst handling:

- **Scale horizontally** behind a load balancer only after idempotency and **single-writer** semantics are proven for each path (Vapi: body-hash idempotency; Twilio: your dedupe if any).
- **Document** a safe replay/queue path if the vendor retries or if you add a queue later (align with P6-07 in PHASE6-OPS).
- **Capacity:** derive target RPS from expected peak (appointments, campaign size) and run a focused load test (or vendor sandbox replay) on `/api/vapi/webhook` and `/api/twilio/sms` with 429/503 budgets and P6 metrics dashboards.

## Accessibility — P7-07 (WCAG 2.1 A, critical paths)

- **ESLint:** `eslint-plugin-jsx-a11y` (recommended rules) in `Collect-RX-main/eslint.config.js`.
- **Code:** Login `main` landmark; public pay uses a real **link** to Stripe; balances table has a screen-reader **caption** (`sr-only`).
- **Ongoing:** spot-check with keyboard + VoiceOver / NVDA on login, Insurance AR, and public pay when UI changes.

## i18n — P7-08

Product decision: **[I18N-DECISION.md](../product/I18N-DECISION.md)** — **English only for v1**; i18n framework is optional when a second locale is in scope.
