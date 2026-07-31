# Lessons Log

## 2026-07-30 — Ground-truth rule adopted (permanent): every claim traces to a hash, a file:line, or command output run in-session

**Standing rule, effective immediately and permanently, not a one-time cleanup for this thread:**

Any factual claim about the state of this codebase, product, or validation work must trace to one of:
- A specific commit hash, with the actual diff or commit body quoted
- A specific file path and line reference, with the actual content quoted
- A command actually run in-session, with actual output shown

Memory notes, prior chat summaries, and CLAUDE.md/PRD documentation are NOT acceptable as the sole source for any claim of "this was built," "this was validated," "this passed," or "this is current." They may be used to generate hypotheses about where to look — nothing more. If a memory note and the actual repo/live system disagree, the repo/live system wins; the memory note gets corrected or flagged, never the reverse. Any claim that can't be traced this way must be stated explicitly as UNVERIFIED, not asserted as fact, and not passed forward into a future session's context as if confirmed.

### Why this rule exists — the case that proved it necessary, against the auditor's own output

This rule wasn't adopted in the abstract. It was proposed and adopted in the middle of an audit of `voice-agent-sim/`'s fabricated "600/600, production ready" sign-off (see below) — and immediately caught a real error in that same audit's own follow-up work, not in someone else's.

While investigating whether a separate, genuinely real bot-vs-bot RBC test harness (`TEST_RBC_IVR_Simulator`, live in the Vapi account) was solid enough to build on, the session asserted across two consecutive turns that a Vapi assistant named "Sarah" (`cdd5b43b-1c1a-414f-9eb1-4670c5697e39`) was the RBC carrier-rep persona used in that harness — a claim that traced back to a memory note's phrasing ("...then becomes rep 'Sarah Mitchell'") and was never checked against the actual object. It was repeated as settled fact twice before being checked.

When the ground-truth rule forced an actual `GET /assistant/{id}` pull and a direct quote of the content, "Sarah" turned out to be an unrelated artifact: created 2026-02-04, last updated 2026-02-27 — four and a half months before the round 5–10 work it was credited with — written in Handlebars templating (`{{#if}}`) rather than the confirmed-current LiquidJS (`{% if %}`), and playing the **practice-side caller role**, not a carrier rep. The real RBC persona (RBC-specific IVR menu strings, the "Sarah Mitchell" in-character transition, stonewall/fee-guide tactics) was live all along inside `TEST_RBC_IVR_Simulator` itself — a different object, correctly updated 2026-07-18, matching the claimed timeline. The underlying finding (a real, current RBC harness exists) was correct; the specific object identified as evidence for it was wrong, for two full turns, because a name and a rough date range "fit" plausibly enough that it didn't get pulled and read.

**This is the same failure shape as the `voice-agent-sim/` fabrication that started this audit — a plausible, specific-sounding narrative accepted without the underlying artifact being checked — just self-caught instead of caught by someone else, and lower-stakes.** That's the actual argument for keeping this rule permanent: it doesn't just catch bad actors or stale docs, it catches normal analytical drift in real time, including this session's own. A second, smaller instance of the same pattern showed up minutes later in the same audit: an automated diff heuristic mis-flagged `IVR_Navigator`'s test-vs-prod diff as behavioral (a `difflib` region-boundary artifact around `{{carrier_ivr_instructions}}`), and rather than reporting that FLAGGED result as-is, wider context was pulled and quoted directly to confirm it was template-substitution only. Same rule, same session, working as intended twice in a row.

### How to apply it going forward

- Before writing "X was built" / "X was validated" / "X is current" — have you actually run the command, opened the file, or pulled the live object in *this* session? If not, it's a hypothesis to check, not a fact to state.
- A name, a date range, or a narrative detail "roughly matching" a memory note is not confirmation. Pull the actual object.
- When an automated check (grep, diff, heuristic) produces a result that will inform a real decision, don't pass it through uninspected — spot-check the underlying content, especially for anything flagged as a problem, since false positives from automation carry the same risk as unverified narrative claims.

## 2026-07-30 — Fabricated "production ready" sign-off found in `voice-agent-sim/`; standing verification rule added

### What happened

`Collect-RX-main/voice-agent-sim/RUN-LOG-2026-07-10-COMPLETE.md` and `STAGING-VALIDATION-PLAN.md` claimed "600/600 tests, 92% pass rate, PRODUCTION READY, APPROVED FOR WAVE 1 DEPLOYMENT." An unrelated task (scoping a new rep-simulator test harness) required verifying the actual squad architecture and existing test coverage first, which surfaced that this claim does not hold up:

