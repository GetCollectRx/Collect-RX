# Pre-launch security status (Collect-RX-main)

Last updated: automated pass after highest-value launch actions.  
Run locally: `npm run check:env` (with `NODE_ENV=production` for prod rules), `npm audit --omit=dev`, `npm test`.

| # | Item | Status | Notes |
|---|------|--------|--------|
| **1 — Secrets & environment** |
| 1.1 | No API keys in Vite/`NEXT_PUBLIC_` bundle | **Pass** | Only `VITE_API_ORIGIN`, `VITE_SENTRY_*` — no Stripe/Vapi/JWT/DB |
| 1.2 | `.env` gitignored | **Pass** | Root + `Collect-RX-main/.gitignore` |
| 1.3 | Login JWT not in JSON body | **Pass** | HttpOnly `crx_access` cookie only |
| 1.4 | Admin integrations API | **Pass** | Booleans only, not secret values |
| 1.5 | `npm run check:env` production vars | **Pass** (script) | JWT, Vapi, SendGrid, DB TLS, PHI key, EMR https, no `EMR_OUTBOX_DEV_ACK` in prod |
| **2 — Authentication & authorization** |
| 2.1 | `authenticate` on practice APIs | **Pass** | Insurance, admin, dashboard, CDCP, patient AR, etc. |
| 2.2 | Session `practiceId` (not body alone) | **Pass** | `practiceIdFromSession` + `queryPracticeConflictsSession` |
| 2.3 | IDOR static audit test | **Pass** | `tests/idorPracticeScope.audit.test.ts` |
| 2.4 | Platform super-admin role | **N/A** | Single practice JWT; `/api/admin` = practice staff |
| 2.5 | Canadian expansion routes auth | **Pass** | Router now uses `authenticate`; mounted at `/api` |
| 2.6 | Webhook HMAC / signatures | **Pass** | Vapi, Stripe, SendGrid (prod), Twilio |
| **3 — Database & API** |
| 3.1 | Prisma parameterized queries | **Pass** | No `$queryRawUnsafe` |
| 3.2 | Postgres RLS (Supabase-style) | **N/A** | App-level `practiceId` scoping |
| 3.3 | Rate limits | **Pass** | standard, auth, public, webhook, health |
| 3.4 | Prod API error messages | **Pass** | `apiErrorMessageForResponse` on internal routes |
| 3.5 | Health metrics fingerprint | **Pass** | Redacted in prod without `HEALTH_METRICS_TOKEN` |
| 3.6 | EMR webhook SSRF policy | **Pass** | `emrWebhookUrl.ts` + boot validation |
| **4 — Input validation & frontend** |
| 4.1 | Zod on login / carrier unblock / PMS JSON | **Pass** | `validation/zodSchemas.ts` |
| 4.2 | CSV upload MIME + extension | **Pass** | `validation/csvUpload.ts` on admin, PMS, fee-guide import |
| 4.3 | Public pay token format | **Pass** | 32-char hex; 503 when DB down |
| 4.4 | XSS (`dangerouslySetInnerHTML`) | **Pass** | None in `src` |
| 4.5 | Canadian validators (gap/writeback) | **Pass** | Existing `canadianExpansion/validators.ts` |
| **5 — Dependencies** |
| 5.1 | `nodemailer` CVE (high) | **Pass** | Bumped to `^7.0.11` in `package.json` — run `npm install` + `npm audit` |
| 5.2 | Hallucinated packages | **Pass** (spot check) | Mainstream deps; review `notebooklm-sdk` intentionally |
| 5.3 | `npm audit` clean | **Verify** | Run after `npm install` in your environment |

## Manual before go-live

1. Set Railway/production: `JWT_SECRET`, `VAPI_WEBHOOK_SECRET`, `STRIPE_*`, `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`, `DATABASE_URL` with `sslmode=require`, `PHI_ENCRYPTION_KEY` if at-rest encryption on, `HEALTH_METRICS_TOKEN`, `ALLOWED_ORIGINS`.
2. Never commit or share `Collect-RX-main/.env`.
3. Run `NODE_ENV=production npm run check:env` against production variable set.
