# CollectRx code audit — 2026-11-23

**Scope:** `Collect-RX-main/` (canonical app). Root prototype (`src/api`, `src/frontend`) reviewed only for dead code.
**Branch / HEAD:** `feat/staff-conference-handoff` at `3600450`. The working tree has **18 modified tracked files** and a large set of untracked files, including migrations and new carrier-block and billing modules. Everything below audits the **working tree as it stands**, not HEAD. Findings that depend on the uncommitted diff are marked as such.
**Mode:** read-only. No code was changed. This file is the only addition.

## How this was run

- The mounted repo is macOS-built (`node_modules` has darwin binaries), so I copied the source tree (working tree plus `.git`, excluding build output and unrelated folders) to a Linux scratch directory and ran `npm ci --ignore-scripts` there.
- Prisma engine binaries are not downloadable from this sandbox (`binaries.prisma.sh` is not on the allowlist). I generated the client with `prisma generate --no-engine` using placeholder engine paths. That is enough for typecheck, lint and the static gates. It is **not** enough to run anything against a database.
- No PostgreSQL is installed, so every DB-backed test and `check:rls` (live half) is **unverified**.
- The scratch copy excluded `outreach/`, `dist*`, `logs/`, `cache/`, `voice-agent-sim/` and `Click-main/`. Two test failures are caused by that exclusion (see §6).
- Git history was scanned with a regex from the mounted repo. This is **not** the TruffleHog scan that CI runs, so it is not a substitute for CI's scan.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| `tsc --noEmit` (typecheck) | **FAIL** — 1 error | `src/server/vapi/vapiWebhook.ts:403` — `Cannot find name 'CarrierId'`. The line is in the uncommitted diff (HEAD spells the type inline). |
| `eslint` (lint) | **FAIL** — 3 errors, 145 warnings | Errors: `src/server/frontDesk/queueEngine.ts:446` (no-fallthrough, uncommitted case added at :443); `src/services/guardrails/transcriptRedaction.ts:76` ×2 (no-useless-escape, uncommitted). Warnings: 110 non-null assertions, 35 `console` calls. |
| `npm test` (Vitest, 2,168 tests, sharded ×6) | 1,861 pass, 29 fail, 275 skip, 3 todo | Failures are environmental (no PostgreSQL) plus 2 caused by my copy excluding `outreach/`. See §6. |
| `check:api` | **PASS** | 97 UI/desktop paths covered, 25 server mounts match allowlist. |
| `prisma validate` | **PASS** | One warning: `onDelete: SetNull` on a required reference (schema). |
| `check:rls` | **UNVERIFIED** | Needs `DATABASE_URL`. The script correctly exits 1 without it (no false pass). Static half: 56 tenant models. My brace-aware parse agrees with the script's regex (56/56). |
| `verify-all.sh` | **UNVERIFIED** (not run) | Needs PostgreSQL 16 and Docker or apt. Neither is available here. |
| Secret scan (history, regex) | **Flags** — see F30, F29 | Not TruffleHog. |
| `npm audit --omit=dev` | 5 high, 10 moderate, 2 low | See F31. |

## Findings

Severity: **Critical** (blocks pilot, could expose PHI or move money wrongly) · **High** (must fix before pilot) · **Medium** (fix before scale) · **Low** (hygiene). "UNVERIFIED" means I could not confirm the behaviour in this environment.

### 1. Multi-tenant isolation

**F1 — High. Six PHI-bearing tables have no tenant column and no RLS policy.**
`prisma/schema.prisma:325` PatientBenefits, `:344` BenefitCoverage, `:362` PlanYear, `:374` EligibilityCall, `:1340` InsurancePlan, `:1456` ReconciliationLog. These are keyed by `patientToken`, `patientId`, or `claimId`, and none has a `practiceId`. They are on the RLS allowlist (`scripts/check-rls-coverage.mjs:36-46`). The migration header (`prisma/migrations/20260926200000_multi_practice_rls_coverage/migration.sql:13-20`) says a join-based policy "needs its own dedicated pass". So isolation for this PHI depends entirely on application code filtering every query.
*Fix:* add practice columns or join-based policies for these six tables. Until then, add a test that fails if any query on these models is not practice-joined.

