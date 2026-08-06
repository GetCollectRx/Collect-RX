# Path to delivery — CollectRx (Practice → Insurance)

**Canonical launch checklist.** Product boundary: insurance AR recovery + practice SaaS Billing only.  
**Out of scope:** patient/client payment collection (Stripe Connect, Payment Links, patient reminder outbox).

Work is grouped A→G. Complete in order. Engineering can finish A–C in-repo; D–G need operator/legal/host execution (checkboxes below).

| Group | Owner | Status |
|-------|--------|--------|
| **A** Docs & checklist hygiene | Eng | **Complete** (this file + scrub) |
| **B** Code / CI quality gates | Eng | **Complete** (`npm test` + pay-route regression; e2e in CI) |
| **C** Staging operator pack | Eng prepares / Ops executes | **Pack ready** — [STAGING-SMOKE.md](STAGING-SMOKE.md); you run against host |
| **D** Live integrations | Ops | **Checklist ready** — [PHASE4-GO-LIVE.md](PHASE4-GO-LIVE.md) |
| **E** Compliance & legal | Legal + Ops | **Tracker ready** — [COMPLIANCE-LAUNCH-TRACKER.md](../compliance/COMPLIANCE-LAUNCH-TRACKER.md) |
| **F** Ops hardening | Ops | **Checklist ready** — [OPS-HARDENING-CHECKLIST.md](OPS-HARDENING-CHECKLIST.md) |
| **G** Pilot cutover | Ops + Eng | **Runbook ready** — [PILOT-CUTOVER.md](PILOT-CUTOVER.md) |

Related: [OUTSTANDING-FIXES-PRODUCT-READY.md](../../OUTSTANDING-FIXES-PRODUCT-READY.md), [MVP-SCOPE.md](../product/MVP-SCOPE.md), [ENVIRONMENT-MATRIX.md](../ENVIRONMENT-MATRIX.md), [HUMAN-DECISIONS-PENDING.md](HUMAN-DECISIONS-PENDING.md) (TELUS call timing, PHIPA deletion/breach scope, production RLS role verification — decision-ready options, not code work).

---

## A — Docs & checklist hygiene

- [x] This path-to-delivery doc exists
- [x] Phase 4 go-live = Stripe **Billing** only (no Connect)
- [x] PCI / PHI docs = practice subscription only
- [x] No launch checklist still asks for patient pay / Connect (`CLIENT-READINESS`, Phase 4, PCI, PHI docs scrubbed)

---

## B — Code / CI quality gates

- [x] `npm test` green in Collect-RX-main (1054 passed locally; DB suites skip without Postgres — CI has Postgres)
- [x] Playwright login → dashboard e2e exists (`e2e/login-dashboard.spec.ts`); runs in CI with migrate/seed
- [x] Stripe webhook tests cover **practice Billing** only (`app.integration.test.ts` + retired pay-route regression)
- [x] CARRIER_BLOCK / PHI boundary covered (`workflowPhiVapiBoundary`, `workflowDispatchSafetyRules`, carrier-block suites)
- [x] Minute/licensing enforcement covered (2026-07-17): `planGateFailClosed` (SUBSCRIPTION_ENFORCE fail-closed, tier caps), `billingSafetyMatrix` (plan pause × CARRIER_BLOCK), `billingCatalog` (core/growth/scale catalog + legacy aliases + 45-min ceiling + trial defaults), `dailySpendAlert`

---

## Billing lifecycle (signup → trial → paid → limits)

1. **Signup** (`POST /api/auth/register`) → practice created with `billingTier='trial'`, `trialEndsAt = +30 days`. Trial: 500 min/month, 50 min/day, hard stop, no card.
2. **Trial limits** — `canMakeCall()` blocks at 500 monthly or 50 daily minutes (`TRIAL_LIMIT_REACHED` / `DAILY_CAP_REACHED`) and when `trialEndsAt` passes. No overage on trial.
3. **Upgrade** — owner picks Core/Growth/Scale on `/billing` → Stripe Checkout → `checkout.session.completed` webhook sets `billingTier` from the price ID (unmapped price = tier unchanged, logged — fail closed). `invoice.paid` starts each new `UsagePeriod` and clears pauses/overage flags.
4. **Paid limits** — included minutes (1,200 / 2,800 / 4,000) soft-stop into `callsPaused='overage_pending'`; owner confirm (24 h window, then auto-decline) resumes at $0.25/min ($0.20 Scale). Daily caps 100 / 300 / none. Every call carries a 45-min Vapi `maxDurationSeconds` ceiling plus a queue-tick terminator. COGS breaker throttles at 40% and pauses at 60% of price. Daily spend alert at 30% of monthly in one day.
5. **Payment failure / cancel** — `past_due`/`unpaid` pauses (`payment_failed`); cancel drops the practice to trial tier with calls paused (`subscription_cancelled`).

---

## C — Staging operator pack

**Eng prepared:** [STAGING-SMOKE.md](STAGING-SMOKE.md) + `npm run smoke:staging` (`scripts/staging-smoke.sh`).

**You execute on staging host:**

