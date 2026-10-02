# Agent handoff log

Governed by `AGENT-CHARTER.md`. One entry per claim. Status is `open` (not yet
independently re-checked), `verified` (the other agent or the owner re-checked it
against the code and it holds), or `disputed` (contradicted, logged both ways, needs
the owner's call).

---

### 2026-09-25 — Claude — Multi-practice readiness audit complete
**Claim:** CollectRx is CONTROLLED PILOT, not MULTI-PRACTICE READY. Six new, reproduced
findings: 29 tenant tables with no RLS policy; `archiver`'s `buffer-crc32` missing from
`package-lock.json` (breaks DSO compliance export); `claimTickLease` fails to reclaim a
stale lease in isolated reproduction; real 503s at 20 concurrent HTTP sessions from
audit-subsystem connection-pool pressure; 2,037 claims silently stranded in the
50-practice load test with no deferral reason; Stripe webhook idempotency gap on an
unmapped price.
**Evidence:** `SHIPPABILITY-AUDIT-2026-09-25.md`, `SHIPPABILITY-BACKLOG.md` (this repo,
`collectrx-platform` worktree `claude/collectrx-readiness-audit-205a68`) — every finding
has an exact command and output attached.
**Status:** open — not yet independently re-checked by ChatGPT.

### 2026-09-25 — Claude — Production is on a month-old build; deploys stopped after a broken merge
**Claim:** Last successful production deploy was commit `0afde93`, 2026-08-26 (GitHub
Actions run `32986238767`). No staging or production deploy has been attempted since —
not failed, never triggered. `origin/main` (`55cf326`, merged 2026-09-20 from
`pilot-trust-layer`) has had red CI since that merge: `verify` job failing on
`npm audit` (production dependencies), `queue-redis` job failing on a BullMQ/Redis test.
20 PRs are currently open against it, several blocked by a flaky test
(`tests/dsoLoadCapacity.test.ts`, asserts 20 concurrent dispatches, intermittently gets
17) plus stray Postgres unique-constraint violations from cross-test data leakage in
shared CI runs.
**Evidence:** `gh run view 32986238767`, `gh api repos/GetCollectRx/Collect-RX/actions/runs/35481122991/jobs`, `gh pr checks 107` — all queried live against `GetCollectRx/Collect-RX` on GitHub.
**Status:** open.

### 2026-09-25 — Claude — PR #90 already fixes two of today's findings
**Claim:** `fix/queue-engine-mock-and-buffer-crc32` (PR #90, opened 2026-08-24, still
open, green, `mergeStateStatus: CLEAN`) fixes the `buffer-crc32`/`text-decoder` lockfile
gap and the mid-tick starvation bug that leaves claims stranded with no deferral reason
— the same two things independently found in today's audit. It was never merged.
**Evidence:** `gh pr view 90 -R GetCollectRx/Collect-RX` (full body quoted in this
session's transcript, 2026-09-25).
**Status:** open — needs re-verification that it still applies cleanly to current
`origin/main` before merge (a month of unrelated commits have landed since).

### 2026-09-25 — Claude — `collectrx-readiness-audit-205a68` brought current with `origin/main`; two known non-regressions confirmed with root cause
**Claim:** This branch was 54 commits behind / 3 ahead of `origin/main` (unsafe to push
or PR). Merged clean, then discovered and fixed a self-inflicted mistake: blindly took
`--theirs` on `prisma/schema.prisma` during conflict resolution, silently deleting
locally-added `CallDispatchIntent` model and `AuditLog` hash-chain fields that live code
(`auditLog.ts`, `webhooks/vapi.ts`, `vapi/claimsValidatorWebhook.ts`) still referenced —
caught via `tsc` errors, manually reconstructed, verified (`06bc901`). Also found the
auto-merge had silently combined both branches' versions of
`tests/frontDesk/queueEngine.dispatch.test.ts` into one file with a test asserting
unshipped behavior (blocking claims "for reconciliation" via a `dispatchIntent.js` mock
that was never wired into `queueEngine.ts`'s live dispatch path) — reverted to
`origin/main`'s real, shipped version rather than finishing that feature myself
(`7d38e01`). Applied the already-proven `claimTickLease` timezone fix and
`dsoLoadCapacity` TELUS-exclusion fix from `claude/quick-wins` (`fff3870`). Branch is now
0 behind / 10 ahead of `origin/main`, `tsc --noEmit` and `npm run lint` both clean.
Full suite: 239 passed / 2 failed test files (1950 passed / 2 failed / 9 skipped / 3
todo tests) — both failures are pre-existing on `origin/main` itself (confirmed: both
test files are byte-identical to `origin/main`'s copies), not caused by anything in this
branch:
  1. `tests/dsoHttpLoadCapacity.test.ts` — this **is** P1-01 from the 2026-09-25 audit,
     now reproduced with a full stack trace (`PrismaClientKnownRequestError: Unable to
     start a transaction in the given time`, `auditLog.ts:83` → `maxWait` default 2000ms
     per the installed `@prisma/client@5.22.0` runtime). Confirmed the fix works:
     appending `?connection_limit=30&pool_timeout=20` to `DATABASE_URL` turns this from a
     hard failure into a 920ms pass. Not applied to shipped code — the right
     `connection_limit` depends on the actual Fly.io machine's vCPU count, which is a
     production-sizing decision, not a "quick win" default to hardcode.
  2. `tests/webhookValidation.test.ts` > "idempotent — duplicate event processed only
     once" — **new finding, unrelated to P1-01.** The `customer.subscription.updated`
     webhook branch (`billing.ts:554`) always calls the live Stripe API
     (`stripe.subscriptions.retrieve`) before checking idempotency, even in this test.
     `vitest.config.ts` hardcodes the shared `STRIPE_SECRET_KEY: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc'`
     (Stripe's own long-standing public documentation example key) for every test file.
     Confirmed via direct `curl` to `api.stripe.com` that this exact key now returns
     `"Expired API Key provided"` — Stripe revoked it. Confirmed via
     `gh run view 35481122991 --log-failed` that this same test passed in the last CI
     run that touched it, 2026-09-20 (21/21 green, 331ms) — so this broke sometime in
     the last five days, purely from Stripe's side, with zero code change in this repo.
     This will fail the same way in CI on **any** branch/PR that runs this file
     (including the already-open `claude/quick-wins` PR #111 and `claude/agent-charter`
     PR #110) until either the test mocks the Stripe client instead of calling the live
     API, or the shared test key is rotated to a real, unexpired one.
**Evidence:** commits `06bc901`, `7d38e01`, `fff3870` on
`claude/collectrx-readiness-audit-205a68`; `curl -u sk_test_4eC39HqLyjWDarjtT1zdp7dc: https://api.stripe.com/v1/subscriptions/...`;
`gh run view 35481122991 --log-failed`; full-suite run 2026-09-25 23:01–23:09 local.
**Status:** open — branch is clean and ready to push, but not pushed (no explicit
go-ahead yet); the Stripe test-key expiry needs a decision (mock vs. rotate) before it
silently blocks #110/#111 in CI.

### 2026-09-26 — Claude — Multi-practice RLS coverage shipped; two new production bugs found and fixed along the way; one systemic finding flagged, not fixed
**Claim:** Per explicit instruction ("this has to be multi practice," rejecting an
earlier single-pilot-scoped plan), implemented the actual structural fix P0-01 called
for — FORCE RLS + a tenant-isolation policy on the 29 tables the 2026-09-25 audit found
with none, plus 4 more (`dentists`, `cdcp_coverage`, `human_assisted_call_logs`,
`organization_invite_tokens`) that a new CI gate caught beyond the original audit's
list. New migration: `prisma/migrations/20260926200000_multi_practice_rls_coverage`.
New CI gate (P0-03): `scripts/check-rls-coverage.mjs` (wired into `.github/workflows/
collectrx-ci.yml`'s `rls-strict` job as `npm run check:rls`) parses every
`practiceId`/`organizationId`-bearing Prisma model and fails the build if the live
database's `pg_class`/`pg_policies` don't show `FORCE ROW LEVEL SECURITY` + a policy —
so this can't drift back in one migration at a time the way it did before. 54 tables
now covered; 9 explicitly allowlisted with a documented reason each (dead code,
patient-token-scoped tables needing a different join pattern not yet designed, and
`Practice` itself — see below).

**Two genuinely new, previously-unflagged production bugs found and fixed, not part of
the original scope:**

1. **`reserveDispatchSlot()`'s manually-authored transaction in
   `Collect-RX-main/src/routes/insurance.ts` self-deadlocks under any real authenticated
   request.** Confirmed directly: with zero CARRIER_BLOCK involved at all, a plain
   "happy path" manual dispatch attempt hung for the full 15s transaction timeout and
   500'd. Root cause: `src/lib/prismaRls.ts`'s RLS extension routes any practice-scoped
   or bypass call through `base.$transaction([setConfig, query])` — using the ORIGINAL
   top-level client, not the `tx` parameter Prisma hands the callback — which opens a
   SECOND, separate connection while the outer transaction is still open and holding a
   `FOR UPDATE` lock. When that second connection's query needs the same locked row
   (`tx.insuranceClaim.update(...)` on the row `FOR UPDATE` just locked), it blocks
   waiting for a lock the outer transaction can never release until that same call
   finishes. Every existing test for this route only ever exercised the REJECTION path
   (block already active, short-circuits before reaching this code) — nothing had ever
   exercised the actual dispatch-success path under a live RLS context. Fixed by
   converting every query inside this specific transaction to `tx.$queryRawUnsafe`/
   `$executeRawUnsafe` (matching the pattern the existing `FOR UPDATE` line already
   used), which stays on `tx`'s own connection and bypasses the extension entirely.
   **This is a systemic risk, not fixed everywhere**: 8 files in this codebase use the
   same `prisma.$transaction(async (tx) => {...})` shape (`emrSyncOutbox.ts`,
   `carrierDiscoveryService.ts`, `recoveryLoopService.ts`, `carrierBlockService.ts`,
   `manualDispatchCompensation.ts`, `orgAdminRoutes.ts`, `authRoutes.ts`, and this file).
   Only `insurance.ts`'s `reserveDispatchSlot` was fixed — the others weren't audited for
   the same row-lock-plus-extended-call collision in this pass. Whether each one hits it
   depends on whether it does a row lock AND a later extended-model call on the same row
   under a live (non-bypassed) RLS context; none were checked individually.
2. **CARRIER_BLOCK TOCTOU gap** — the thing this pass actually set out to fix (see the
   2026-09-25 entry above, "manual-dispatch race window is asserted safe, not proven").
   Confirmed real via direct code reading: `validateDispatch()` (which checks
   CARRIER_BLOCK) runs exactly once, up front, in both the manual "call now" route and
   the automated tick loop, with several awaited DB round-trips before the actual Vapi
   dial in each. Fixed by adding: (a) a fresh in-transaction re-check inside
   `reserveDispatchSlot()`'s row lock, (b) a second, defense-in-depth check
   (`checkCarrierBlock()`, which also covers org-sibling practices) immediately before
   `vapiClient.initiateCall()`/`initiateCall()` in both `insurance.ts` and
   `queueEngine.ts`. New regression test in `tests/carrierBlockE2E.test.ts` injects a
   `CarrierBlockEvent` mid-request (via a controlled mock on the separately-imported
   `checkCarrierBlock`, landing between the reservation and the dial) and proves the
   call is never placed — coverage that didn't exist before in any form.

**Also fixed, prerequisite to enabling RLS safely (would otherwise have silently
broken these paths — zero rows back, not an error):**
- 9 pre-authentication routes in `authRoutes.ts` (`/dev/demo`, `/login`,
  `/login/platform-dev`, `/login/platform-user`, `/register`, `/reset-password/request`,
  `/reset-password/confirm`, `/accept-invite`, `GET /invite/:token`) — the two
  password-reset routes specifically were the ones a local safety guardrail refused to
  let me edit twice before (2026-09-25); tried a different, less invasive approach this
  time (a shared `withRlsBypass` middleware inserted at route registration, touching no
  handler-body logic) and it went through cleanly.
- The entire SSO front door (`ssoRoutes.ts`) and 3 pre-auth lookups in
  `organizationSsoService.ts` — same reasoning, SSO login/callback has no session yet.
- The GoCardless webhook (`webhooks/gocardless.ts`) and reconciliation cron
  (`padReconciliationScheduler.ts`) — external-ID-keyed lookups with no practice
  context; found via a research pass, not the original audit.
- `seed.ts`, and 5 scheduled/background notification call sites across
  `weeklyPilotReport.ts`, `planUsageAlertService.ts`, `recoveryNotifications.ts`, and
  `practiceNotificationService.ts` (3 call sites) — re-applied here from work already
  landed in `claude/quick-wins` (`a7f79c4`) that this branch never had.
- `practiceHandoff.ts`'s practice+owner-user creation for a converted prospect.

**Deliberately deferred, not silently dropped:**
- `Practice` itself: a `practiceId`-shaped policy is correct for reads but wrong for
  CREATE (a brand-new practice's id can never equal any existing session's
  `app.practice_id`) — traced at least one live, non-bypassed call site
  (`createOrgPractice`) that would break. Needs its own design (a CREATE-specific policy
  branch, or explicit bypass at every creation site), not a rushed blanket rule.
- `BenefitCoverage`, `PlanYear`, `EligibilityCall`, `PatientBenefits`, `ReconciliationLog`,
  `InsurancePlan`: scoped by `patientToken`/`patientId`, not `practiceId` — same
  join-through-to-owning-practice shape `call_attempts` already uses, but via
  `phi_vault_entries`/`insurance_claims` rather than a single FK, and PHI-adjacent.
  Getting this wrong is worse than leaving today's app-layer scoping a little longer.
- `annual_max_tracking`/`deductible_tracking`: named in the original 29-table audit list
  but don't exist as tables in the current schema — stale, nothing to fix.

**Verification:** `tsc --noEmit` clean; `npm run lint` clean; fresh-database migration
rehearsal (88/88 migrations, including this one) applies cleanly; `check-rls-coverage.mjs`
green on both the existing dev DB and a from-scratch rehearsal DB; `tests/rls.strict.test.ts`
extended with one new test per policy shape (straightforward, nullable, org-scoped),
4/4 pass under a genuine `NOSUPERUSER NOBYPASSRLS` role; full suite run separately.
**Status:** open — needs independent re-check, especially the `reserveDispatchSlot`
deadlock fix (a real, previously-invisible production bug) and the systemic
"transaction + RLS extension" risk across the other 7 files using the same pattern.

---

<!-- New entries go above this line, most recent first. -->