**F2 — High. `app.rls_bypass` is a tenant-wide escape hatch used in 15 files.**
`src/server/db/rlsContext.ts:22-24`; `src/lib/prismaRls.ts:29`; the helper `app_rls_practice_allowed` returns true for any bypass (`prisma/migrations/20260712000000_rls_and_phi_vault_practice/migration.sql:32-43`). Callers include the whole Vapi webhook (`src/webhooks/vapi.ts:72-90, 196-247, 434, 538-560`), `src/server/middleware/authenticateConnector.ts:31`, `src/server/frontDesk/queueEngine.ts:490-503`, GoCardless, pre-visit and claims-validator webhooks. Any bug inside a bypass block reads or writes every tenant.
*Fix:* replace broad bypass with narrow, named operations (for example SECURITY DEFINER functions that return only the fields a webhook needs). Log each bypass with a reason. Add an allowlist test that fails on new bypass call sites.

**F3 — High, UNVERIFIED. Interactive transactions may run outside the RLS context.**
`src/lib/prismaRls.ts:27-35` wraps each operation in `base.$transaction(ops)`, where `base` is the non-transactional client. Operations issued inside the 22 `prisma.$transaction(async tx => …)` sites may therefore set `app.practice_id` on a different connection from the one that runs the query. The likely result is fail-closed (reads return zero rows, writes fail `WITH CHECK`), but that breakage would be silent. `tests/rls.strict.test.ts` would show it, but it needs a database.
*Fix:* run the set_config inside the caller's transaction (pass `tx` through the extension), and add a strict-RLS test that runs an interactive transaction.

**F4 — Medium. Connector token lookup scans 200 agents across all practices and bcrypt-compares each one.**
`src/server/services/desktopConnectorService.ts:23-35` (`findMany` with `take: 200` at `:29`, `bcrypt.compare` per row); hashing cost 12 at `:13`. Two effects: (a) agent 201 onward can never authenticate, so this causes an outage as the fleet grows; (b) every invalid bearer token costs up to 200 bcrypt comparisons, which is an unauthenticated CPU-amplification path. The timing estimate is UNVERIFIED.
*Fix:* issue tokens as `<agentId>.<secret>`, look up the agent by id, and compare once. Rate-limit `/connector` auth failures.

**F5 — Medium. Policy checks don't prove predicate correctness.**
`scripts/check-rls-coverage.mjs` checks only that FORCE RLS is on and that at least one policy exists. It doesn't check what the policy allows. Also, its model regex (`/model\s+(\w+)\s*\{([^}]*)\}/g`) stops at the first `}`, so a `{}` default inside a model body can silently drop that model from the check. Today the count matches (56/56), but `prisma/schema.prisma:1847` (`@default("{}")`) is exactly the pattern that would break it. Sequence this gate after F1.
*Fix:* parse the schema with the Prisma DMMF instead of regex, and add policy-behaviour tests against a live DB.

**F6 — Low. Session-scoped bypass in seed.** `src/server/seed.ts:13` sets `app.rls_bypass` with `is_local=false`. If the seed runs inside the server process, the flag persists on the pooled connection. Use `true` (transaction-local).

### 2. PHI handling

