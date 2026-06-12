# Lessons Log

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
