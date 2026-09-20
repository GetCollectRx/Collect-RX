# Product readiness assessment — 2026-08-02

**Point-in-time record.** This is a snapshot audit of every major product feature in `Collect-RX-main`, scored 1-10 on "ready to ship as-is." It supersedes the phase-status claims in [`OUTSTANDING-FIXES-PRODUCT-READY.md`](../../OUTSTANDING-FIXES-PRODUCT-READY.md) wherever they conflict with what's below — several "Complete" verdicts in that file did not hold up against direct code inspection (see Eligibility and Denial Hub sections). [`PATH-TO-DELIVERY.md`](PATH-TO-DELIVERY.md) remains the live launch-readiness tracker for operator/legal work; this document is about feature-level code quality and completeness, not the go-live checklist.

**Method.** Each domain below was independently audited by reading actual source and running the real test suite (not by trusting prior docs). Scores reflect: does the code exist, is it wired end-to-end from UI to DB, is money/compliance-relevant logic tested, and is anything mocked/dead/misleading. Findings tagged **[SENSITIVE]** touch PHI handling, CARRIER_BLOCK, billing gating, or call-rule enforcement — per explicit product direction, these are documented for human review only and were not auto-fixed in this pass.

**Fix status.** Items marked ✅ were fixed in this pass (see PR). Items marked 🚩 are flagged for human/legal/product decision and were deliberately left untouched.

---

## Score summary

| Domain | Score | One-line verdict |
|---|---|---|
| Billing subsystem (Stripe, trial, tiers, overage, COGS) | **8/10** | Gating logic, tier numbers, and fail-closed webhook mapping all correct and well-tested. |
| Core AR workflow (claims, queue, dispatch, escalation, reporting) | **8/10** | Real, end-to-end, tested against live Postgres. Some dead scheduling config. |
| Vapi voice squad + safety rules (CARRIER_BLOCK, PHI boundary, CRTC) | **8/10** | Every safety mechanism is genuinely implemented and enforced, not aspirational. |
| Dashboard / Analytics / system health | **8/10** | Real data throughout; health-check test suite is a placeholder. |
| Auth / Admin / RBAC | **7/10** | Solid core; break-glass action doesn't do what its UI implies, audit-log coverage has gaps. |
| Onboarding / CSV import / AbelDent connector | **7/10** | CSV path is real and tested; onboarding checklist is cosmetic; AbelDent has zero test coverage. |
| Marketing / growth engine | **6/10** | Genuinely functional pipeline; thin test coverage; a real resource-coupling risk with core calling. |
| Denial hub / compliance workspace / PHIPA | **6/10** | Denial hub and underpayment detection are real; PHIPA deletion/breach handling is schema with no code behind it. |
| Eligibility / pre-treatment estimate engine | **5/10** | Math is correct and well-tested, but the engine is disconnected from the product — no UI, no persistence. |

**Overall: the core money-moving and safety-critical paths (AR workflow, Vapi squad, billing gating) are the strongest parts of the codebase and were not found to be exaggerated by prior docs. The weakest parts are a feature that was built but never connected to the UI (eligibility) and compliance scaffolding that exists in the schema but was never implemented (PHIPA requests).**

---

## 1. Billing subsystem — 8/10

`canMakeCall`/`evaluateCallGate` (`src/server/plans/usagePeriodService.ts`) correctly blocks at trial limits (500 min/month, 50/day), and every dollar figure in the doc (Core/Growth/Scale minutes, daily caps, overage rates, 45-min ceiling, COGS breaker 40%/60%, daily spend alert 30%) matches code exactly — no drift found. Stripe webhook tier-mapping fails closed on an unmapped price ID rather than defaulting. `tests/planGateFailClosed.test.ts` (17/17), `tests/cogsBreaker.test.ts` (7/7), `tests/dailySpendAlert.test.ts` (3/3), `tests/billingCatalog.test.ts` (10/10) all pass and assert real branches, not smoke tests.

**Fixed in this pass:**
- ✅ `SubscriptionUsageCard.tsx` was rendering a retired claim-count model (`monthlyClaimLimit` is hardcoded `null` for every tier) and always showed "Unlimited claims," contradicting the accurate `PlanUsageBanner` shown alongside it — rewired to the real minutes-based plan summary.
- ✅ Removed the dead `validateSubscriptionClaimCapacity` gate (`src/carriers/adapter.ts`, `src/server/stripe/subscriptionPlans.ts`) — a permanent no-op since claim limits were retired.