**F7 — High, UNVERIFIED. Post-call "deletion" removes only the recording, not the transcript or the call record at Vapi.**
`src/services/pii-vault.ts:255-262` calls `DELETE /call/{id}/recording`. Nothing in this path deletes Vapi's stored transcript, messages or analysis. Ephemeral PHI is also sent as `variableValues` in `assistantOverrides` (`src/vapi/client.ts` around lines 420-455: `patient_name`, `patient_dob`, `policy_number`, and so on). CLAUDE.md says PHI is "deleted from Vapi post-call". The repo's own test records this as unverified: `tests/vapiSquadConfig.test.ts:117` (`it.todo('whether Vapi actually deletes call recordings post-call…')`).
*Fix:* confirm Vapi's retention for transcripts, messages and analysis. Disable transcript storage if it's not needed, or delete the call's logs through the API. Write the result into `docs/compliance/PHI-VAPI-BOUNDARY.md`.

**F8 — High. Transcripts persist with pattern-only redaction when the vault token has expired.**
`src/services/guardrails/transcriptPersist.ts:39-54`: when detokenize fails, `phi` stays null, and the transcript is saved to `CallAttempt.transcriptText` (`prisma/schema.prisma:1090`) after regex-only redaction. Patient names spoken on the call are not caught by the regex. The code comment calls this a deliberate choice. It is a decision for the owner, but it conflicts with the PHI boundary rule.
*Fix:* when `phi` is null, store `transcriptText: null` and set a `redactionIncomplete` flag, or add a name-detection pass.

**F9 — Medium, UNVERIFIED. Structured estimate logs store the full request.**
`src/routes/eligibility.ts:118-125` writes `requestJson: estimateRequest` (includes `patientId` from the caller and the eligibility snapshot) and `resultJson` into `EligibilityEstimateLog` (`prisma/schema.prisma:394`). I did not confirm which fields inside the snapshot are patient identifiers.
*Fix:* persist a token-only request, or run the PHI field list over the JSON before write.

**Positive:** the logger denylist (`src/server/observability/logger.ts:52-…`) covers the common PHI field names. I grepped SMS and notification paths and logger calls for patient fields and found none. The `initiateCall` dial allowlist (`src/vapi/client.ts` around lines 355-370) refuses any number that isn't a known carrier line.

### 3. Vapi squad, IVR, hold, carrier block

**F10 — High. CARRIER_BLOCK is scoped to one practice, not to the carrier.**
`src/carriers/adapter.ts:219-296` (`checkCarrierBlock`) reads only this practice's own block plus its organization siblings. `src/server/frontDesk/carrierBlockService.ts:29` writes one `carrierBlockEvent` per practice. `src/server/vapi/vapiWebhook.ts:273-278` logs "suspending **ALL** calls to this carrier immediately" but creates a row for one practice only. CLAUDE.md says a detected block suspends "all calls to that carrier — not just the current call." The fleet-wide concurrency ceiling (`checkCarrierConcurrency`) exists, but there is no fleet-wide block. Today the code and the documented rule disagree, and the log line overstates what happens.
**Decision (owner, 2026-11-23):** a block applies to the practice that tripped it, plus its organization siblings as the code already does. It must not block other practices. Align the log message (`vapiWebhook.ts:273`) and the CLAUDE.md wording ("all calls to that carrier") to this scope. Recommended companion: when a block fires, page ops and cap the fleet-wide concurrency ceiling for that carrier for a cooldown period. That protects the shared carrier relationship without halting unaffected practices. The cap is a suggestion for the owner to approve.

**F11 — High. Claim-age gates use a snapshot that is never refreshed.**
`src/carriers/adapter.ts:456` (`daysOutstanding < 30` → CLAIM_TOO_YOUNG), `:469` (`> 90` → ESCALATE_OVER_90). The queue passes the stored value (`src/server/frontDesk/queueEngine.ts:727, 947`). The value is written at import time (`src/server/pms/prismaClaimImporter.ts:81`, `src/server/csv/industryClaimImport.ts:133`). I found no job that increments or recomputes it. Result: a claim imported at 10 days stays at 10 and is never dialed until re-imported. A claim imported at 85 days is dialed on day 120 without the 90-day escalation firing. Both break the documented rules.
*Fix:* compute age at dispatch from `submittedAt` (already available: `queueEngine.ts:949`), and add a test that advances the clock.

