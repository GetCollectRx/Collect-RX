# Shippability backlog — multi-practice readiness

**New file.** The audit brief that requested this document asked to read it first, along with
`SHIPPABILITY-AUDIT-2026-09-25.md`, `docs/operations/RLS-ROLE-RUNBOOK.md`, and
`.unlazy/ship-013/GATES.md`. None of those four existed anywhere in this repository's history
before this audit (`.unlazy/sell-readiness/GATES.md` and `.unlazy/sell-readiness-fix/GATES.md`
existed on other branches; the exact paths requested did not). Per `CLAUDE.md`'s own documented
authority order, the actual live tracker is [`docs/operations/PATH-TO-DELIVERY.md`](docs/operations/PATH-TO-DELIVERY.md)
and the reference backlog is `OUTSTANDING-FIXES-PRODUCT-READY.md`. This file is created fresh to
hold the readiness findings from the 2026-09-25 multi-practice audit; it does not supersede either
of those.

Status legend: **DONE** (fresh evidence this pass), **IN PROGRESS** (implementation exists, verification incomplete or partial), **BLOCKED** (needs external creds/infra/legal/prod access).

---

## P0 — blocks MULTI-PRACTICE READY

### P0-01 — 31 tenant-scoped tables have no RLS policy at all
**Status: IN PROGRESS** (finding is new; no fix landed yet)

Cross-referencing `prisma/schema.prisma` (models with a `practiceId`/`organizationId` column)
against live `pg_class`/`pg_policies` on a fully-migrated local Postgres 16 (77/77 migrations
applied, verified twice — see migration rehearsal results in the audit report) shows 31 tables
that are tenant- or org-scoped by schema but carry no RLS policy, `relrowsecurity=false`,
`relforcerowsecurity=false`. Includes `User`, `pad_mandates`, `pad_transactions`,
`organization_members`, `organization_sso_configs`, `org_sso_events`, `org_compliance_exports`,
`InviteToken`, `QueuePriority`, `RuleSet`, `auditor_grants`, `csv_import_logs`,
`eligibility_snapshots`, `CarrierOrder`, `EligibilityEstimateLog`, `EligibilityReconcileLog`,
`PmsWritebackLog`, `organization_practices`, `platform_admin_practice_grants`, `platform_users`,
`phipa_breach_notifications`, `phipa_deletion_requests`, plus the eligibility-engine detail tables
(`annual_max_tracking`, `deductible_tracking`, `reconciliation_logs`, `BenefitCoverage`,
`EligibilityCall`, `PatientBenefits`, `PlanYear`, `insurance_plans`) and `Practice` itself.

For all of these, tenant isolation rests entirely on every Prisma call site remembering an
explicit `where: { practiceId }` — confirmed by reading `src/lib/prismaRls.ts`: the RLS session
variable (`app.practice_id`) is set on every request, but it is inert on a table with no policy.

Two of the 31 are not live-risk: `RuleSet` carries an explicit schema comment marking it dead code
("not referenced anywhere in src/ outside this schema file"), and `QueuePriority` has zero
non-test `prisma.queuePriority.*` call sites in `src/` — confirmed this pass. The remaining 29,
including `User`, both PAD financial tables, and all four org/DSO tables, are read and written by
live production code (spot-checked via `prisma.<model>.` call-site counts).
`docs/operations/DSO-SCALE-VERIFICATION-2026-08-04.md` (line 50) claims the newer org tables
"inherit scoping through existing practiceId foreign keys" — that claim is incorrect; a foreign
key is not a policy, and this pass found no policy on `organization_members`,
`organization_practices`, or the two `InviteToken`-adjacent org tables.

No CI check or script anywhere in `tests/` or `scripts/` asserts "every table with a
`practiceId`/`organizationId` column has `relforcerowsecurity=true` and at least one policy" —
that's the structural gap that let this drift in one migration at a time since
`20260712000000_rls_and_phi_vault_practice` (which only force-enabled RLS on 3 tables) as later
migrations added tenant tables ad hoc.