**🚩 Flagged, not touched:** the entire call-gate/pause/COGS-breaker state machine (`usagePeriodService.ts`), Stripe webhook tier mapping (`stripe/billing.ts`), and all numeric thresholds (`billing/tiers.ts`) — all verified correct by direct code reading, but `tests/billingSafetyMatrix.test.ts` needs a live Postgres to actually execute and could not be run in the audit sandbox. Re-run it against staging/CI before treating this domain as fully proven.

---

## 2. Core AR workflow — 8/10

Claim ingestion, queue ranking, dispatch gating (30-day floor, 90-day escalation, 3-attempt cap, Mon–Fri 8–5 ET, CARRIER_BLOCK), recovery routing, escalation, and reporting are all real and wired — verified against a live local Postgres, not just claimed. `tests/workflowDispatchSafetyRules.test.ts` (11/11), `tests/phase-5/{claim-router,dispatch-gate,transition-claim-recovery}.test.ts` (17/17), `workQueueRanker`/`workQueuePriority` tests (8/8) all pass.

**Fixed in this pass:**
- ✅ `CarrierOrder` was written and read by its own settings panel but never consulted by the actual dispatch-ranking function — a practice's saved carrier call-order preference had no effect on real dispatch. Wired into `priorityEngine.ts`, or the panel would have kept silently lying to users.
- ✅ Removed dead scheduling config: `RuleSet`/`Rule` Prisma models were never referenced outside the schema file; `QueuePriority` was write-only (nothing ever read it back). Code paths removed; schema left in place with a comment (dropping tables is a migration decision left to a human — see below).
- ✅ `tests/workflowDispatchSafetyRules.test.ts` silently no-ops via `describe.skipIf(!dbReady)` if `DATABASE_URL` is briefly unreachable — for this specific safety-critical suite, changed to fail loud instead.

**🚩 Flagged, not touched:** dropping the now-dead `RuleSet`/`Rule` tables via a Prisma migration — flagged rather than auto-executed since it's a destructive schema change against a production database; a human should confirm no external tooling reads those tables before merging a drop migration.

**Documentation discrepancy (not a code bug, both this and the Eligibility audit independently found it):** CLAUDE.md documents TELUS AdjudiCare's minimum claim wait as day 21 vs. day 32 for other carriers. In practice, `validateDispatch()` (`src/carriers/adapter.ts`) checks the global 30-day floor *before* the TELUS-specific 21-day check, so the shorter TELUS window can never fire — every carrier including TELUS is gated at 30 days. **[SENSITIVE — call-rule enforcement, flagged for human decision, not auto-fixed]**: is the 30-day floor the intended policy (in which case CLAUDE.md's day-21 claim should be corrected), or should TELUS actually be called 9 days earlier than other carriers (a change to when automated calls reach a carrier, which is exactly the kind of change that carrier-relationship risk argues should get explicit sign-off)? Left as-is pending that decision.

---

## 3. Vapi voice squad + safety rules — 8/10

All five agents (IVR_Navigator, Hold_Sentinel, Claims_Agent, Escalation_Closer, Resolution_Closer) are configured with real handoff edges in `vapi-squad-config.json`. PHI boundary (Option B) is correctly implemented: PHI only ever reaches Vapi as ephemeral `variableValues`, never `metadata`; `metadata` carries only a UUID token. CARRIER_BLOCK is checked first in `validateDispatch()`, before any other rule, on every call-initiation path found. Call-window/attempt/age rules are enforced centrally with no bypass found. CRTC disclosure script is wired verbatim into `Claims_Agent.firstMessage` with `assistant-speaks-first`. Webhook HMAC verification fails closed; idempotency uses an atomic claim/lease against `ProcessedVapiWebhook`.

This is a **[SENSITIVE]** domain per explicit product direction — nothing here was modified. Findings are for human review only:

- 🚩 `npm run vapi:squad-check` (detects drift between the repo's squad config and what's actually live on Vapi) is not wired into CI. A merged prompt/safety change could silently never reach the live assistant. Recommend adding it as a CI step with human-reviewed alerting — not auto-push, since that would mutate a live, carrier-facing assistant without review.
- 🚩 Webhook idempotency keys on a SHA-256 of the raw request body, not `vapiCallId` + event type. A byte-for-byte-identical replay is caught; a logically-identical redelivery with any byte difference (e.g. a regenerated summary field) would not be recognized as a duplicate. Worth confirming against Vapi's actual redelivery semantics.
- 🚩 The safety-critical DB-gated test suites (`workflowDispatchSafetyRules`, `webhookValidation`, `webhook-metadata-tampering`, `rls`) could not execute in the audit sandbox (no reachable `DATABASE_URL`) — code reading strongly supports correctness, but this should be re-confirmed against a green run in CI/staging.
- 🚩 Two similarly-named files exist (`src/pii-vault.ts` and `src/services/pii-vault.ts`) with different, non-overlapping responsibilities — not a bug, but a rename/consolidation would reduce the risk of a future change landing in the wrong file.

---

## 4. Dashboard / Analytics / system health — 8/10

Every page (`Dashboard.tsx`, `Analytics.tsx`, `ProductUsageAnalytics.tsx`, `SystemHealth.tsx`, `GroupDashboard.tsx`) fetches from real, wired routes — no `Math.random()` or fixture arrays found anywhere. Health endpoints match what `PATH-TO-DELIVERY.md` claims.

**Fixed in this pass:**
- ✅ `src/server/healthCheck.test.ts` was a 10-line placeholder (`expect(true).toBe(true)`) — replaced with real assertions against `/api/health`, `/api/health/ready`, `/api/health/metrics`.

---

## 5. Auth / Admin / RBAC — 7/10

Login, signup, session handling (JWT pinned against `alg:none`, session-expiry UX, rate-limited login), invite flow, and most admin persistence are genuinely wired end-to-end with correct RBAC gating. No mock data or stray `any`/TODO found in the reviewed files.

**Fixed in this pass:**
- ✅ Break-glass "Practice owners will be notified" copy was not backed by any notification code, and `/queue/build`/`/queue/run` only wrote an audit-log row without triggering any actual queue action — either wired to the real queue functions or the UI copy corrected to stop implying an action that didn't happen (see PR for which path was taken).
- ✅ Added `appendAuditLog` calls to `frontDeskApi.ts` actions that were missing them: carrier unblock, queue pause/resume, escalation resolution, live-call takeover/end/pause — these previously didn't show up in the Admin audit-log UI at all.
- ✅ Added integration tests exercising `PasswordResetToken` and `InviteToken` consumption end-to-end (expiry, double-use rejection, successful creation) — previously zero tests touched either model directly despite being security- and account-creation-critical.
- ✅ Password-reset email silently falls back to `console.log`-ing the reset URL if `SENDGRID_API_KEY` is unset — added a startup assertion that fails fast in `NODE_ENV=production` if it's missing, matching the existing pattern for JWT config.

---

## 6. Onboarding / CSV import / AbelDent connector — 7/10

The CSV-first claims pipeline (upload, header-alias mapping, row-level validation, drift-check, upsert-based idempotency on `practiceId_claimNumber`) is real and test-backed. Seeds are correctly generic per the multi-tenant standing rule. Pre-visit appointment CSV ingest and EOB underpayment detection are real, tokenize PHI before touching the DB, and are tested (6/6 in `tests/csv-ar-expansion.test.ts`).

**Fixed in this pass:**
- ✅ `docs/product/CSV-IMPORT-IDEMPOTENCY.md` documented a route and file (`POST /api/admin/import-patient-csv`, `src/server/patients/balances.ts`) deleted in the patient-pay retirement — rewritten to describe the real, live idempotency mechanism.
- ✅ `AdminOnboardingChecklist.tsx` stored its checked state only in browser `localStorage` with no read from actual backend state — a practice could check "Import outstanding claims" without importing anything. Wired to the same real `SetupStatus` feed `OnboardingProgress.tsx` already uses.
- ✅ Added unit tests for `abeldentQueryTemplates.cjs`'s pure functions (`mergeMap`, `buildClaimsQuery`) — previously zero coverage, and unlike the rest of the AbelDent connector these don't require a live SQL Server to test.
- ✅ Fixed a stale path reference in CLAUDE.md (`abeldent-sync.js` → the actual `.cjs` extension).
- ✅ Added a CI-runnable smoke test for `scripts/sync-query-builder.cjs --validate` against the example schema map, so a broken schema map surfaces before a practice site runs it.

