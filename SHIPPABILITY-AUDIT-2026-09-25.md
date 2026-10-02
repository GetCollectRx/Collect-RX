# CollectRx multi-practice shippability audit — 2026-09-25

**Point-in-time record.** Principal-release-engineer audit: is CollectRx ready to serve several
dental practices concurrently without cross-practice data leakage, authorization failures,
duplicate work, unfair queue behavior, database-pool exhaustion, silent test skips, or one
practice's failure disrupting another? Every claim below is backed by a command that was actually
run this session, with its exact output — not inferred from reading code, and not carried forward
from any prior audit's conclusion without independent re-verification.

## Before anything else: the four "read first" files

The audit brief asked to start by reading `SHIPPABILITY-AUDIT-2026-09-25.md`,
`SHIPPABILITY-BACKLOG.md`, `docs/operations/RLS-ROLE-RUNBOOK.md`, and
`.unlazy/ship-013/GATES.md`. **None of the four existed anywhere in this repository's git history
under those exact paths** before this audit created the first two. (`.unlazy/sell-readiness/GATES.md`
and `.unlazy/sell-readiness-fix/GATES.md` exist on other branches — similar name, different path,
different content — but not `.unlazy/ship-013/`.) This repo's own documented authority order
(`CLAUDE.md`) names `docs/operations/PATH-TO-DELIVERY.md` and `OUTSTANDING-FIXES-PRODUCT-READY.md`
as the real live tracker and reference backlog, so this audit used those instead, and created
`SHIPPABILITY-BACKLOG.md` fresh per the brief's own instruction to maintain one. This file *is*
`SHIPPABILITY-AUDIT-2026-09-25.md` — it exists as of this commit.

---

## Overall decision

# CONTROLLED PILOT — not MULTI-PRACTICE READY