**F12 — Medium. The call window is checked only at the start of each tick.**
`src/server/frontDesk/queueEngine.ts:486` checks `isWithinCallWindow()` once per tick. The per-claim late guard (`:978`) re-checks CARRIER_BLOCK only, not the window. A slow tick can dial after 17:00 Eastern. The magnitude is UNVERIFIED. Separately, `src/carriers/adapter.ts:487` hard-codes 08:00–17:00 and ignores the practice's `callWindowStart`/`callWindowEnd` settings (`src/types/practiceSettings.ts:9-10`), so those settings have no effect on dispatch. `callWindowForced()` (`adapter.ts:578-582`) is blocked only when `NODE_ENV=production`. A staging environment with `COLLECTRX_FORCE_CALL_WINDOW=1` will dial at any hour.
*Fix:* re-evaluate the window in the late guard. Remove the forced-window flag, or require a separate environment marker.

**F13 — Medium. Block detection can fire on LLM-written text and on learned phrases.**
`src/outcome/processor.ts:336`: the block scan runs over transcript, `analysis.summary` and `successEvaluation`. A hallucinated summary can therefore trigger a practice-wide block. `src/server/frontDesk/carrierBlockPhrases.ts:7-17` is a substring list, and `:24-35` merges learned phrases from the self-tuner at runtime. I found no human gate on that merge (UNVERIFIED).
*Fix:* auto-block only on transcript evidence. Put learned phrases behind review.

**Positive:** the final CARRIER_BLOCK check runs just before the dial (`src/server/frontDesk/queueEngine.ts:978`; `src/routes/insurance.ts`, the manual trigger, around line 850). The idempotency key is `claimId:attempt` (`queueEngine.ts` around line 958). The Vapi HMAC uses `timingSafeEqual` (`src/webhooks/vapi.ts:112-124`).

**Not verified:** IVR navigation accuracy, hold handoff latency and the Claims_Agent disclosure. The repo's own tests mark these as `todo` (`tests/vapiSquadConfig.test.ts:115-116`). `src/webhooks/holdTransitionProcessor.ts` was not audited in depth.

### 4. Outcome classification and billing

**F14 — High. "Lifetime AR recovered" counts unpaid closures as recovered.**
`src/server/plans/usagePeriodService.ts:779-781` sums `billedAmount − outstandingAmount` over RESOLVED claims. Human and triage resolutions zero `outstandingAmount` with no payment evidence (`src/server/recovery/transitionClaimRecovery.ts:235` and `:331`). So a claim closed without payment counts as its full billed amount. The payment-verification path explicitly refuses to do this (`src/server/recovery/paymentVerification.ts:60-75`), so the two paths disagree. The number is shown to practices at `src/pages/PracticeBillingPage.tsx:475`.
*Fix:* compute recovered amounts only from evidence-backed payment records. Until then, relabel or hide the tile.

**F15 — Medium. Dead function with inverted meaning.** `recoveredCentsForClaim` (`src/server/plans/usagePeriodService.ts:788-793`, re-exported at `src/server/plans/planBridge.ts:267`) returns the remaining `outstandingAmount` as "recovered". I found no callers. Delete it.

**F16 — Medium. Minute metering is check-then-act.** `src/server/plans/usagePeriodService.ts:444` checks `minutesBilled != null` outside the transaction; the transaction at `:469` then increments usage unconditionally. Two concurrent end-of-call processings could both pass the check and double-count. The webhook-level dedupe (bodyHash) probably prevents this for Vapi retries, but the desk path (`src/server/frontDesk/vapiDeskEvents.ts:305`) may run separately. UNVERIFIED. Also, two functions named `recordCallUsage` exist (`planBridge.ts:253` and `usagePeriodService.ts:436`).
*Fix:* do a conditional `updateMany where minutesBilled IS NULL` inside the transaction and increment only when the count is 1.