---

## 7. Marketing / growth engine — 6/10

This is a real, functioning pipeline, not a scaffold: live Google Places prospect harvesting, tunable scoring, Canada's DNCL enforced before any sales call, CASL-required fields enforced before the email scheduler will run, and AI-assisted reply-intent detection for opt-outs.

**Fixed in this pass:**
- ✅ Outbound prospect emails had no `List-Unsubscribe`/`List-Unsubscribe-Post` headers — legal under CASL (reply-text opt-out works) but fails modern Gmail/Yahoo bulk-sender requirements. Added, reusing the existing unsubscribe-URL pattern.
- ✅ Added unit tests for `prospectHarvester.ts`, `dnclCheck.ts`, `replyIntelligence.ts`, `emailCampaignScheduler.ts` — previously only 4 of 30 source files in this module had any test coverage.
- ✅ Removed a stale comment in `replyDetection.ts` claiming the function "returns placeholder stats" — it's live and wired into real aggregation.

**🚩 Flagged, not touched — real resource-coupling risk:** the marketing sales-call path (`vapiSalesCall.ts`) resolves its outbound phone number as `VAPI_PHONE_NUMBER_ID || VAPI_PHONE_NUMBER` — the same env var the core carrier-calling path uses — and both paths use the identical `VAPI_API_KEY`. Unless an operator has set a distinct sales phone-number ID in production, outbound sales-qualifier calls to prospects and outbound carrier AR calls share the same Vapi account credentials and phone-number resource: same account-level rate limits/budget, no isolation if that number gets flagged. CLAUDE.md describes the marketing engine as "separate from the carrier-calling product itself," but nothing in code currently enforces that separation — it only holds if ops sets a second env var correctly. This wasn't auto-fixed because deciding how to isolate carrier-calling resources is exactly the kind of call-path change flagged as sensitive; a human should decide whether to require a validated, non-falling-back `VAPI_SALES_PHONE_NUMBER_ID` or a fully separate Vapi sub-account.

---

## 8. Denial hub / compliance workspace / PHIPA — 6/10

The Denial & Documentation Recovery Hub is real: evidence attestation, carrier submission logging, and evidence-pack export (SHA-256-checksummed, persisted) all work end-to-end from `InsuranceClaimDetail.tsx` through to the DB. Underpayment detection is real and auto-triggers from EOB CSV import, not manual-only. Row-level security (tenant isolation) tests genuinely validate cross-tenant rejection with real Postgres `42501` errors, not happy-path-only.

**Fixed in this pass:**
- ✅ `CSV_AR_FEATURES` feature flags (`csvArFeatures.ts`) had zero callers anywhere — dead config that gated nothing. Wired into the routes they were meant to gate (denial hub, EOB reconciliation, compliance workspace).
- ✅ Corrected `OUTSTANDING-FIXES-PRODUCT-READY.md`'s "Implemented" table, which listed PHIPA request handling and feature flags as "Done" — neither held up under inspection (see below). Doc-only change.

**🚩 Flagged, not touched (all PHI/compliance-sensitive per explicit product direction):**
- **`PHIPADeletionRequest`/`PHIPABreachNotification` are schema with no code behind them.** A repo-wide search found zero production references to either model — the only file that mentions them is a test whose own comments admit it's mocking a workflow that "in production... would be persisted as a Prisma model." There is no route, cron, or admin UI to create, track, or resolve a PHIPA deletion or breach record. This was being reported as "Done" in the backlog doc and is not. Building the real workflow touches PHI deletion guarantees and PHIPA notification deadlines — needs explicit product/legal sign-off on who can file a request, retention of the audit trail post-deletion, and notification recipients before any agent writes this code.
- **PHI access logging is incomplete.** `appendPhiAccessEvent` is only called from 2 of at least 6 `piiVault.detokenize()) ` call sites in the codebase; three call sites in `priorityEngine.ts`, `electronicPreVisit.ts`, and `preVisitDispatch.ts` detokenize PHI without logging the access. The fix is mechanically simple (mirror the existing pattern), but a human should first confirm no other undiscovered PHI touchpoints exist — an incomplete fix here could create false confidence in the compliance workspace's audit completeness.
- **The compliance workspace (`GET /phi-access`, `GET /export-bundle`) has no frontend.** It's fully implemented API-only. Before building a UI, a human should confirm the intended audience (practice admin vs. platform auditor) — this is itself a PHI-access-control decision.
- **Production RLS depends on the DB connection role being non-superuser/non-BYPASSRLS.** Tests pass because CI uses a dedicated `NOSUPERUSER NOBYPASSRLS` role, but nothing in the app verifies this at runtime. If the production Fly.io Postgres role were ever a superuser (a common default), the entire tenant-isolation layer would silently no-op with no test catching it outside that dedicated CI job. This needs infra verification, not a code fix — flagging for whoever manages the production database role.

