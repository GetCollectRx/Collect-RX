# CollectRx Repository Health Check and Deployment Roadmap

Generated: 2026-07-01
Scope: `collectrx-platform` monorepo, canonical app `Collect-RX-main`.

## How this was produced

This roadmap is based on a mix of live command execution and static code inspection. Both are labeled below so the confidence level of each finding is clear.

Verified by execution this session:
- Architecture and script mapping (package.json, CLAUDE.md, README.md, .env.example).
- `npm ci` inside `Collect-RX-main` fails with a lockfile/package.json mismatch (real, reproducible).
- Root-level `package-lock.json` was cross-checked against `Collect-RX-main/package.json` and is in sync, so the documented CI path (`npm ci` at repo root) is not affected by the above.
- Current source confirms two specific findings from the May 29 security audit are still open (CSP disabled, reset tokens stored in plaintext).
- Existing on-disk Playwright artifacts (`Collect-RX-main/test-results/.last-run.json`, last run June 28) show the E2E suite failing, with saved error context explaining why.

Not completed this session, and why: a full `npm install` plus `tsc --noEmit`, `eslint`, and `vitest run` could not be run to completion in this sandbox. The project folder is mounted into this environment over FUSE, and both a from-scratch `npm install` and a whole-program `tsc --noEmit` (394 TypeScript files, strict mode) consistently needed more wall-clock time and file-I/O than this session's execution environment allows per command, independent of the codebase itself. This is a constraint of this chat session, not a defect in the repo. Practically, this means: I did not personally reproduce a clean `typecheck` / `lint` / `test` / `build` pass this session. Please run `npm run ci:collectrx` from the repo root on your own machine (or check the last GitHub Actions run for `main`) to get an authoritative pass/fail, and treat that as the source of truth alongside the specific, executed findings below.

---

## Blockers (prevent a clean build or CI run)

### B1. ~~`Collect-RX-main/package-lock.json` is stale and committed to git~~ **Fixed (2026-07-09)**
- Removed nested lockfile; installs use repo root `package-lock.json` only (documented in README).

### B2. E2E / seed mismatch — **Fixed (2026-07-09)**
- `db:seed` now creates a `User` (`SEED_USER_EMAIL`, default `owner@tenthline.local`).
- Playwright uses email/password login; `globalSetup` wired in `playwright.config.ts`.
- Replaced obsolete `canadian-2026.spec.ts` with `pre-visit.spec.ts` (`/pre-visit` route).

### B2 (original notes, for history)
- **Finding:** `Collect-RX-main/test-results/.last-run.json` (June 28) shows `"status": "failed"` for two Playwright specs: `login-dashboard.spec.ts > sees dashboard after sign-in` and `canadian-2026.spec.ts > canadian-2026 page renders Phase 2 modules`. Tracing this back further than the saved error context: login moved from a practice-ID field to email plus password against a separate `User` model a while ago (the May 29 security audit references this as "practice-ID→email login migration"), and `prisma/schema.prisma` documents `Practice.passwordHash` as "Legacy... kept for migration tooling only. Login now uses User.passwordHash." But `src/server/seed.ts` (`npm run db:seed`) only ever creates a `Practice`, never a `User`, and `e2e/globalSetup.ts` auto-seeded the same legacy-only `Practice`. Result: a fresh `db:seed` produces a practice that cannot actually log in through the current `/login` form at all, on top of the tests themselves still targeting `/` (now the marketing homepage), the old `Practice ID` field label, and a `Dashboard` heading that does not exist in `Dashboard.tsx`. Only `scripts/seed-demo.ts` (`npm run demo:seed`) creates a real `User` (`demo@hasanfamilydental.ca` / `CollectRx2026!`).
- **Why it matters:** This is exactly the "is the critical user flow actually wired" check this exercise asked for, and the honest answer is: the documented one-command dev setup (`db:seed` alone) leaves you with no way to sign in. That is a real gap for anyone spinning up a fresh environment, not just a test-maintenance issue.
- **Action taken this session:** Edited `e2e/login-dashboard.spec.ts`, `e2e/canadian-2026.spec.ts`, and `e2e/globalSetup.ts` to use email plus password login, navigate to `/login`, assert on URL change to `/dashboard` instead of a heading that doesn't exist, and have `globalSetup.ts` create a matching `User` (not just a `Practice`) when auto-seeding. **This was not run in this session** (sandbox cannot execute Playwright here, see note at top) so it is a best-effort fix based on source reading, not a confirmed green run.
- **New risk introduced by the fix, please note:** `globalSetup.ts`'s auto-seed path looks up "the first Practice in the DB" and will create a new `User` with a known test password on it if no `E2E_PRACTICE_EMAIL` is set. Only run `npm run e2e` against a database you are certain is local/disposable, never against the Railway or Fly.io database, for this reason as well as the reasons in D1 below.
- **Definition of done:** `npm run e2e` run locally against a disposable database, both specs pass, and either `db:seed` is updated to also create a matching `User` (so the documented single-command setup actually allows login) or the README/CLAUDE.md is corrected to state that `demo:seed` is required before anyone can sign in.