**F17 — Low. Unwired billing modules.** `src/server/plans/trialClock.ts` (`trialEndOnReady`) and `src/server/plans/holdCredit.ts` (`creditableMinutes`) are untracked and their own comments say "not wired in". They are dead code under the PRD standard.

### 5. Auth, secrets, dependencies

**F18 — High (conditional). Public fallback JWT signing key outside production.**
`src/server/authToken.ts:15-22`: when `NODE_ENV !== 'production'` and `JWT_SECRET` is unset, tokens are signed with the literal `'dev-collectrx-jwt-not-for-production'`. That string is in the public repo. `assertJwtConfigAtStartup` (`:28-33`) also checks only production. Any staging or misconfigured environment accepts forged tokens.
*Fix:* require `JWT_SECRET` in every environment except the test runner, and fail startup.

**F19 — Medium. Vapi static-secret path is weaker than the HMAC path.**
`src/webhooks/vapi.ts:378-385`: `x-vapi-secret` is compared with `===` (not constant-time). It is the same value as the HMAC key, `VAPI_WEBHOOK_SECRET`, and when it matches, the request is accepted without an HMAC. There is no timestamp or nonce, so replay protection depends only on body-hash dedupe.
*Fix:* use a separate secret for the tool header, compare it with `timingSafeEqual`, and add a timestamp window.

**F20 — Medium, UNVERIFIED. Cookie auth with cross-site mode and no CSRF control.**
`src/server/authToken.ts:41`: `sameSite: 'none'` when `AUTH_COOKIE_CROSS_SITE` is set. I found no CSRF token middleware in `src/server` (`grep -i csrf` returned nothing). Whether the body parser and CORS allowlist limit this is UNVERIFIED; I did not test exploitability.
*Fix:* add an Origin check or CSRF token on cookie-authenticated mutations.

**F21 — Medium. Committed Stripe test-mode key.** `sk_test_<redacted>` appears in `src/server/learning/selfTuner/ruleApplicator.ts:103`, `scripts/run-agents.mjs:147`, `tests/app.integration.test.ts:16`, `vitest.config.ts:14`, `SECURITY.md`, and in history (for example `3e6884f`). It is test-mode, so real exposure is low. It still breaks CLAUDE.md rule 4 ("no credentials anywhere").
*Fix:* replace with an env var or a generated placeholder.

**F30 — Medium, owner action. Literal Postgres credential in history.** Commit `dec3c98` contains `postgresql://<user>:<redacted>@…`. It is not in the current tree. CLAUDE.md says a credential in history stops work until the owner picks a remedy. The owner should confirm whether the password was ever real and whether it is still used. Then choose: rotate, or rewrite history.

**F31 — High (availability). Production dependency advisories.** `npm audit --omit=dev`: 5 high, 10 moderate, 2 low. High: `body-parser` (locked 1.20.6; advisory ≤1.20.8, reached through Express), `follow-redirects` (locked 1.16.0), `joi` (locked 18.2.9; advisory 18.0.0–18.3.0), `multer` (direct, range `^2.4.0`; advisory 2.0.0–2.4.0, so the lock is inside it, and I did not confirm the exact locked version), `zod` (locked 4.4.3; advisory <4.6.6). Moderate includes `express` 4.22.2 and `nodemailer` 10.0.15. The advisories are mostly DoS, but the body-parser and multer ones sit on public endpoints.
*Fix:* bump `joi`, `zod`, `multer`, `express` (with body-parser) and `nodemailer`, then rerun the audit.

**Lint and PRD-standard debt (not blocking, but a standing rule):** 110 non-null assertions and 35 `console` calls are warnings. No explicit `any` in non-test `src` (the one regex hit, `src/vapi/circuitBreaker.ts:204`, is a comment), so the "zero any" rule holds.

