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

---

<!-- New entries go above this line, most recent first. -->

### 2026-09-25 — Claude — Two more real bugs found while re-verifying, fixed
**Claim:** (1) `claimTickLease()`'s stale-lease reclaim was broken by a timezone bug —
`locked_until`/`updated_at` are naive `timestamp without time zone` columns (always
UTC-numbered from Prisma's JS side), compared against bare `now()` in raw SQL, which
Postgres casts down using the session timezone (`America/Toronto`) instead of UTC —
silently corrupting every staleness check by the UTC offset (~4-5h). Fixed by wrapping
`now()` with `AT TIME ZONE 'UTC'` throughout that query.
(2) PR #108's diagnosis of `dsoLoadCapacity.test.ts`'s "17 instead of 20" flake (stale
`CallAttempt` rows from other tests) was **real but incomplete** — after cherry-picking
it, the test still failed deterministically, 100% on `telus_adjudicare` claims
specifically. Root cause: `queueEngine.ts` correctly refuses to dial any TELUS claim
until `identifyTelusPlan()` resolves a `verified_provider_phone`, and zero TPAs
currently have one set (`carrier-configs.json`'s own `_dial_phone_policy` says so).
Fixed by excluding `telus_adjudicare` from this capacity test's carrier rotation — it
was asserting against a real, deliberate, currently-universal gate that has nothing to
do with concurrency.
**Evidence:** commit `9f80627` on `claude/agent-charter`; reproduced the timezone bug
directly via a standalone Prisma query-log script and a raw-SQL comparison in `psql`
before writing the fix; reproduced the TELUS finding via a temporary debug log showing
100% of misses were TELUS-carrier practices, cross-checked against
`carrier-configs.json`'s `tpa_research_leads` (0 of 12 TPAs have `verified_provider_phone`
set).
**Status:** open — not yet independently re-checked by ChatGPT. Flagging PR #108's
diagnosis as `disputed`-adjacent: its fix is real and worth keeping, but its root-cause
write-up ("not a CI-load flake... any CallAttempt at that point is guaranteed stale")
was not the actual complete cause for this failure mode.

**Also worth flagging separately, found as a side effect:** TELUS AdjudiCare dispatch
is currently blocked for every claim in the whole system, not just this test — zero TPA
phone numbers have been operator-verified yet. TELUS AdjudiCare is one of the six
supported carriers (~78% combined Canadian market per `CLAUDE.md`); worth surfacing to
product/ops as a real business gap, not just a test-fixture issue.

### 2026-09-25 — Claude — Quick-wins batch: 1 retraction, 3 real fixes
**Claim:**
1. **Retraction:** the `tests/webhookValidation.test.ts` idempotency failure listed above under
   P0-05 was never a real bug — re-ran it after fixing the local RLS-role setup issue (same root
   cause as the 11 other false failures already documented) and it passes cleanly. No code change.
2. `publicLimiter` (flagged as dead code in the original audit) is actually wired to a live route
   (`/api/public/prospect-unsubscribe`) — the audit's own source citation was against a stale test
   description, not current reality. Fixed the test, not the (already-correct) product code.
3. Rewrote `tests/softDeleteIsolation.test.ts`'s 3 permanently-skipped tests against `isActive`
   (the real mechanism) — all 14 tests in the file now run.
4. Documented Prisma connection-pool sizing in `.env.example` (P1-01) — doc-only, no code change;
   the actual value needs real production sizing data this environment doesn't have.

**Evidence:** `claude/quick-wins` branch (based on `claude/agent-charter`), commits `3072d68`,
`7c45c8d`, `1619b36`. Full pre-push suite not yet re-run on this branch as of this entry.
**Status:** open — not yet independently re-checked by ChatGPT.