- [x] Staging Postgres + `prisma migrate deploy` (incl. CSV-AR) — `collect-rx-staging` / `collect-rx-staging-db` (2026-07-16)
- [x] Seed / demo seed; login works — practice seeded (`staging-owner@collectrx.test`; password in `Collect-RX-main/.staging-seed-credentials`)
- [x] `STAGING_API_BASE=https://collect-rx-staging.fly.dev npm run smoke:staging` — **PASSED**
- [x] Browser/product path: login → claims → Admin Integrations → `/billing` — automated via `npm run smoke:staging:product` + Playwright against staging (2026-07-16)
- [x] Redis + worker — `collect-rx-staging-kv` (IPv6-bound Redis) + `REDIS_URL` + worker process on `collectrx-ar` (2026-07-16)
- [x] CSV-AR RLS verified on Postgres before prod enable — staging DB via `fly proxy` → `collect-rx-staging-db` (`collectrx_stg_app` / `collect_rx_staging`): `tests/rls.test.ts` + `tests/csv-ar-expansion.test.ts` → **42 passed / 3 skipped** (2026-07-16)

---

## D — Live integrations (staging then prod)

**Eng prepared:** [PHASE4-GO-LIVE.md](PHASE4-GO-LIVE.md) (Billing only; no Connect).

Execute on staging, then prod:

- [x] P4-01 SendGrid — **staging env:** `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL` on `collect-rx-staging` (2026-07-16). Still open: Event Webhook → staging `/api/webhooks/sendgrid` + `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`; SPF/DKIM/DMARC on from-domain.
- [x] P4-02 Email compliance (env) — staging `EMAIL_UNSUBSCRIBE_SECRET` + `PUBLIC_API_BASE_URL` set. Counsel CASL/TCPA sign-off still open.
- [ ] P4-03 Twilio — no Twilio keys in local `.env` / staging yet (skip if SMS not in pilot).
- [x] P4-04 Stripe Billing (practice SaaS) — **staging-verified end-to-end (2026-07-17, test mode):** catalog = core/growth/scale from `tiers.ts` (CAD prices created; ids on Fly as `STRIPE_PRICE_*`); staging webhook endpoint live at `/api/stripe/webhook`; `SUBSCRIPTION_ENFORCE=1`. Verified on staging: fresh signup → trial 500/50/+30d → `/billing` Checkout URL (stale plan names 400) → subscription webhook set `billingTier=core` (1,200 min / 100 daily / $0.25) → at 1,200 min the gate returned `OVERAGE_PENDING` and paused calling → owner confirm-overage resumed (`allowed:true` at $0.25/min). **Live cutover still open:** activate Stripe live mode (business verification + bank account), swap live keys + live webhook secret on prod.
- [x] P4-05 Vapi — **staging env:** `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, phone/squad ids set. Still open: Vapi dashboard server URL → `https://collect-rx-staging.fly.dev/api/webhooks/vapi` + supervised test call.
- [x] P4-06 Secrets (staging baseline) — URLs, `NODE_ENV=production`, PHI vault key, JWT, Redis, SendGrid, Vapi on Fly. Rotate staging DB password if exposed during earlier attach. Stripe/Twilio still missing.
- [x] P4-07 PMS decision — CSV-first default (no AbelDent required for staging).
- [ ] P4-08 Degraded-provider awareness — Admin Integrations green for configured providers; watch provider status pages when live.

---

## E — Compliance & legal

**Eng prepared:** [COMPLIANCE-LAUNCH-TRACKER.md](../compliance/COMPLIANCE-LAUNCH-TRACKER.md).

- [ ] BAAs/DPAs tracked (host, SendGrid, Twilio, Stripe, Vapi)
- [ ] Terms / Privacy counsel-reviewed
- [ ] PIPEDA / breach contact owned
- [ ] Pen test scheduled **or** written pilot exception
- [ ] Encryption at rest confirmed on prod DB
- [ ] PHIPA deletion/breach workflow scope decided — see [HUMAN-DECISIONS-PENDING.md](HUMAN-DECISIONS-PENDING.md), item 2 (schema exists, zero implementation; needs legal/privacy sign-off before engineering builds it)
- [ ] Production Postgres role verified `NOSUPERUSER`/`NOBYPASSRLS` — see [HUMAN-DECISIONS-PENDING.md](HUMAN-DECISIONS-PENDING.md), item 3. **Standing runtime check shipped 2026-08-06** (`/api/health/ready` now fails loudly in production if the role is unsafe — see `OUTSTANDING-FIXES-PRODUCT-READY.md` P11-02), but the one-time manual verification against the actual production role is still open and still needs someone with Fly Postgres production credentials.

---

## F — Ops hardening

**Eng prepared:** [OPS-HARDENING-CHECKLIST.md](OPS-HARDENING-CHECKLIST.md) + [PHASE6-OPS.md](PHASE6-OPS.md).

- [ ] Sentry DSNs + alerts — **code-level blocker fixed 2026-08-06** (see `OUTSTANDING-FIXES-PRODUCT-READY.md` P11-01): server-side Sentry was fully implemented but never called from `index.ts`/`workerEntry.ts`, only the frontend was wired up. Now called from both Node entry points; still needs an operator to create the Sentry project and set `SENTRY_DSN` on Fly.
- [ ] Uptime on `/api/health/ready` — **verified correct in-repo**: real DB ping (`SELECT 1`), returns 503 on failure. No code gap; just needs an operator-side uptime monitor pointed at it.
- [ ] Backups + tested restore + RPO/RTO
- [ ] Deploy/rollback practiced
- [ ] On-call **or** “no 24/7” in Terms

---

## G — Pilot cutover

**Eng prepared:** [PILOT-CUTOVER.md](PILOT-CUTOVER.md).

- [ ] First practice CSV onboard
- [ ] Supervised call path (PHI tokens only)
- [ ] CARRIER_BLOCK drill
- [ ] Week-1 daily ops review

---

## Production declaration

Ready when **C–G** checkboxes that apply to your launch bar are complete, and no patient/client payment surfaces remain in app or runbooks.