### 6. Tests and the simulation harness

**What ran:** 2,168 tests in 6 shards. 1,861 passed, 29 failed, 275 skipped, 3 todo.

**Failures, by cause:**
- 2 in `tests/importDentalProspects.test.ts`: caused by my copy excluding `outreach/`. Not a repo defect. Re-run in the mounted repo.
- 1 file-level failure in `tests/workflowDispatchSafetyRules.test.ts`: this suite throws when no database is reachable. That is intentional (`:27-28`) and is the right behaviour.
- 10 in `tests/callQualityScorer.test.ts` (Prisma against no DB), 14 in `tests/webhookSecurityValidator.test.ts`, 3 in `tests/security/immutableAuditLog.test.ts` (`InvalidDatasourceError`: no DB).
All 29 failures are environmental. None of them is a verified code defect. They need a real run.

**Skipped safety coverage (silent green without a DB):**
- `tests/rls.test.ts:215` and `:295` use `describe.skipIf(!dbReady…)`, and `:37-44` only logs a warning when the DB is unreachable. The RLS isolation tests therefore pass without running.
- `tests/carrierBlockE2E.test.ts:150, :233, :313` (tenant isolation, real queue tick, manual call-now route) skip the same way.
- `tests/queueEngineFairnessAndLease.test.ts` skips the lease and fairness tests.
CLAUDE.md says "a step that passes only because it silently didn't run is a false pass." These suites should fail, as `workflowDispatchSafetyRules` already does.
*Fix:* apply the loud-failure pattern to every safety suite and make CI require a DB.

**What the tests prove vs. simulate:**
- They prove: pure logic (tier gates, outcome classification, webhook shape, adapter guards). These run without a DB and mostly pass.
- They do not prove: RLS isolation, carrier-block end-to-end, queue dispatch under the lease, idempotency under concurrency, or audit-chain integrity. These need PostgreSQL.
- They simulate only: Vapi and carrier behaviour. `tests/vapiSquadConfig.test.ts` validates configuration, not calls. The three `todo` items (real IVR accuracy, handoff latency, recording deletion) are the real unknowns.
- `voice-agent-sim/` (outside the scratch copy) holds dated protocols and run logs. I listed the first 11 entries (all markdown). I did not confirm whether an executable harness exists there.

## Ranked: what blocks a first supervised pilot

1. **Fix the working tree so the gates pass, then commit.** Typecheck fails (`vapiWebhook.ts:403`) and lint fails (`queueEngine.ts:446`, `transcriptRedaction.ts:76`). Both come from the uncommitted diff. Pilot code must be a clean, committed, gated state (CLAUDE.md).
2. **Align CARRIER_BLOCK wording (F10) to the per-practice scope.** Fix the log message and CLAUDE.md. Consider the fleet-wide cooldown cap as a separate, approved change.
3. **Fix claim-age gates (F11).** Compute age at dispatch. Without this, the 30-day and 90-day rules can't be relied on.
4. **Resolve PHI retention at Vapi (F7) and the transcript fallback (F8).** Confirm what Vapi keeps, and fail closed when the vault token is gone.
5. **Correct "Lifetime AR recovered" (F14)** or hide it before a practice sees it.
6. **Confirm RLS on a real database (F3, F1, F2).** Run `check:rls` live, make the strict RLS suite and carrier-block E2E run (not skip), and fix the six non-RLS PHI tables or gate their access by test.
7. **Require `JWT_SECRET` everywhere (F18)** and confirm the pilot environment sets `NODE_ENV=production`.
8. **Make the safety suites fail loudly without a DB (§6)** so CI cannot pass by skipping.
9. **Fix connector token auth (F4)** before adding practices, since agent 201 currently cannot log in.
10. **Upgrade the advisory-flagged dependencies (F31).**
11. **Close the minute-metering race (F16) and harden the Vapi shared secret (F19).**
12. **Owner decisions:** the history credential (F30), the test-key rotation (F21), and whether the self-tuner may extend block phrases without review (F13).