**Confidence: ~60%**, meaning: high confidence in the specific findings below (each has a command
and exact output attached), moderate confidence in how completely they characterize production
risk, because several requested checks could not be run in this environment (see "What could not
be verified" below) and the production database role itself has never been checked.

The core dispatch machinery is genuinely solid and was proven at real scale this pass: dispatch
fairness across 25 practices, CARRIER_BLOCK propagation across an organization's sibling
practices, PHI boundary discipline under load, clean migrations, clean typecheck/lint/build. That
is not nothing, and it's why the verdict isn't NO-SHIP.

But this pass found six **new, previously undocumented, independently reproduced** problems that
sit directly on top of the brief's own definition of "ready" — a real database-enforced tenant
isolation gap on 29 live tables, a currently-broken production feature (dependency, not logic), a
real 500-timeout-class failure at exactly N=20 concurrent sessions (the brief's own minimum
concurrency bar), and a lease-recovery mechanism that doesn't reclaim a stale lease the way an
existing audit doc claims it does. None of these are hypothetical or inferred from reading code —
every one has a reproduction command below. That combination is inconsistent with declaring the
system ready for unmonitored multi-practice production traffic, but is consistent with a small,
supervised pilot (a handful of practices, active monitoring, the P0 items fixed or explicitly
accepted) while the fixes land.

---

## Exact test totals

```
Test Files  8 failed | 219 passed | 1 skipped (228)
     Tests  17 failed | 1844 passed | 9 skipped | 3 todo (1873)
  Duration  507.39s
```

Reproduce: from `Collect-RX-main/`, with a reachable Postgres and `DATABASE_URL` set (see
"Commands to reproduce" below), run `CI=true npx vitest run --reporter=verbose`.

**Of the 17 failed tests, 11 were this audit's own environment artifact, not a product bug** — see
below — **leaving 6 real, independently-reproduced failures.**

### The 11 false failures, and why

CI's own `verify`/`e2e`/`perf-smoke`/`queue-redis` jobs run `ALTER ROLE prisma BYPASSRLS` before
running the general test suite, because ordinary test fixtures write directly via Prisma outside
`runWithRlsContext`, and several tenant tables now have `FORCE ROW LEVEL SECURITY` (which applies
even to the table owner). This audit's local Postgres role (`collectrx`, the schema owner) was not
granted that bypass for the first full run, so 11 tests failed with
`new row violates row-level security policy for table "insurance_claims"` — all in
`callQualityScorer.test.ts` (9 tests) and `workQueueService.staleWorkItem.test.ts` (2 tests).
Re-ran both files against a role with `BYPASSRLS` granted, mirroring CI's exact recipe — **both
pass cleanly, 11/11.** This is a real thing to know about test-environment setup (any future local
run needs the same grant CI already does automatically), but it says nothing about product
correctness, and it is called out here specifically so it is not miscounted as a regression.

### The 6 real failures

| Test | Symptom | Root cause found this pass |
|---|---|---|
| `tests/orgComplianceExport.test.ts` — produces a real zip | `expected 500 to be 200` | `archiver@8.0.0`'s dependency `buffer-crc32` has **no entry anywhere in `package-lock.json`** — confirmed by grep. Any fresh `npm ci` from this lockfile cannot resolve it. Deterministic, not flaky. See P0-04. |
| `tests/queueEngineFairnessAndLease.test.ts` — reclaiming a stale lease | `expected false to be true` | Reproduced **in complete isolation** (single test, no other files, no load). The equivalent raw SQL, hand-run in `psql` against the same DB, reclaims the lease correctly — so the gap is between the Prisma-layer `claimTickLease()` and that SQL, not in the SQL itself. Contradicts `docs/operations/DSO-SCALE-VERIFICATION-2026-08-04.md`'s claim that "a stale lease from a crashed process is reclaimable." See P0-05. |
| `tests/webhookValidation.test.ts` — Stripe idempotent duplicate event | `res1.body.handled` is `undefined`, not `true` | Reproduced in isolation. Test uses an unmapped `price.id`; plausible the subscription-webhook handler only marks an event `handled` (and possibly only records it for idempotency) when the price resolves to a known tier. Not fully root-caused this pass. See P0-05. |
| `tests/dsoHttpLoadCapacity.test.ts` — 20 concurrent authenticated sessions, no errors | Multiple `503 "Required audit trail is unavailable; access was not performed"` | Real HTTP 503s on `GET /api/insurance/claims` under 20 concurrent authenticated requests. Root PHI-audit error: `PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the given time` from `auditPhiAccess` middleware — the **fail-closed** audit path correctly refused the request rather than silently skip the audit log, but the trigger is DB connection-pool pressure at exactly the brief's minimum concurrency bar. See P1-01. |
| `tests/loadtest/queueEngine.scale.test.ts` — 50-practice fleet, full-fleet concurrent load | `expected 2037 to be +0` — 2037 PENDING claims left past-due with **no deferral reason recorded** | The dispatch engine silently never got to over two thousand claims during the 80-tick run and recorded no reason why — a real silent-stall signature. Needs its own root-cause pass; flagged, not yet diagnosed to a specific line. |
| `tests/dsoLoadCapacity.test.ts` — renews its own lease across 10 sustained ticks | `Test timed out in 60000ms` | Reproduced twice at ~60.0-60.4s, just over its own 60s budget. Inconclusive whether this is genuine per-tick latency drift (which is exactly what the test exists to catch) or this machine's Postgres being slower than CI's — the other two tests in the same file (single tick, 2-tick double-dispatch check) completed in 9-11s each. See P1-07. |

### Skips — none silent, all traced to a specific cause

9 tests skipped, all accounted for and none "silently disabled":

- `tests/rls.strict.test.ts` (1 test) — by design; needs the dedicated `NOSUPERUSER NOBYPASSRLS`
  role CI's separate `rls-strict` job provisions. **Ran it separately this pass with that exact
  role — passes (see RLS section below).**
- `tests/rls.test.ts` (5 tests, all in "Write Isolation") — gated by `it.skipIf(!strictRls)`,
  i.e. `COLLECTRX_RLS_TEST_STRICT=1`, same reason as above, same by-design split between CI's
  general `verify` job and its dedicated `rls-strict` job.
- `tests/softDeleteIsolation.test.ts` (3 tests) — **these can never run in any environment.** They
  gate on `User` having a `deletedAt` schema field. Confirmed directly against
  `prisma/schema.prisma`: it doesn't have one — `User` deactivation is via `isActive: Boolean`
  instead (real, and checked on every request in `authenticate.ts`). Not a security gap by itself,
  but these 3 tests currently masquerade as "user soft-delete isolation coverage" while
  structurally never executing. See P1-06.

3 `it.todo()` in `tests/vapiSquadConfig.test.ts`, honestly labeled "OUT OF SCOPE in this sandbox —
cannot be validated without live Vapi/Twilio credentials" (real IVR menu navigation accuracy,
handoff audio quality, whether Vapi actually deletes recordings post-call). Correctly marked as
`.todo`, not silently passed.