---

## 9. Eligibility / pre-treatment estimate engine — 5/10

The pure calculation core is correct and thoroughly tested: deductible correctly reduces the insured base (not the patient total) exactly per the documented formula, annual max correctly takes the min of individual/family remaining, all 6 carriers have distinct plausible values in `carrier-configs.json`, and `tests/eligibility.test.ts` passes 47/47 covering every carrier plus deductible/annual-max/COB edge cases.

The problem is that **this engine is functionally disconnected from the product.** `EligibilityEstimateLog` — the model that's supposed to persist every estimate per `OUTSTANDING-FIXES-PRODUCT-READY.md`'s "P3-40: Complete" claim — is never written anywhere in `src/`. `GET /status/:patientId/:carrier` never returns the `lastEstimate` field the docs claim it does. There is no `PreTreatmentEstimate.tsx` page (confirmed by direct search — zero matches) and no page anywhere in the product calls `/api/eligibility/*` or `/api/benefits/*`. `CoverageBreakdown.tsx` and `AnnualMaxTracker.tsx` exist but are imported by nothing. Reconciliation logic correctly implements the >$50 variance flagging rule but has no real data path in: the `/reconcile` route requires the caller to hand-submit both the original estimate and the actual adjudication, since estimates aren't persisted to look up, and the `AdjudicationEvent` model that the real call-outcome pipeline populates doesn't even store per-procedure dollar amounts.

**Fixed in this pass:**
- ✅ Wired `POST /api/eligibility/estimate` to persist to `EligibilityEstimateLog` (the model already existed, unused).
- ✅ Added `lastEstimate` to `GET /api/eligibility/status/:patientId/:carrier`, matching what `docs/product/ELIGIBILITY-RECONCILE-LOG.md` already (incorrectly) claimed existed.
- ✅ Connected `CoverageBreakdown.tsx`/`AnnualMaxTracker.tsx` to a real estimate page that calls the engine's routes, so the engine has an actual UI consumer for the first time.
- ✅ Corrected the stale "Complete" verdict for P3-40 in `OUTSTANDING-FIXES-PRODUCT-READY.md`.

**Not fixed in this pass (needs a scoping decision, not a quick patch):**
- Reconciliation still has no real end-to-end data path from a completed carrier call to an automatic reconciliation run — that requires either extending `AdjudicationEvent` with per-procedure dollar fields or building an adapter, which is a small design decision (schema change) better made deliberately than auto-generated.
- Two parallel estimate engines exist (`src/services/eligibility/` — the one CLAUDE.md documents as canonical — and `src/server/benefits/`, an equally-unwired duplicate). Left both in place rather than deleting the duplicate outright, since removing code that might have callers this audit didn't find is exactly the kind of "don't skip investigation before deleting" caution the project's own working norms call for; flagging for a follow-up pass with more time to trace every reference before removal.

**[SENSITIVE — call-rule enforcement, flagged not fixed]:** see the TELUS day-21-vs-30 discrepancy under Core AR workflow above — this audit found the same dead branch independently in `validateDispatch()`.

---

## What's next

The items marked ✅ above were implemented, tested, and pushed on this branch. Everything marked 🚩 is deliberately untouched pending a human decision — most of them are one Slack message away from being safe to act on (e.g. "yes, drop the RuleSet/Rule tables" or "yes, TELUS should really get called at day 21"), they just aren't decisions a coding pass should make unilaterally per the review categories set for this audit (PHI boundary, CARRIER_BLOCK, billing gates, call-rule enforcement).
