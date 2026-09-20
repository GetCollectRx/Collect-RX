# Pre-launch security status (Collect-RX-main)

Last updated: 2026-07-05 — full re-verification against current multi-tenant, Fly.io-hosted code (previous version predated both and was stale). Three items found in that pass (1.5, 2.1's `agentRunsRouter.ts` gap, and the 5.x dependency findings) were fixed same-day — see notes below.
Run locally: `npm run check:env` (with `NODE_ENV=production` for prod rules), `npm audit --omit=dev`, `npm test`.

| # | Item | Status | Notes |
|---|------|--------|--------|
| **1 — Secrets & environment** |
| 1.1 | No API keys in Vite bundle | **Pass** | Only `VITE_API_ORIGIN`, `VITE_SENTRY_*`, `VITE_DEV_ALLOW_REMOTE_API` — no Stripe/Vapi/JWT/DB |
| 1.2 | `.env` gitignored | **Pass** | Root + `Collect-RX-main/.gitignore` |
| 1.3 | Login JWT not in JSON body | **Pass** | HttpOnly `crx_access` cookie (`httpOnly`, `secure` in prod, `sameSite`) — see `authToken.ts` `cookieOptions()`. One adjacent manual stopgap: `GET /api/auth/reset-password/token/:userId` returns a password-reset token in JSON, but it's `platform_dev`-only and explicitly documented as a temporary relay until email delivery is wired up |
| 1.4 | Admin integrations API | **Pass** | `integrationPayload()` returns booleans only; route is behind `authenticate` + `requirePracticeContext` |
| 1.5 | `npm run check:env` production vars | **Fixed (2026-07-05)** | Script didn't know about the Fly `.flycast`/`.internal` private-network TLS exemption in the real runtime guard (`databaseTls.ts` `isFlyPrivateNetworkHost`). Added a matching `isFlyPrivateNetworkHost()` to `scripts/check-deploy-env.mjs` so it no longer false-fails `DATABASE_URL (TLS)` against the real production connection string |
| **2 — Authentication & authorization** |
| 2.1 | `authenticate` on practice APIs | **Fixed (2026-07-05)** | All `src/routes/*.ts` + `src/server/routes/*.ts` route files use `authenticate` or `useOwnerPracticeApi(AuthOnly)`, except intentional webhook cases (see 2.6). `server/routes/agentRunsRouter.ts`'s `requireAgentSecret` middleware used to **fail open** (`if (!secret) return next();`) — if `AGENT_RUNTIME_SECRET` wasn't set in production, `/api/agent-runs/*` (including `/digest`, which surfaces CRITICAL/HIGH agent findings) was fully unauthenticated. Now fails closed in production (401 if the secret is unset), matching the pattern already used by `vapiWebhook.ts`/`demoBookingWebhookRouter.ts`. **Still required**: set `AGENT_RUNTIME_SECRET` in Fly production secrets, or this endpoint will 401 everything |
| 2.2 | Session `practiceId` (not body alone) | **Pass** | `practiceIdFromSession` + `queryPracticeConflictsSession` pattern confirmed across `frontDeskApi.ts`, `practiceReportsApi.ts`, `workQueue.ts`, `platformPersonaAdminApi.ts` |
| 2.3 | IDOR static audit test | **Pass** | `tests/idorPracticeScope.audit.test.ts` covers practice-scoped routers (`preVisitRoutes`, `pmsApiRoutes`, `connectorAdminRoutes`, `frontDeskApi`, `practiceReportsApi`, `productTelemetry`) plus platform role-gated routers (`platformPersonaAdminApi`, `groupAdminRoutes`, `complianceRoutes`, `partnershipsRouter`) |
| 2.4 | Platform admin role | **Updated — was incorrectly marked N/A** | This is no longer a single-practice JWT system. `platform_admin`/`platform_dev` roles exist via `requirePlatformAdmin` middleware; cross-practice access is grant-gated (`assertPlatformAdminClaimGrant`, `assertAuditorPracticeGrant` in `grantChecks.ts`) except for `platform_dev`, which bypasses grants by design. `/api/admin/practices*` (list/get/update settings) requires `platform_admin`/`platform_dev` |
| 2.5 | Canadian expansion routes auth | **Pass** | `canadianExpansionApi.ts` uses `useOwnerPracticeApiAuthOnly` |
| 2.6 | Webhook HMAC / signatures | **Mostly pass, one accepted-risk gap, one item now N/A** | Vapi: fails closed in prod (`verifyVapiAuth`). Stripe: `stripe-signature` header verified. SendGrid event webhook: `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` required in prod. **Twilio inbound SMS webhook no longer exists** — `/api/twilio/sms` was intentionally removed in the practice→insurance product pivot (see `index.ts`'s "Removed" route-map comment), so this line item is N/A, not a gap. **New accepted-risk item**: `sendgridInboundRouter.ts` (SendGrid *Inbound Parse*, for marketing reply intelligence) has no signature verification at all — this is a known vendor limitation (Inbound Parse doesn't support HMAC the way Event Webhooks do), not a code bug. Blast radius is marketing/prospect data only, not patient PHI, but an attacker who finds the URL could inject fake "replies." Consider a secret path segment or IP allowlist if this becomes a concern |
| **3 — Database & API** |
| 3.1 | Prisma parameterized queries | **Pass** | No `$queryRawUnsafe`/`$executeRawUnsafe` anywhere in `src/`. (The dead legacy `db.cjs` raw-SQL backend that used to be the only real risk here was deleted 2026-07-05) |
| 3.2 | Postgres RLS | **Pass (defense-in-depth)** | Migration `20260712000000_rls_and_phi_vault_practice` deployed; Prisma sets `app.practice_id` / `app.rls_bypass` per request. Disable with `COLLECTRX_RLS_ENABLED=0` only for emergency ops |
| 3.3 | Rate limits | **Pass** | `standardLimiter` was split into `sessionStandardLimiter` (600/min signed-in) + `anonStandardLimiter` (120/min anon), both mounted on `/api`; `webhookLimiter`, `healthLimiter`, `telemetryEventsLimiter`, and `authLimiter` (in `authRoutes.ts`) all confirmed present |
| 3.4 | Prod API error messages | **Pass** | `apiErrorMessageForResponse` used across 17 route/service files |
| 3.5 | Health metrics fingerprint | **Pass** | Redacted in prod without `HEALTH_METRICS_TOKEN`; `tests/healthMetricsExposure.test.ts` passing |
| 3.6 | EMR webhook SSRF policy | **Pass** | `emrWebhookUrl.ts` + `tests/emrWebhookUrl.test.ts` passing |
| **4 — Input validation & frontend** |
| 4.1 | Zod on login / carrier unblock / PMS JSON | **Pass** | `validation/zodSchemas.ts` still in place |
| 4.2 | CSV upload MIME + extension | **Pass** | `validation/csvUpload.ts` + `tests/csvUpload.test.ts` passing |
| 4.3 | Public pay token format | **N/A — feature removed** | `publicPatientPayRoutes.ts` and the entire `/api/public/*` patient-facing pay-link surface no longer exist (removed in the practice→insurance product pivot). Remove this line item rather than "Pass" |
| 4.4 | XSS (`dangerouslySetInnerHTML`) | **Pass** | None in `src/` |
| 4.5 | Canadian validators (gap/writeback) | **Pass** | `canadianExpansion/validators.ts` present |
| **5 — Dependencies** |
| 5.1 | `nodemailer` | **Fixed (2026-07-05)** | Bumped `^8.0.7` → `^9.0.3`, past all 3 advisories (CRLF header injection, two SSRF/arbitrary-file-read bypasses of `disableFileAccess`/`disableUrlAccess`). Major-version bump, but this codebase's two call sites (`agentEscalationService.ts`, `alerts.ts`) only use standard `createTransport`/`sendMail({from,to,subject,text/html})` — never the vulnerable `raw` message option — so exploitability was already low; patched anyway. Full test suite (846 tests) still green after the bump |
| 5.2 | `multer` | **Fixed (2026-07-05)** | `npm audit fix` resolved it to `2.2.0`, clearing both DoS advisories, within the existing `^2.1.1` semver range |
| 5.3 | `form-data` | **Fixed (2026-07-05)** | Resolved to `4.0.6` (via `axios`), clearing the CRLF injection advisory |
| 5.4 | `react-router-dom` | **Fixed (2026-07-05)** | Resolved to `6.30.4`, clearing the open-redirect advisory |
| 5.5 | `js-yaml` | **Not a production risk** | Flagged by `npm audit` but only reachable via `electron-builder`, which is correctly a `devDependency` — not shipped to the running server |
| 5.6 | `esbuild` (new, low) | **Accepted risk** | 1 low-severity advisory remains, via `tsx`'s transitive `esbuild` — describes arbitrary file read when running esbuild's **dev server on Windows**. `tsx` is a production dependency (it's how `npm start` runs), but production runs on Fly (Linux containers) executing a fixed script, not esbuild's dev server — this specific attack vector doesn't apply here. Revisit if `tsx`/esbuild usage changes |
| 5.7 | Hallucinated packages | **Pass** (spot check, unchanged) | Mainstream deps |
| 5.8 | `npm test` | **Pass** | 846 passed, 7 skipped (DB-dependent tests skip without a reachable Postgres), 0 failed — re-confirmed after the `agentRunsRouter.ts`, `check-deploy-env.mjs`, and `nodemailer` changes on 2026-07-05 |

## Manual before go-live

1. Set Fly.io production secrets: `JWT_SECRET`, `VAPI_WEBHOOK_SECRET`, `AGENT_RUNTIME_SECRET` (see 2.1 — **now required**, the endpoint 401s everything without it rather than failing open), `STRIPE_*`, `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`, `DATABASE_URL` (Fly-internal, TLS exemption applies), `PHI_ENCRYPTION_KEY` if at-rest encryption on, `HEALTH_METRICS_TOKEN`, `ALLOWED_ORIGINS`.
2. Never commit or share `Collect-RX-main/.env`.
3. Run `NODE_ENV=production npm run check:env` against the production variable set — the Fly TLS exemption gap (1.5) is fixed, so this should no longer false-fail on `DATABASE_URL`.
4. ~~Add the missing routers to `tests/idorPracticeScope.audit.test.ts`'s `AUTH_ROUTE_FILES` (2.3)~~ — done in `d6c6d5d` (2026-07-18); all routers listed in 2.3 are present in `AUTH_ROUTE_FILES` / `PLATFORM_ROLE_GATED_ROUTE_FILES`.