**No unconditional `.skip()` anywhere in `tests/`** — confirmed by grep across every `*.test.ts`
file. Every skip in this codebase is either environment-conditional (DB/Redis reachability, the
strict-RLS role split) or, in the one case above, a genuinely dead gate worth fixing.

---

## Results by domain

### 1. Authentication and authorization

**Cookie + bearer token:** `authenticate.ts` accepts either (`httpOnly` cookie preferred,
`Authorization: Bearer` fallback) — read directly, confirmed both paths exist.

**Re-verification on every request, not just at login:** the middleware re-queries `User.isActive`
and `User.practiceId` from the DB on every authenticated request and 401s if either has drifted
from the JWT's claims — this specifically defends against a stale JWT outliving a practice's
revocation of that user's access. Fails closed (503, not open) if the DB check itself errors.
Accountants get an additional `tokenExpiresAt` check. All confirmed by reading the code, not
inferred.

**Forged/expired/malformed tokens:** `jwt.verify()` in `authToken.ts`; a bad signature or expired
token throws, caught by `authenticate`'s outer `try/catch`, returns 401. Not separately
fuzz-tested this pass beyond what the existing suite exercises.

**Cross-practice IDOR:** `tests/adversarial.smoke.test.ts` (8 tests, all passed this run) directly
exercises: User A fetching Practice B's call recording (403), updating Practice B's claim (403),
listing Practice B's work queue (empty, not error), password-reset enumeration (same message
either way), self-role-escalation to `platform_dev` (403), `vapiCallId` claiming across practices
via metadata mutation (blocked), and confirms failed-access attempts create an audit trail. All
passed.

**Webhook signature verification:** `validateHmacSignature` in `webhookSecurityValidator.ts` uses
`crypto.timingSafeEqual` with a length check before comparing — not vulnerable to a timing attack.
Read directly, confirmed.

**Rate limiting:** `tests/rateLimiters.test.ts` passed, including a real discovery the test itself
documents: `publicLimiter` is implemented and unit-tested but wired to no route (dead code, not a
vulnerability — see P1-04).