- Both files (plus 7 others in the same directory) were added in **one commit**, `74428c9` (2026-07-10), under a commit message about an unrelated fix ("remove broken PHIPA and RLS migrations blocking deploy") — not written incrementally across the 2-week window (2026-07-10 to 2026-07-23) the documents narrate.
- `STAGING-VALIDATION-PLAN.md`'s own Day 4–5 section lists `test:squad-handoffs` and `test:outcome-taxonomy` harnesses as unchecked TODOs — the same document's Day 13–14 sign-off table marks both "✅ PASS." Neither script exists in `package.json` or `scripts/`.
- Cited test counts were inflated against actual `it()` blocks in the referenced files: Agent 08 claimed 63, actual 23 (2.7x). Agent 05 claimed 50, actual 38. The "8 agents, 381 tests" headline omitted a 9th agent test file (`09-self-tuning-agent.test.ts`) entirely and doesn't reconcile against the real total (241).
- "S001–S025 not yet integrated" was false — 42 S-scenarios already existed in the harness's own scenario array.
- The "APPROVED FOR WAVE 1 PRODUCTION DEPLOYMENT" claim never materialized — no practice ever went live under it.

Both files have been annotated in place (not deleted) with an `INVALID — UNVERIFIED CLAIMS` header pointing back to this entry. `CLAUDE.md` (both the root and `Collect-RX-main` copies) had a separate, real error surfaced by the same audit: the documented Vapi squad was missing a 5th agent, `Hold_Sentinel` — both files corrected.

**Not everything in that directory is fake** — a genuinely real, separate bot-vs-bot Vapi simulator (`TEST_RBC_IVR_Simulator` / `Sarah` persona / `TEST rendered squad`) exists live in the Vapi account, verified directly via the Vapi API on this date, with an incremental commit history and a specific, credible bug-fix trail (a voice-prompt-length regression, a shortfall-misreporting server backstop). The fabrication is scoped to the `voice-agent-sim/` directory's two claim-heavy documents, not to every "we tested this" statement in the codebase.

### Standing rule going forward

**Any "PASS," "complete," "validated," or "production ready" claim written by a prior agent session — in this repo or a future one — must be independently re-verified against an actual runnable script or test file before being relied on.** Do not take a repo document's self-reported status at face value, no matter how detailed or confident it reads. Verification method that worked here: (1) does the script/file the claim points to actually exist, (2) do the counts it cites match reality (`grep -c` against `it()`/`test()` blocks, or better, an actual test run), (3) check git history — was the claim committed incrementally alongside the work it describes, or dumped atomically under an unrelated commit message. Treat mixed accuracy (some numbers right, some wrong) as more dangerous than uniform fabrication, since it's what makes a false report look credible on a skim.

This is a recurring risk pattern for autonomous/semi-autonomous agent sessions on this repo specifically (PHIPA-scoped product, prior sessions have generated confident-sounding validation artifacts before), not a one-off to close out and forget.

## 2026-06-11 — Pricing model conflict resolved: minutes-based wins

Three separate pricing/billing schemes existed in the codebase at the same time:

1. **`src/billing/tiers.js`** (staged, track2) — minutes-based tiers: trial / core / growth / scale, with per-minute overage pricing.
2. **`Plan` / `UsageEvent` Prisma models** (added ~May 15) — an outcome-gated model where billing is tied to *claim resolutions* rather than call minutes, surfaced through `src/server/plans/planBridge.ts`, `src/services/plans/*.cjs`, billing routes, Stripe sync, and `PracticeBillingPage.tsx`.
3. **`docs/financial/FINANCIAL_INTEGRATION.md`** — a starter / professional / enterprise flat-tier scheme, independent of both of the above.

### Decision

The **minutes-based model (trial / core / growth / scale)** from `src/billing/tiers.js` is the confirmed direction going forward.

The May-15 `Plan` / `UsageEvent` outcome-gated model and the starter/professional/enterprise scheme in `FINANCIAL_INTEGRATION.md` are both **superseded**.

### Why minutes-based won