## Not verified in this audit

- Any live-database behaviour: RLS policies, the interactive-transaction question (F3), carrier-block E2E, queue leases, idempotency under concurrency, audit-chain integrity. All need PostgreSQL 16 (`scripts/verify-all.sh`).
- Vapi-side retention of transcripts and analysis (F7), and whether recordings are actually deleted.
- Carrier-side behaviour: IVR accuracy, hold handoff, and the CRTC disclosure timing.
- Exploitability of F20 (CSRF) and the timing estimate in F4.
- TruffleHog-level secret detection. My history scan was regex-only.
- Whether HEAD (without the uncommitted diff) passes typecheck and lint. I ran only the working tree.

---

## Remediation status (2026-11-23, feature branch work, uncommitted)

| Item | Change | Status |
|---|---|---|
| F10 CARRIER_BLOCK scope | Per-practice log text (`vapiWebhook.ts`); root and `Collect-RX-main/CLAUDE.md` wording now per practice plus organization siblings; test `tests/carrierBlockScope.test.ts` | Fixed, 3/3 tests pass |
| F11 claim age | `claimAgeDays()` in `adapter.ts` counts from `submittedAt`, falls back to snapshot; wired in `queueEngine.ts` (2 sites) and `routes/insurance.ts`; test `tests/claimAgeAtDispatch.test.ts` | Fixed, 4/4 tests pass. Assumes `submittedAt` is the claim's submission date (not verified against CSV import semantics) |
| Typecheck error | `vapiWebhook.ts` `CarrierId` type reference qualified | Fixed |
| Lint no-fallthrough | `queueEngine.ts` settle switch consolidated | Fixed |
| Lint no-useless-escape | `transcriptRedaction.ts` phone regex | Fixed |
| DB-dependent tests fail or skip silently | `npm test` now runs `scripts/test-with-db.mjs`, which uses an existing `DATABASE_URL` or provisions embedded PostgreSQL 16 and sets `COLLECTRX_REQUIRE_DB=1`; `tests/support/dbGuard.ts` (Vitest `globalSetup`) fails the run when the DB is unreachable; `test:raw` keeps the bare runner; `rls.strict.test.ts` prefers `RLS_APP_DATABASE_URL` (non-superuser) | Guard verified (fails loudly with no DB). Wrapper provisioning verified up to migrations; `prisma migrate deploy` blocked in the audit sandbox (engine download 403), so the full DB suite is UNVERIFIED here |

### Gate results

| Gate | Status | Evidence |
|---|---|---|
| `tsc --noEmit` | Pass | 0 errors, scratch copy synced from the working tree |
| `eslint "src/**/*.{ts,tsx}"` (project `lint` script) | Pass | 0 errors, 145 pre-existing warnings |
| `eslint tests/` | Fail (pre-existing, not in `lint` script) | 111 errors across older test files; not gated by CI lint |
| New unit tests | Pass | 7/7 |
| Full Vitest suite with database | UNVERIFIED | Needs migrations; run `npm test` on a machine with Prisma engine access or in CI |
| `npm run check:rls`, `check:api` | UNVERIFIED | Not run in this session |
| `npx prisma validate` | UNVERIFIED | Not run in this session (engine download blocked) |
| Secret scan of diff and branch history | UNVERIFIED | Not run in this session |

### Notes for the owner

- `npm test` now provisions a database when `DATABASE_URL` is unreachable. In CI, set `DATABASE_URL` to the service container so the wrapper uses it. Without it, the first run installs embedded PostgreSQL from npm.
- `vitest.config.ts` still hardcodes the Stripe test key and the Vapi test secret (F21). Unchanged here.
- Nothing is committed or pushed. The working tree still holds the earlier uncommitted WIP on `feat/staff-conference-handoff`.