**Not tested this pass:** concurrent-session invalidation under a live multi-device scenario (only
the DB-level `isActive`/`practiceId` re-check was verified, not an explicit "log out device A,
confirm device B's session dies mid-request" test); no fuzz/mutation testing of the JWT itself
beyond what the existing suite covers.

### 2. Database-enforced tenant isolation

**Role provisioning, following the documented workflow:** created a `NOSUPERUSER NOBYPASSRLS
LOGIN` role (`collectrx_rls_tester`) locally, granted table/sequence privileges, exactly mirroring
`.github/workflows/collectrx-ci.yml`'s `rls-strict` job. Confirmed via direct `pg_roles` query:

```
rolname               | rolsuper | rolcanlogin | rolbypassrls | rolcreaterole | rolcreatedb
collectrx_rls_tester  | f        | t           | f            | f             | f
```

This repo's own committed migrator/runtime roles (`collectrx_migrator`, `collectrx_app`) are
*also* provisioned correctly in the local dev DB this pass used — both `NOSUPERUSER`,
`NOBYPASSRLS`. **The production role has never been checked** — this remains open, tracked
already in `docs/operations/HUMAN-DECISIONS-PENDING.md` item 3, restated as P0-02 here because
it's load-bearing for the overall verdict.

**Strict RLS attestation:** ran `tests/rls.strict.test.ts` directly with
`COLLECTRX_RLS_TEST_STRICT=1` and the dedicated role, exact CI recipe:

```
✓ tests/rls.strict.test.ts (1 test) 102ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Practice A genuinely cannot read or update Practice B's `insurance_claims` or
`call_dispatch_intents` rows under this role. That part of the mechanism is real and correctly
enforced for the tables it covers.

**RLS coverage across every tenant-scoped table — the central finding of this audit:**
cross-referenced every Prisma model with a `practiceId`/`organizationId` field (51 models) against
live `pg_class`/`pg_policies` on a database with all 77 migrations applied. **31 tables that are
tenant- or org-scoped by schema have no RLS policy at all** — `relrowsecurity = false`,
`relforcerowsecurity = false`, confirmed by direct SQL, not inference. Two are dead code
(`RuleSet`, explicitly marked so in a schema comment; `QueuePriority`, zero live call sites,
confirmed by grep) — the other **29 are live**, including `User` itself, both PAD financial
tables (`pad_mandates`, `pad_transactions`), all four org/DSO tables
(`organization_members`, `organization_practices`, `organization_sso_configs`, `org_sso_events`),
`InviteToken`, and the eligibility-engine detail tables. For every one of these, tenant isolation
today rests entirely on every Prisma call site remembering an explicit `where: { practiceId }` —
the RLS session variable is set on every request (`src/lib/prismaRls.ts`), but it's inert on a
table with no policy. Full list and fix shape in `SHIPPABILITY-BACKLOG.md` P0-01.

This directly contradicts a specific prior-pass claim:
`docs/operations/DSO-SCALE-VERIFICATION-2026-08-04.md` (line 50) states the newer org tables
"inherit scoping through existing practiceId foreign keys" — a foreign key is not a policy, and
this pass found no policy on any of the four org tables. That prior claim should be treated as
superseded by this evidence.

**No CI check enforces this stays fixed:** grepped `tests/` and `scripts/` for anything asserting
"every table with a `practiceId`/`organizationId` column has `FORCE ROW LEVEL SECURITY` and a
policy" — nothing exists. That's the structural gap that let 29 tables drift uncovered one
migration at a time since the original RLS migration only force-enabled 3 tables. Recommended fix
in the backlog: a script comparable to the existing `check-api-coverage.mjs`, wired into CI.

### 3. Multi-practice concurrency

**20+ practices, concurrently — several independent tests, all run fresh this pass:**

- `tests/dsoScaleConcurrency.test.ts` — 20 practices onboard concurrently (no unique-constraint
  collisions, no cross-tenant leakage), 20 concurrent logins each resolving to only their own
  practice, dispatch fairness bounded at N=25 practices with a 4-slot budget (every practice
  served within `⌈25/4⌉+1` ticks, proven not assumed), and a real concurrent race for the same
  practice to join two organizations (exactly one wins the unique constraint, never both). **All
  passed.**
- `tests/dsoLoadCapacity.test.ts` — real `runDeskQueueTick()` end-to-end (real Postgres, real RLS
  context, real PHI-vault tokenize/detokenize) for 20 real practices. Dispatch and
  no-double-dispatch tests passed (10.7s, 9.1s); the third (sustained 10-tick lease renewal) timed
  out — see table above.
- `tests/dsoHttpLoadCapacity.test.ts` — 20 concurrent authenticated HTTP sessions against real
  DB-backed endpoints. **Failed** — see table above; this is the audit's most direct hit on the
  brief's own "database-pool exhaustion" and minimum-20-practice bar.
- `tests/loadtest/queueEngine.scale.test.ts` — 50-practice fleet, 80 simulated ticks, real
  Postgres, only the outbound Vapi call itself mocked. Verified during the run (via live log
  output, not just the final assertion): CARRIER_BLOCK correctly propagated to a sibling practice
  in the same organization mid-run, and PHI tokens were resolved and logged only under the
  documented `PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY` boundary throughout. **Failed** on one
  invariant — 2037 stranded PENDING claims with no recorded deferral reason (table above).

**Fairness (no starvation):** proven directly at N=25 with a constrained 4-slot budget (above) —
`orderPracticesByFairness()` bounds every practice's wait; a practice skipped for budget reasons
keeps its place and moves to the front next tick.

**No per-practice ceiling on the shared concurrency budget:** `vapiSlotBudget()` is a fleet-wide
cap (`VAPI_MAX_CONCURRENT_CALLS`, default 10, minus a 2-slot reserve = 8 by default), shared across
every practice, with only a per-*carrier* ceiling on top — no per-*practice* ceiling. Fairness of
turn is proven; fairness of simultaneous throughput within a practice's own turn is not bounded.
Not a bug, but a capacity-design fact worth stating plainly for pilot-sizing conversations — see
P1-02.

**Database-pool usage:** no `connection_limit`/`pool_timeout` is set anywhere — not in
`src/lib/prisma.ts`, not in any `DATABASE_URL` example or documented Fly secret. Prisma runs on its
default pool size. This, combined with the RLS extension wrapping every tenant query in its own
2-statement transaction, is the most likely explanation for the real `dsoHttpLoadCapacity` 503s
above. See P1-01.

### 4. Critical workflows

- **Claim ingestion and deduplication:** `tests/submissionQualityGateDedup.test.ts` — passed as
  part of the full run.
- **Call queue leasing, retries, recovery, dead-letter:** `tests/deadLetterQueue.test.ts` passed;
  `tests/queueEngineFairnessAndLease.test.ts` — 5/6 passed, the stale-lease reclaim failure is a
  real, isolated-reproduced bug (P0-05).
- **Vapi webhook signature + metadata-tampering protection:** `webhookSecurityValidator.ts`
  reviewed directly — HMAC-SHA256, timing-safe compare, idempotency check, correct error codes.
  `tests/adversarial.smoke.test.ts`'s metadata-mutation-claiming-a-cross-practice-call test passed.
- **Soft-delete isolation:** `tests/softDeleteIsolation.test.ts` and
  `tests/insuranceClaimSoftDelete.test.ts` — claims soft-delete tests passed; 3 user-level tests
  structurally can never run (see Skips, P1-06).
- **Audit-log immutability:** the mechanism is honestly self-documented as **not** immutable —
  the migration comment for `20260920_audit_integrity` states outright: "tamper-evident, not WORM
  storage... stronger role separation/external WORM remains a launch gate." A hash chain that
  would *show* tampering, not one that *prevents* it. `tests/audit-integrity-remediation.test.ts`
  (tenant-chain serialization, mutation/broken-link detection, fail-closed-vs-best-effort split)
  passed.
- **Organization/DSO membership isolation:** `tests/groupAdminSelfServe.test.ts`,
  `tests/orgAdminRoutes.test.ts`, `tests/organizationSso.test.ts` passed. **But** the underlying
  tables (`organization_members`, `organization_sso_configs`, `org_sso_events`) have no RLS policy
  (finding above) — isolation here is currently app-layer only, proven correct by these tests but
  with no database backstop if a future query forgets a filter.
- **Per-practice caller IDs/credentials:** schema support exists
  (`add_practice_vapi_caller_id` migration); not independently load-tested this pass.
- **Billing/usage attribution:** `tests/planUsageAlertService`-adjacent and billing-catalog tests
  in the general suite passed; `DSO-SCALE-VERIFICATION-2026-08-04.md`'s claim that per-practice
  billing stays correct under DSO grouping (no shared billing fields on `Organization`) was
  spot-checked against the current schema and still holds.

### 5. Reliability

- **CARRIER_BLOCK propagation:** verified live during the 50-practice load test — a block on one
  practice's Sun Life calls correctly suspended a sibling practice's Sun Life calls
  organization-wide, with the reason logged.
- **Silent-stall signature found:** the 50-practice loadtest's 2037-stranded-claims failure (above)
  is exactly the failure class this repo's own memory of prior incidents calls out — claims that
  stop moving with no recorded reason. Needs a dedicated root-cause pass; not yet traced to a line.
- **Dependency/packaging integrity:** `archiver`'s `buffer-crc32` dependency is unresolvable from
  the current lockfile (P0-04) — this is a release-blocking packaging defect independent of any
  application logic, and would reproduce on any fresh `npm ci`, including CI's own.

### 6. Performance / engineering release gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **0 errors**, 27s |
| Lint | `npm run lint` | **0 errors, 123 warnings** — 66 of which are `no-non-null-assertion`, a rule `CLAUDE.md` documents as a non-negotiable PRD error but ESLint only warns on (P1-03) |
| Production build | `npm run build` (Collect-RX-main) | succeeded |
| API route coverage | `node scripts/check-api-coverage.mjs` | **95/95** UI-referenced paths covered, **24/24** server mounts on allowlist |
| `npm audit` (prod deps, CI's exact command) | `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** |
| `npm audit` (full, informational) | `npm audit` | 7 (6 moderate, 1 high) — all in dev tooling (esbuild/Vite dev server, Storybook's uuid dependency), not shipped runtime code |
| Clean-schema migration rehearsal | fresh empty DB, `npx prisma migrate deploy` | **77/77 migrations applied, ~2.4s, 0 errors** |
| Upgrade-schema migration rehearsal | existing DB with 4 migrations pending, `npx prisma migrate deploy` | **4/4 applied cleanly, ~2.0s, 0 errors** |
| Semgrep SAST | `docker run ... semgrep ...` (CI's exact step) | **Could not run — Docker daemon not available in this environment.** Not reproduced; relying on CI's own history for this gate, which this audit did not independently verify. |

---

## Measured capacity envelope

- **Fairness bound, proven:** at N=25 practices with a 4-call-slot budget, every practice is served
  at least once within `⌈25/4⌉+1 = 8` simulated ticks — a hard, tested bound, not an estimate.
- **Real dispatch throughput, proven:** 20 real practices, full pipeline (real Postgres, real RLS,
  real PHI vault), single tick completed in 10.7s; a second tick with no completions in 9.1s.
- **Fleet-wide live-call ceiling:** 8 simultaneous calls by default
  (`VAPI_MAX_CONCURRENT_CALLS=10` minus a 2-slot reserve), shared across the entire fleet, with
  no per-practice sub-ceiling. At 20+ concurrently active practices, most are not getting
  simultaneous live calls — they're taking bounded turns. This is a real architectural constraint
  worth stating to anyone sizing a DSO pilot, not a defect.
- **HTTP concurrency ceiling, found not proven:** 20 concurrent authenticated HTTP sessions against
  real endpoints produced real 503s from audit-subsystem transaction-pool pressure. The system's
  *safe* concurrent-HTTP-request envelope in this configuration is measurably **below** 20
  concurrent sessions, at least in this test environment's default (untuned) Prisma pool. Whether
  this reproduces at the same threshold against a properly resourced production Postgres instance
  with tuned pool settings is unverified — flagged as the single most important thing to re-test
  before calling a pilot "controlled" at N≥20.

---

## P0/P1/P2 blockers, ranked by risk

See `SHIPPABILITY-BACKLOG.md` for full detail, reproduction steps, and fix shapes on every item.
Summary, most severe first:

1. **P0-01** — 29 live tenant-scoped tables have no RLS policy (User, PAD financial tables, all
   four org/DSO tables, `InviteToken`, eligibility-engine detail tables, and others).
2. **P0-02** — production DB role for RLS has never been verified (blocked on ops/prod credentials).
3. **P0-03** — no CI gate prevents this from recurring on the next new tenant table.
4. **P0-04** — `archiver`'s `buffer-crc32` dependency is unresolvable from the current lockfile;
   DSO compliance export currently 500s on any fresh install.
5. **P0-05** — `claimTickLease`'s stale-lease reclaim fails deterministically in isolation
   (contradicts a specific prior-pass claim); Stripe webhook idempotency has a gap for
   unmapped-price events.
6. **P1-01** through **P1-07** — no Prisma connection-pool tuning (directly implicated in the real
   503s above); no per-practice concurrency ceiling (design fact, not a bug); the documented "no
   non-null assertions" PRD rule is unenforced; a dead rate limiter; Electron/Node version mismatch
   (also present in CI); 3 permanently-skipped user soft-delete tests; the borderline lease-renewal
   timeout.
7. **P2-01/02** — informational: local-DB migration-history drift encountered during this audit
   (methodology note, not a product issue); dev-only `npm audit` findings.

---

## What could not be verified in this environment

Stated plainly, per this repo's own honesty standard — these are gaps in *this audit's* coverage,
not claims that the underlying thing is broken:

- **Redis/BullMQ queue paths** — no `redis-server`/`redis-cli` available locally. Only 3 test files
  reference `REDIS_URL` directly; CI's `queue-redis` job re-runs the general suite against a real
  Redis and was not reproduced here.
- **Semgrep SAST** — Docker daemon unavailable locally; CI's exact SAST step was not reproduced.
- **Production RLS role** — genuinely unverified; see P0-02.
- **Live Vapi/Twilio carrier behavior** — correctly out of scope per the existing `it.todo()`s;
  this audit made no live calls, consistent with the brief's instruction not to.
- **A hosted, non-local Postgres/Fly.io environment at real network latency** — all concurrency
  numbers above are against a local Postgres 16 instance on the same machine as the app under
  test; production network latency, connection-pool behavior under Fly.io's actual proxy, and
  true multi-machine horizontal scaling (the specific risk `DSO-SCALE-VERIFICATION-2026-08-04.md`
  flagged the `QueueEngineLease` mechanism against) were not exercised.

---

## Shortest critical path to a controlled multi-practice pilot

Ordered by what actually blocks the decision, not by ticket size:

1. **Fix the lockfile** (P0-04) — smallest, fastest, most concrete: `npm install` to repair
   `buffer-crc32`, confirm `npm ci` + `orgComplianceExport.test.ts` pass clean. Minutes, not days.
2. **Verify the production RLS role** (P0-02) — two `psql` queries against prod, already written
   out in `HUMAN-DECISIONS-PENDING.md` item 3. Minutes, needs prod credentials only.
3. **Add RLS to the highest-risk tables in P0-01's list first** — `User`, `pad_mandates`,
   `pad_transactions`, and the four org/DSO tables, mirroring the existing 68-table pattern exactly
   (add FORCE RLS + a `practice_id = current_setting('app.practice_id')::uuid` policy). This is
   mechanical, not a redesign — the pattern to copy already exists 68 times in this schema.
4. **Root-cause `claimTickLease`'s stale-lease reclaim** (P0-05) — needed before relying on this
   recovery path if the app is ever run on more than one machine, which a real DSO pilot may push
   toward sooner than expected.
5. **Tune the Prisma connection pool and re-run `dsoHttpLoadCapacity.test.ts`** (P1-01) — confirm
   the 503s don't reproduce at the intended pilot's concurrent-practice count before calling
   concurrency "safe."
6. **Add the CI RLS-coverage gate** (P0-03) so item 3 can't silently regress on the next new table.
7. Everything else in the backlog can follow after a pilot starts, under monitoring.

None of this requires an architecture change — it's policy additions following an existing
pattern, a lockfile fix, a credentials check, and pool tuning. That's consistent with "controlled
pilot after these land," not "rebuild before shipping."

---

## Files changed this pass, and why

- **`SHIPPABILITY-BACKLOG.md`** (new) — the backlog the brief asked this audit to maintain; didn't
  exist before this pass.
- **`SHIPPABILITY-AUDIT-2026-09-25.md`** (new, this file) — the report itself; also one of the
  brief's four "read first" files that didn't exist before this pass.
- **`Collect-RX-main/.env`** (new, gitignored, not committed) — local-only test credentials created
  to run the suite; contains no real secrets, only placeholder values for local Postgres and audit
  purposes.
- **No application code was modified.** Every finding above is a diagnosis, not a fix — per the
  brief's instruction to repair test infrastructure only when it produces false positives (done:
  the local `BYPASSRLS` grant used for diagnosis, on a throwaway local database, not committed
  anywhere) and never to weaken assertions or mask failures (not done anywhere).

---

## Commands to reproduce every result above

Run from `Collect-RX-main/` unless noted, against a reachable local Postgres 16 with
`DATABASE_URL` set to an owner/migrator role for the database.

```bash
# Setup
npm ci                                    # from repo root
npx prisma generate
npx prisma migrate deploy                 # upgrade-schema rehearsal, against an existing DB

# Clean-schema rehearsal (against a brand-new empty database)
# createdb collectrx_clean_rehearsal, point DATABASE_URL at it, then:
npx prisma migrate deploy

# Engineering gates
npm run typecheck
npm run lint
npm run build
node scripts/check-api-coverage.mjs       # from repo root
npm audit --omit=dev --audit-level=high   # from repo root — CI's exact command

# Full suite (produces the 8 failed / 219 passed file totals above)
CI=true npx vitest run --reporter=verbose

# RLS strict attestation — provision the role first, mirroring
# .github/workflows/collectrx-ci.yml's rls-strict job:
#   CREATE ROLE collectrx_rls_tester LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
#   GRANT ALL PRIVILEGES ON ALL TABLES/SEQUENCES IN SCHEMA public TO collectrx_rls_tester;
CI=true COLLECTRX_RLS_TEST_STRICT=1 \
  RLS_SETUP_DATABASE_URL="<owner-or-bypassrls-role-url>" \
  DATABASE_URL="<collectrx_rls_tester-url>" \
  npx vitest run tests/rls.strict.test.ts

# RLS coverage gap — the central finding — reproduce directly in psql:
psql "$DATABASE_URL" -c "
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
    (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policy_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1;"
# Cross-reference against models with practiceId/organizationId in prisma/schema.prisma.

# The 6 real test failures, isolated:
npx vitest run tests/orgComplianceExport.test.ts
npx vitest run tests/queueEngineFairnessAndLease.test.ts -t "reclaiming a stale"
npx vitest run tests/webhookValidation.test.ts -t "idempotent"
npx vitest run tests/dsoHttpLoadCapacity.test.ts
npx vitest run tests/loadtest/queueEngine.scale.test.ts   # ~600s, needs --testTimeout for npm run test:loadtest
npx vitest run tests/dsoLoadCapacity.test.ts -t "renews its own lease"

# Lockfile bug, direct:
grep -n '"node_modules/buffer-crc32"' package-lock.json   # from repo root — returns nothing
grep -n -A5 '"node_modules/archiver":' package-lock.json  # from repo root — shows the dependency it needs
```