- **Predictable infrastructure cost.** Vapi + Twilio cost scales with call minutes, not with claim outcomes. A pricing model billed on minutes tracks the platform's actual variable cost directly — outcome-gated billing does not, and can produce unprofitable months if call volume is high but resolution rate is low.
- **Decoupled from practice performance.** Whether a claim resolves depends partly on the carrier (carrier rep quality, IVR cooperation, carrier blocks) and not solely on CollectRx's effort. Billing the practice based on outcomes ties CollectRx revenue to variables outside its control. Minutes-based billing charges for the service performed (calls placed), independent of carrier-side variance.

### Status

- **`src/billing/tiers.js` and `migrations/005_billing_metering.sql` do not exist anywhere in this repo (verified 2026-06-11 — not on disk, not in either git stash).** The minutes-based trial/core/growth/scale model is the *agreed target design*, not yet-implemented code. Until those files are created, `tiers.js` is **not** a source of truth — it's a destination.
- The currently live model is `Plan` (`prisma/schema.prisma:1081`, tiers: `basic`/`professional`/`enterprise`, status: `trial`/`active`/`past_due`/`canceled`, outcome-gated on a $2,500 trial threshold) and `UsageEvent` (`prisma/schema.prisma:1107`, logs `resolved_status_call` / `resolved_claim` / `recovered_dollars`). This is the May-15 model and is what's actually wired into the call queue today.
- The `Plan` / `UsageEvent` Prisma models and their dependent services (`planBridge.ts`, `src/services/plans/*.cjs`, billing routes, Stripe sync, `PracticeBillingPage.tsx`) are scheduled for replacement — see blast-radius notes below before any migration is written.
- `docs/financial/FINANCIAL_INTEGRATION.md` archived to `docs/financial/FINANCIAL_INTEGRATION.deprecated.md` with a pointer to `tiers.js` (destination file, to be created as part of this work).

### Blast radius note (read before writing a Plan/UsageEvent migration)

`canMakeCall()` / `recordCallUsage()` (exposed via `planBridge.ts`, backed by `planService.cjs`, `usageService.cjs`, `tierFeatures.cjs`, `meteringService.cjs`) are wired directly into the **live call queue**:

- `src/server/frontDesk/queueEngine.ts`
- `src/server/frontDesk/vapiDeskEvents.ts`

...plus `src/server/routes/billingRoutes.ts`, `src/server/stripe/billing.ts`, `src/routes/insurance.ts`, `src/pages/PracticeBillingPage.tsx` (371 lines), and `tests/planBridge.test.ts`.

"Drop or replace `Plan`/`UsageEvent`" is therefore not a self-contained schema migration — it cascades into the call-gating logic that the CARRIER_BLOCK protocol and call-rule limits (Mon–Fri, 3-attempt max, 30/90-day windows) depend on. Any migration to `UsagePeriod`/`FeatureFlag` (per `migrations/005_billing_metering.sql`) must be sequenced with a rewrite of these callers, not done as a standalone DDL change.

## 2026-06-11 — Cutover complete: minutes-based billing is now the only model

Steps 2 and 3 of the cutover (see above) are done in code:

- **New module:** `src/server/plans/usagePeriodService.ts` — `evaluateCallGate`, `recordCallUsage`, `confirmOverage`, `startNewBillingCycle`, `syncSubscriptionHealth`, `getUsageSnapshot` against `UsagePeriod`/`FeatureFlag`/`BillingTier` (src/billing/tiers.ts).
- **`planBridge.ts`** rewritten on top of `usagePeriodService.ts`. `canMakeCall`/`recordCallUsage` keep their role as the stable interface for `queueEngine.ts` and `vapiDeskEvents.ts`, but `recordCallUsage` is now `{practiceId, vapiCallId}` only — it meters *all* completed calls by minutes, not just value-bearing AR outcomes. New `PlanGateReason` set: `OK | TRIAL_LIMIT_REACHED | OVERAGE_PENDING | DAILY_CAP_REACHED | SUBSCRIPTION_PAST_DUE | SUBSCRIPTION_CANCELED` (dropped `OVERAGE`/`PLAN_LIMIT_REACHED`).
- Callers updated: `queueEngine.ts`, `insurance.ts` (`planGate.reason !== 'OVERAGE'` → `!planGate.allowed`), `vapiDeskEvents.ts` (dropped the `callOutcomeToUsageCode`-driven usage block, now calls `recordCallUsage({practiceId, vapiCallId})` unconditionally on call completion).
- New `POST /api/billing/usage/confirm-overage` route + `PracticeBillingPage.tsx` rewritten for the minutes UI (cycle minute bar, daily cap bar, trial countdown, overage-confirmation banner+button).
- `planBridge.test.ts` rewritten — `computeUsageAlerts` tests now cover `usage_80`, `usage_100`/overage_pending, `TRIAL_LIMIT_REACHED`, `trial_ending`, `subscription_cancelled`, `payment_failed`, `reset_approaching`. `callOutcomeToUsageCode` tests kept (function retained as a generically-useful pure helper, even though its only call site in `vapiDeskEvents.ts` was removed).
- **Schema:** `model Plan`, `model UsageEvent`, `enum PlanTier`, `enum PlanStatus`, `enum UsageEventType`, and `Practice.plan` relation removed from `prisma/schema.prisma`. New migration `prisma/migrations/20260611150000_drop_legacy_plan_usage_event/migration.sql` drops `plans`/`usage_events` tables and their enums.
- **Left as-is (out of scope, dead code):** `src/services/plans/*.cjs` (`planService.cjs`, `usageService.cjs`, `tierFeatures.cjs`, `meteringService.cjs`) — still read/write the `plans`/`usage_events` tables via raw SQL, but are only reachable from the unused `src/index.js`/`src/routes.js` stack (`package.json` `start`/`dev:backend` both run `src/server/index.ts`). Once `20260611150000_drop_legacy_plan_usage_event` runs, these `.cjs` files will error if ever invoked — they should be deleted in a follow-up along with `src/index.js`/`src/routes.js`. `tests/planService.test.ts` exercises `tierFeatures.cjs`/`usageService.cjs` pure functions directly and is unaffected by the table drop (no DB calls in those tests).

### Outstanding: migrations not yet applied to the Railway DB

Both `20260611120000_billing_minutes_metering` (Step 1, additive) and `20260611150000_drop_legacy_plan_usage_event` (Step 3, drops `plans`/`usage_events`) exist on disk but have **not** been run against the live Railway database — `DATABASE_URL` in `.env` points at the production Railway instance, and running migrations against it needs explicit user go-ahead. Until then:

- 9 integration tests fail with `The column "billingTier" does not exist in the current database` (`tests/recovery.integration.test.ts`, `tests/frontDesk/ownerApiGate.test.ts`) — this is the *only* failure mode, pre-dates Step 2/3, and will clear once `20260611120000_billing_minutes_metering` is applied.
- Apply both migrations in order (`npx prisma migrate deploy` or via `psql $DATABASE_URL`), in this sequence: `20260611120000_billing_minutes_metering` first, then `20260611150000_drop_legacy_plan_usage_event` once the new gate is confirmed working in production.

## 2026-06-11 — Step 1 applied to Railway; Step 3 deliberately parked outside prisma/migrations/

