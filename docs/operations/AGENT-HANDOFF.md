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