**Fix shape:** (1) add RLS + FORCE RLS + a `practice_id = current_setting('app.practice_id')::uuid`
policy (mirroring the existing 68 covered tables) to each table above that has live production
code paths — `User`, PAD financial tables, and the org/DSO tables are the highest-risk subset;
(2) for `phipa_breach_notifications`/`phipa_deletion_requests`, no production code reads or
writes them yet (confirmed — see `docs/operations/HUMAN-DECISIONS-PENDING.md` item 2), so this is
lower urgency until that feature is built; (3) add a CI check (a script over
`pg_policies`/`pg_class` post-migration, comparable to `check-api-coverage.mjs`) that fails the
build if a `practiceId`/`organizationId`-bearing table lacks FORCE RLS + a policy, so this can't
silently recur.

### P0-02 — Production DB role for RLS has never been verified
**Status: BLOCKED** (needs prod Fly Postgres credentials — not engineering work)

Already tracked in detail in `docs/operations/HUMAN-DECISIONS-PENDING.md` item 3 — restated here
because it's load-bearing for the MULTI-PRACTICE READY decision. The runtime guard
(`src/server/db/rlsRoleGuard.ts`) is real, shipped, and covered by 13 mocked unit tests, but it
only reports the role's safety the next time the app boots — nobody has run the two verification
queries against the actual production `DATABASE_URL` role. Running this pass's equivalent check
against local dev found the `collectrx` role (this repo's dev-DB owner) genuinely **is** a
superuser — exactly the failure class the guard exists to catch — which is a live demonstration
of how easily this slips, not evidence about prod itself.

**Fix:** whoever holds Fly Postgres prod credentials runs the two queries in
`HUMAN-DECISIONS-PENDING.md` item 3 once and records the result with a date.

### P0-03 — No automated coverage that every tenant table stays RLS-covered
Same root cause as P0-01; listed separately because the fix is a standing CI gate, not a one-time
migration. See P0-01's fix shape, item 3.

### P0-04 — `npm ci` cannot satisfy `archiver`'s `buffer-crc32` dependency; DSO compliance export returns 500
**Status: IN PROGRESS** (root cause identified this pass; not yet fixed)

`GET /api/group/compliance/export/v2` (the DSO/org compliance zip export) fails with a 500 on a
clean, current install. Root cause, confirmed directly: `archiver@8.0.0` (used to build the export
zip) requires `buffer-crc32` at runtime (`archiver/lib/plugins/json.js`), but
`package-lock.json` (lockfileVersion 3, current HEAD) has **no** `node_modules/buffer-crc32` entry
anywhere, despite `archiver`'s own lockfile entry declaring `"buffer-crc32": "^1.0.0"` as a
dependency (line 6161 of the current lockfile). A fresh `npm ci` from this lockfile — exactly what
CI's `verify`/`e2e`/`perf-smoke` jobs and this audit both ran — cannot resolve the package, so any
code path through `archiver` throws `Cannot find package 'buffer-crc32'`
(`ERR_MODULE_NOT_FOUND`) and the route 500s. Reproduced deterministically both inside the full
suite and in complete isolation (`tests/orgComplianceExport.test.ts` alone). The most recent commit
on this branch (`a65f407 Update dependencies for production audit`) is the likely point this
lockfile entry went missing — worth checking that commit's diff specifically.

**Fix:** regenerate the lockfile (`npm install` to repair, or explicitly add `buffer-crc32` back)
and confirm `npm ci` + `tests/orgComplianceExport.test.ts` both pass from a clean install before
merging. This is a release gate, not a flaky test — every fresh install of this exact lockfile will
fail the same way, including CI.

### P0-05 — Two DB-lease/locking tests fail deterministically in isolation (not load-related)
**Status: IN PROGRESS** (confirmed reproducible; root cause not fully isolated this pass)

Two tests fail 100% of the time when run completely alone (no concurrent load, no other test
files running), ruling out flakiness or resource contention as the cause:

- `tests/queueEngineFairnessAndLease.test.ts > claimTickLease — fleet-wide distributed lock >
  allows reclaiming a stale (expired) lease` — expects `claimTickLease()` to return `true` when an
  existing lease's `locked_until` is 60s in the past (a "dead instance" scenario). Fails with
  `false`. Verified the underlying SQL logic is correct by hand-running the equivalent raw
  `INSERT ... ON CONFLICT ... WHERE locked_until < now()` directly in `psql` against the same
  database — it reclaims the lease correctly. The gap is therefore somewhere between the Prisma
  client path (`claimTickLease()` in `src/server/frontDesk/queueEngine.ts`) and that same SQL, not
  in the SQL itself. This directly contradicts
  `docs/operations/DSO-SCALE-VERIFICATION-2026-08-04.md`'s claim that "a stale lease from a
  crashed process is reclaimable" — that claim needs to be re-verified, not assumed, given fresh
  evidence.
- `tests/webhookValidation.test.ts > Stripe webhook validation > idempotent — duplicate event
  processed only once` — first call's `res1.body.handled` is `undefined`, not `true`. The test's
  synthetic event uses a `price.id` (`price_idempotent_test`) with no corresponding
  `STRIPE_PRICE_*` mapping configured — plausible that the `customer.subscription.updated` handler
  only sets `handled: true` (and, if so, may only *record* the event for idempotency) when the
  price resolves to a known tier, which would mean an event referencing an unrecognized price
  isn't idempotency-protected. Not fully root-caused this pass — flagged with the specific
  reproduction so engineering can confirm.

**Fix:** engineering time to trace `claimTickLease()`'s actual generated SQL/params vs. the
hand-verified raw query, and to read the `customer.subscription.updated` handler's early-return
paths for the unmapped-price case. Re-run both tests in isolation after any fix — they were
reproducible enough that flaky-test theories can be ruled out immediately.

---

## P1 — should fix before broad multi-practice rollout

### P1-01 — No explicit Prisma connection-pool sizing; observed a real pool timeout under concurrent test load
`PrismaClient` (`src/lib/prisma.ts`) is instantiated with no `connection_limit`/`pool_timeout`, and
`DATABASE_URL` (`.env.example`, Fly secrets per docs) carries no `?connection_limit=` query param
anywhere in the repo — the app runs on Prisma's default pool size
(`num_physical_cpus * 2 + 1`), which on a small Fly.io machine can be a handful of connections.
This is compounded by `extendPrismaWithRls` (`src/lib/prismaRls.ts`): every tenant-scoped query is
wrapped in its own transaction to set `app.practice_id` first, turning one logical query into a
2-statement transaction that holds a pool connection for both statements.

Directly observed this pass: running the full test suite back-to-back with the 50-practice/80-tick
load test and the 20-practice DSO concurrency test (both against the same local Postgres) produced
a real `PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the
given time` a few tests later, logged as `[audit] tenant-chain append failed`. The request itself
still succeeded (audit logging is deliberately best-effort/non-blocking here — confirmed correct
per `tests/audit-integrity-remediation.test.ts`'s fail-closed-vs-best-effort split), but the same
pool pressure hitting a **required** (fail-closed) audit path would correctly fail that request
rather than degrade silently — which is the right behavior, but means pool exhaustion under real
multi-practice concurrency could surface as user-visible request failures, not just slow queries.
Postgres server-side `max_connections` was not the bottleneck (100 configured, 6 active at the
time this was checked) — this points at Prisma's client-side pool specifically.

**Fix:** set an explicit `connection_limit` (and `pool_timeout`) on the production `DATABASE_URL`
sized to the target concurrent-practice count and Fly machine's vCPU count, and re-run the
50-practice load test to confirm the timeout doesn't recur at the intended production pool size.

### P1-02 — Global Vapi concurrency budget has no per-practice ceiling
`vapiSlotBudget()` (`src/server/frontDesk/queueEngine.ts`) is a fleet-wide cap
(`VAPI_MAX_CONCURRENT_CALLS`, default 10, minus a 2-slot reserve = 8 by default) shared across
every practice in the system, with per-carrier ceilings (`CARRIER_CONCURRENCY_LIMITS`) but no
per-practice ceiling on top. `orderPracticesByFairness()` bounds *wait time* (every practice gets
a turn within a provable tick bound — verified this pass, see report), but does not bound how many
of the global slot budget a single practice can occupy once it's its turn. A practice with many
simultaneously-ready claims on the same carrier can consume a large share of an 8-slot global
budget in one tick. Not a correctness bug — fairness-of-turn is real and tested — but worth
stating plainly as a capacity/throughput design point: at default settings, 20+ concurrently
active practices are not each getting simultaneous live calls; they're taking turns within a
bounded wait. Confirm this matches the product's actual promise to DSO customers before scaling
past the current pilot size.

### P1-03 — Lint's documented "no non-null assertions" PRD rule is a warning, not an error
`Collect-RX-main/CLAUDE.md` states "No non-null assertions (!) unless there is a proven invariant
— and the reason must be stated" as a non-negotiable PRD rule. The actual ESLint config only
warns on `@typescript-eslint/no-non-null-assertion` (66 of 123 current warnings are this rule) —
it does not error, and CI's lint step only fails on errors. The documented rule and the enforced
gate have drifted apart. Either downgrade the doc to match reality or promote the rule to `error`
and clear/justify the existing 66 instances.

### P1-04 — `publicLimiter` rate limiter is dead code
`tests/rateLimiters.test.ts` itself documents this: the limiter is implemented and unit-tested but
not wired to any route, and the routes it was originally built for don't exist. Either wire it to
the intended route(s) or remove it — an unused rate limiter sitting in the codebase looks like
protection that isn't actually there.

### P1-05 — Electron toolchain requires Node ≥22.12, declared engine is ≥20.10
`package.json` (`engines.node`) and CI's `actions/setup-node@v4` both target Node 20, but
`electron@41.10.4` and several of its transitive deps (`@electron/get`, `@electron/rebuild`,
`node-abi`) require Node ≥22.12.0 (`npm ci` emits `EBADENGINE` warnings for 5 packages). Does not
block the web app or its tests, but the Windows `.exe` desktop build path (AbelDent-connected
practices) is running against an unsupported Node/Electron combination — and this is not just
local: `.github/workflows/collectrx-electron-installers.yml` also pins `node-version: '20'` on all
three of its jobs, so CI's actual Windows `.exe` build runs the same mismatch. Bump that workflow
(and the repo's `engines.node` floor) to Node ≥22.12, or pin Electron back to a version compatible
with Node 20.

### P1-06 — 3 `softDeleteIsolation.test.ts` tests can never run — they test a schema field the `User` model doesn't have
`userSoftDeleteSchemaReady` (`tests/softDeleteIsolation.test.ts`) gates 3 tests ("excludes
soft-deleted users from practice-scoped user lists," "prevent authentication with soft-deleted
user," "preserve AuditLog when user is soft-deleted") on `User` having a `deletedAt` field.
Confirmed directly against `prisma/schema.prisma`: `User` has no `deletedAt` field — deactivation
is via `isActive: Boolean` instead (confirmed live and checked on every request in
`src/server/middleware/authenticate.ts`). These 3 tests will skip on every run, forever, in any
environment, since the schema condition they gate on can never become true without a schema
change nobody has made. Not a security gap in itself (`isActive` deactivation is real and tested
elsewhere), but these 3 tests currently look like passing/present coverage for "user soft-delete
isolation" while structurally never executing — rewrite them against `isActive`, or delete them.

### P1-07 — `dsoLoadCapacity.test.ts` sustained-tick lease-renewal test times out at exactly its 60s budget
Ten sequential real `runDeskQueueTick()` calls against a 20-practice fleet (this test's own
explicit purpose: catch a slow-drift regression across repeated cycles) took slightly over the
test's own `60_000`ms timeout in this environment, twice reproduced. The other two tests in the
same file (single real dispatch tick and a 2-tick double-dispatch check, both against the same
N=20 fleet) completed in 9-11s each in the full-suite run, so this isn't a hard stall — it's ~10
ticks landing right at the timeout boundary. Inconclusive from this pass alone whether that
reflects genuine per-tick latency drift (which is exactly what the test is designed to catch) or
this local machine's Postgres being slower than CI's. Re-run in CI or a properly resourced
environment to get a clean signal before deciding whether to raise the timeout or treat it as a
real perf regression.


---

## P2 — lower priority / informational

### P2-01 — Local dev Postgres had migration-history drift from this branch
Encountered during this audit, not a product bug: a shared local Postgres instance at
`localhost:5433` (used by prior sessions in this repo) had one `_prisma_migrations` row
(`20260925150000_add_practice_vapi_caller_id`) with no corresponding folder in this branch's
`prisma/migrations/`. `prisma migrate status`/`migrate deploy` did not flag or block on it. Not
acted on further since the clean-schema rehearsal (a from-scratch database, this branch's
migrations only) is the trustworthy signal, and it passed. Worth a note for whoever manages shared
local/staging Postgres instances across concurrent worktrees: migration state can drift across
branches sharing one DB instance.

### P2-02 — `npm audit` (full, including dev deps) reports 7 moderate/high advisories
CI's actual gate (`npm audit --omit=dev --audit-level=high` from repo root) is clean — 0
vulnerabilities, reproduced this pass. Running full `npm audit` (dev deps included) surfaces 7
(6 moderate, 1 high): esbuild/vite dev-server request forwarding
(GHSA-67mh-4wv8-2f99) and a uuid buffer-bounds issue reached via Storybook's `@storybook/addon-essentials`.
Both are dev-tooling-only paths (Storybook, Vite dev server), not shipped runtime code, and both
require a breaking major-version bump to fix. Low urgency; track separately from prod-dependency
hygiene.

---

## Test suite — exact counts (full detail in `SHIPPABILITY-AUDIT-2026-09-25.md`)

Full `vitest run` against a fully-migrated local Postgres 16: **228 test files, 1873 tests** — 219
files / 1844 tests passed, 8 files / 17 tests failed, 1 file / 9 tests skipped, 3 tests `it.todo`.
Duration 507s.

Of the 17 failed tests, **11 (in `callQualityScorer.test.ts` and
`workQueueService.staleWorkItem.test.ts`) were an artifact of this audit's own local role setup**
— the default `collectrx` role used for the general suite run wasn't granted `BYPASSRLS`, which
CI's own `verify`/`e2e`/`perf-smoke`/`queue-redis` jobs explicitly do
(`ALTER ROLE prisma BYPASSRLS`) before running the same suite, because ordinary test fixtures
write directly via Prisma outside `runWithRlsContext`. Confirmed by re-running both files against
a role with `BYPASSRLS` granted (mirroring CI exactly) — both pass cleanly. **The other 6 failed
tests are real** — see P0-04, P0-05, P1-00, and the loadtest/dsoHttpLoadCapacity findings above.

## Verified this pass — do not re-flag without new evidence

- `tests/rls.strict.test.ts` passes under a freshly-provisioned `NOSUPERUSER NOBYPASSRLS` role
  mirroring CI's exact recipe, for the tables it covers (`insurance_claims`, `call_dispatch_intents`).
- Clean-schema migration rehearsal: 77/77 migrations apply cleanly to a brand-new empty database (~2.4s).
- Upgrade-schema migration rehearsal: 4 pending migrations apply cleanly to an existing, previously-migrated database (~2.0s).
- `npm run typecheck` (`tsc --noEmit`): 0 errors.
- `npm run lint`: 0 errors, 123 warnings (see P1-02).
- API route coverage (`scripts/check-api-coverage.mjs`): 95/95 UI-referenced `/api` paths covered, 24/24 server mounts on the allowlist.
- Webhook signature verification (`validateHmacSignature`): uses `crypto.timingSafeEqual` with a length check before compare — not vulnerable to timing attacks.
- `authenticate` middleware: re-checks `isActive` and DB-stored `practiceId` against the JWT claim on every request (not just at login), fails closed (503, not open) on a DB error during that check.
- Vapi 5-agent squad, PHI boundary, and CARRIER_BLOCK propagation (including cross-practice, same-organization propagation) all produced correct audit log lines under the 50-practice / 80-tick load test.