---

## Critical Gaps (features that look built but are not confirmed working, or contain placeholder logic)

### C1. Quebec eligibility increment is a documented placeholder
- **Finding:** `src/server/services/carrierRules.ts:94`, the Quebec fee-guide row has `incrementPct: 3.0, // placeholder — confirm with OAQ`, with a note "Verify final increment when published." This value feeds pre-treatment cost estimates for any Quebec practice.
- **Definition of done:** Replace the placeholder with the confirmed 2026 OAQ fee-guide increment (with a citation/date in the `notes` field), and add a test case in `tests/eligibility.test.ts` for a Quebec claim that would catch a future silent change to this constant.

### C2. Manual password-reset relay endpoint bypasses email delivery
- **Finding:** `src/server/routes/authRoutes.ts` has `GET /api/auth/reset-password/token/:userId` (platform_dev only), documented in-code as "used by admin to relay the token to the user until email delivery is wired up." The normal path does call `sendPasswordResetEmail` via SendGrid, and a `SENDGRID_API_KEY` is present in this environment's `.env`, but end-to-end delivery was not exercised in this session.
- **Definition of done:** Either confirm (with a real send, not just a code read) that SendGrid delivery works in production and remove or hard-gate the manual relay endpoint, or keep it deliberately as a documented break-glass path with its own audit log entry. One of these two outcomes should be a conscious decision, not left as "temporary."

### C3. A duplicate, superseded Vapi webhook handler still exists in the codebase
- **Finding:** `src/server/vapi/vapiWebhook.ts:384` has `handleVapiWebhook`, marked `@deprecated ... SUPERSEDED — never mounted, never called`, using a weaker shared-secret auth check than the live handler in `src/webhooks/vapi.ts`. It is not currently wired into any route.
- **Definition of done:** Delete the function once a repo-wide search confirms zero references (including tests), per the comment's own instruction. Low risk today only because nothing calls it; the risk is a future refactor accidentally mounting the weaker path.

---

## Polish / Documentation

### P1. Product framing docs are stale relative to the actual product
- **Finding:** `docs/product/MVP-SCOPE.md` (dated to Phase 1, April) still frames CollectRx as a generic "rules-based A/R workflow" tool. `CLAUDE.md` and the current codebase describe a much more specific, further-along product: AI voice agents (a 4-agent Vapi squad) calling six named Canadian carriers, with a defined eligibility/adjudication engine and CARRIER_BLOCK safety protocol. A new contributor or stakeholder reading `docs/product/MVP-SCOPE.md` first would get a materially outdated picture.
- **Definition of done:** Refresh `docs/product/MVP-SCOPE.md` (or explicitly mark it historical and point to `CLAUDE.md` as current) so there is one accurate description of what the product does today.

### P2. `OUTSTANDING-FIXES-PRODUCT-READY.md` status markers are dated April 22 to 24
- **Finding:** The document's own phase-status lines are timestamped several weeks before the most recent commits in this repo. Some items it lists as open may already be done; some done items may have regressed (E2E, for instance).
- **Definition of done:** A pass through this document to re-date or re-verify each phase's status line against current `main`, so it stays a trustworthy single backlog rather than a second, drifting source of truth alongside this file.

### P3. Six `@ts-ignore` / `@ts-expect-error` suppressions in `src`
- **Finding:** Confirmed by grep; not reviewed line-by-line this session.
- **Definition of done:** Each one either resolved (types fixed so the suppression is removable) or given an inline comment explaining why it is permanent, so silent type gaps do not accumulate unreviewed.

---

## Deployment Readiness