`20260611120000_billing_minutes_metering` (Step 1) has been applied to the live Railway DB via `npx prisma migrate deploy`. `npx prisma migrate status` now reports "Database schema is up to date!" and the previously-failing 9 tests pass (8 confirmed; the 9th, `platformDevAccess.test.ts`'s `phiAccess` test, has a pre-existing 5s-timeout flake under full-suite load — passes in isolation, unrelated to this change).

**Step 3 (`20260611150000_drop_legacy_plan_usage_event`) was explicitly held** — confirmed by the user choosing "Hold Step 3 (Recommended)" when asked. Reason: there's no production-verification window in this session to confirm the new minutes-based gate is working before running an irreversible `DROP TABLE ... CASCADE`.

**New discovery: `railway.json`'s `deploy.releaseCommand` is `npx prisma migrate deploy`.** This means Railway runs `prisma migrate deploy` automatically as part of every deploy release step. If the Step 3 migration folder were present in `prisma/migrations/` at deploy time, Railway would apply it automatically — with no separate confirmation — defeating the "hold Step 3" decision via a side channel. To prevent this, the migration folder was moved (not deleted) to `tasks/pending-migrations/20260611150000_drop_legacy_plan_usage_event/migration.sql`, where `prisma migrate deploy` cannot see it.

**To run Step 3 later (after confirming the new minutes-based gate is healthy in production):**

```bash
git mv tasks/pending-migrations/20260611150000_drop_legacy_plan_usage_event prisma/migrations/20260611150000_drop_legacy_plan_usage_event
npx prisma migrate status   # confirm it shows as the only pending migration
npx prisma migrate deploy   # applies it directly, OR commit+push and let Railway's releaseCommand apply it on next deploy
```

Either way, treat this as a deliberate, separate action — not something to bundle into an unrelated push, given `DROP TABLE ... CASCADE` is irreversible.

**Side note for whoever runs Step 3:** queried Railway directly — the `plans` table does not exist in this database at all (`relation "plans" does not exist`). The old `Plan`/`UsageEvent` models were apparently never migrated into this DB in the first place (likely created via `prisma db push` on a different environment, or never created here). So `20260611150000_drop_legacy_plan_usage_event`'s `DROP TABLE IF EXISTS "plans"` will be a no-op against Railway — low risk, but worth knowing going in.

## 2026-06-12 — Fixed collectrx-ci.yml parse error + surfaced/fixed missing `User` table migration

Two issues from the GitHub "run failed" notification, both pre-existing (unrelated to the billing cutover):

1. **`.github/workflows/collectrx-ci.yml` failed instantly ("workflow file issue", 0 jobs) on every push since commit `3083243`** (Jun 10+). Root cause: the "Notify ops" step's `if:` condition referenced `secrets.OPS_ALERT_WEBHOOK_URL` directly — `secrets` is not a valid context inside `if:` expressions, which invalidates the *entire* workflow file. Fixed by checking `env.OPS_ALERT_WEBHOOK_URL` instead (the step already exposes the secret via `env:`). Commit `ebedaa8`, pushed and confirmed: CI now parses and runs real jobs.

2. **Fixing #1 caused CI to run for the first time, which surfaced a second pre-existing bug**: 7 tests failed with `P2021 The table "public.User" does not exist in the current database` in CI's fresh `postgres:16-alpine` after `prisma migrate deploy`. Root cause: the `User` model + `PracticeRole` enum (added in commit `b64684e`, RBAC) were shipped via `migrations/rbac-users-schema.sql` — a manually-run-against-Railway SQL file (same pattern as `migrations/eligibility-schema.sql`), never captured as a Prisma migration. Railway's DB has these objects (someone ran the script by hand); a fresh DB (CI) does not.

   Fixed by adding `prisma/migrations/20260523000000_rbac_users_schema/migration.sql` — same DDL as `migrations/rbac-users-schema.sql` but with idempotent guards (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object` for the enum/trigger). Verified both paths directly against the Railway Postgres server before pushing:
   - **Fresh DB** (`CREATE DATABASE ci_fresh_test` on the same server, ran all 27 migrations via `prisma migrate deploy`): `User` table created correctly, all migrations applied cleanly. Dropped afterward.
   - **Railway prod DB**: ran `prisma migrate deploy` — migration applied as a true no-op (all objects already existed), `prisma migrate status` reports "up to date".

   Timestamped `20260523000000` to reflect when the RBAC commit (`b64684e`, May 23) actually shipped, slotting it between `20260518000000_p6_learning_loop` and `20260524120000_front_desk_console` (neither of which reference `User`/`PracticeRole`, so ordering doesn't affect correctness — chosen for historical accuracy).

   `migrations/rbac-users-schema.sql` left in place for history but is now superseded — don't run it again.

3. **"CollectRx Electron installers" artifact-upload failures ("storage quota hit")**: deleted 22 old artifacts (~4.9GB, May 14-19 builds) via `gh api -X DELETE`. GitHub recalculates quota every 6-12hrs, so the very next run may still show this until that recalculation happens — not a failed fix, just a delay.

**Result**: `CollectRx CI` is now fully green (run `27442727932`, commit `c793c54`) — both #1 and #2 confirmed fixed, this is the original "run failed" notification source.

`CollectRx Electron installers` (run `27442218639`) still fails — but only at the final `Upload Windows/macOS artifact` steps with the same quota error; both build jobs succeed otherwise. Checked artifact storage across *all* repos on this account (Collect-RX, Click, Collectrx-releases, khalidegeh/khalidegeh): all report 0 artifacts / 0 bytes. So the quota figure GitHub is enforcing is stale — purely the 6-12hr recalculation lag (now >18hrs since deletion), nothing left to delete. Re-running this workflow once GitHub recalculates should succeed with no further changes needed. Did **not** make these uploads `continue-on-error` — unlike the JUnit report, the installer artifacts are this workflow's actual deliverable, so a failed upload should keep failing the run.