### D1. `DATABASE_URL` in the local `.env` still points at a Railway host, but the app has moved to Fly.io
- **Finding:** `Collect-RX-main/.env` (already present in this environment, not created by me) has `DATABASE_URL=postgresql://...@switchyard.proxy.rlwy.net:57765/railway?sslmode=require`. Khalid confirmed the app was moved to Fly.io; there is also a `migrate-to-fly.sh` in the Dentist folder root that migrates data to a new Fly Postgres cluster in `yyz` (Toronto, for PHIPA data residency).
- **Open question, not resolved this session:** whether this Railway database is now fully decommissioned, kept temporarily as a rollback/backup, or still the live database while Fly.io only runs the app tier. I could not verify which from the repo alone. Until confirmed, treat this `.env` value as unverified: it may be a stale, still-live credential to a database that's supposed to be retired.
- **Why it matters:** `npm test` runs integration tests that connect to whatever `DATABASE_URL` is reachable (`tests/app.integration.test.ts` only skips DB-dependent cases when the database is unreachable), and the new `e2e/globalSetup.ts` auto-seed (see B2) will create a `User` on whatever practice it finds first. **I deliberately did not run `npm test`, `db:seed`, `e2e`, or any migration command against this environment for this reason.**
- **Definition of done:** Confirm the current status of the Railway database (decommissioned, rotate/revoke its credentials if so) and update `Collect-RX-main/.env` to point at the correct current database (Fly Postgres, or a disposable local one for dev). `.env.example` already says to rotate `DATABASE_URL` immediately if ever exposed; a stale but still-valid production credential sitting in a working `.env` is worth closing out even if it's no longer the primary database.

### D2. Content-Security-Policy is still disabled
- **Finding:** `src/server/index.ts:176` has `contentSecurityPolicy: false`. This was flagged as the top hardening recommendation in the May 29 security audit and is confirmed still in place today.
- **Definition of done:** CSP enabled behind a flag, starting with `default-src 'self'` plus explicit allowances for Stripe (`js.stripe.com`, `api.stripe.com`) and the API origin, verified against the live app with no console CSP violations on the main authenticated flows.

### D3. Password-reset tokens are stored in plaintext
- **Finding:** `authRoutes.ts` generates `randomBytes(32).toString('hex')` and stores it directly via `prisma.passwordResetToken.create({ data: { userId, token, expiresAt } })`, no hashing. Flagged as low-risk-but-cheap-to-fix in the May 29 audit; still open.
- **Definition of done:** Store a SHA-256 hash of the token, look up by hash, keep the 1-hour expiry and single-use semantics already in place.

### D4. Several production integrations are unconfigured in this environment — confirmed a real gap, not intentional
- **Finding:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`FROM_NUMBER`, `GEMINI_API_KEY`, `PHI_ENCRYPTION_KEY`, `SENTRY_DSN`, `HEALTH_METRICS_TOKEN`, and all `CLICKHOUSE_*` vars are absent from `Collect-RX-main/.env`, though listed and documented in `.env.example`. Khalid confirmed this is an oversight, not a deliberate pre-launch deferral.
- **Why it matters:** As configured today, Stripe billing/payments, Twilio front-desk takeover, PHI-at-rest encryption at the application layer, Sentry error monitoring, and product telemetry are all inactive.
- **Suggested priority order (highest risk first):** `PHI_ENCRYPTION_KEY` (PHI at rest, directly compliance-relevant) and `SENTRY_DSN` (you have no error visibility into production right now) first; `STRIPE_*` and `TWILIO_*` next, gated on whether those flows are live for real practices yet; `CLICKHOUSE_*` last (telemetry only, no functional impact if deferred).
- **Definition of done:** Each variable set with a real value in the production environment (Railway or Fly, whichever is now authoritative per D1) and confirmed working: a real Sentry event appears after a forced error, a real Stripe test-mode charge completes, a PHI field round-trips through encryption, ClickHouse receives a real event.

### D5. `npm audit fix` and vendor BAAs from the May 29 audit
- **Finding:** The audit recommended `npm audit fix` for a moderate `qs`/`express` DoS advisory, and confirmation of signed BAA/DPA-equivalent agreements with Vapi, Twilio, SendGrid, Stripe, and any LLM provider before they process PHI. Neither was verified as complete this session (the first requires a clean install I could not run here; the second is a business/legal task outside the codebase).
- **Definition of done:** `npm audit` run clean (or remaining advisories explicitly accepted with reasons) and BAAs confirmed signed and filed, not just referenced.

---

## What is already solid (for balance)

The May 29 security audit found no critical or high-severity issues, and this session's spot checks (CORS allowlist, authorization/IDOR pattern, webhook signature verification, PHI tokenization boundary, no hardcoded secrets, no empty catch blocks, no raw SQL string concatenation) did not surface anything contradicting that. The gaps above are real but are refinements on a codebase with an already-serious security posture, not signs of a fundamentally unsound system.
