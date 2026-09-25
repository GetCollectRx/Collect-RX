# Agent charter — Claude ↔ ChatGPT, CollectRx

**Why this exists:** two AI coding agents have been working on two different local
checkouts of the same GitHub repository (`GetCollectRx/Collect-RX`) without a shared
source of truth. Result: contradictory `GATES.md` files, a month of undeployed work,
and at least one person (the owner) getting a false impression of readiness from one
side without the other's findings. This charter fixes the coordination problem, not
just the current bug list.

## 1. Source of truth

**Canonical state is `origin/main` on GitHub — not either agent's local checkout.**

As of this charter, three "main"s existed on this machine and all three disagreed:
- `Collect-RX/Collect-RX-main`'s local `main`: `51d41c4` (2026-07-21) — stale by 2 months.
- `collectrx-platform`'s local `main`: `a65f407` (2026-09-20) — ahead of origin, unpushed.
- `origin/main` itself: `55cf326` (2026-09-20) — **red CI**, last successful prod deploy
  was `0afde93` on 2026-08-26, a full month before this charter.

Neither agent works from local `main` from here on. Every task starts with `git fetch
origin && git log origin/main` to confirm current canonical state, branches off
`origin/main`, and ships as a PR against it — never a direct push to `main`.

## 2. Evidence standard (inherited, not new)

No claim of "done," "fixed," "verified," or "passing" without one of: a commit SHA, a
`file:line` reference, or real command output pasted in. A claim without one of these
is a hypothesis, and gets logged as `disputed` in the handoff log (§4) until someone
attaches evidence.

## 3. Division of work

**Claude (this thread) owns:**
1. Unblocking `origin/main`'s CI — the Sept 20 `pilot-trust-layer` merge broke it two
   ways (npm audit high-severity finding, Redis/BullMQ test failure); a fix
   (`fix/npm-audit-high-severity-deps`, PR #107) is open but itself intermittently
   fails on a flaky test. This has to unblock before anything else can merge cleanly.
2. Merging or recreating **PR #90** (`fix/queue-engine-mock-and-buffer-crc32`, open
   since 2026-08-24) — it already fixes two of today's audit findings (the missing
   `buffer-crc32` lockfile entry, and the silent-stranded-claims dispatch bug) and has
   been sitting green and mergeable for a month.
3. The P0 items from today's `SHIPPABILITY-AUDIT-2026-09-25.md` /
   `SHIPPABILITY-BACKLOG.md`: the 29-table RLS coverage gap, the production RLS-role
   verification, the `claimTickLease` stale-lease reclaim bug, and the Stripe webhook
   idempotency gap on unmapped prices — all directly in the concurrency/tenant-isolation
   territory this audit just built deep context on.

**ChatGPT owns (proposed — ok to renegotiate):**
1. **PAD reconciliation sweep functions** (`padService.ts` — `reconcilePendingAuthorizations`,
   `reconcilePendingPadTransactions`) — currently "Wired, not Verified": real code, real
   webhook, zero test coverage against a real DB. Self-contained, doesn't touch
   dispatch/RLS/CI.
2. **CDCP reconsideration case engine** (`reconsiderationEngine.ts`, `cdcpPrismaQueue.ts`)
   — same status, zero test coverage, self-contained REST CRUD surface.
3. **ITRANS2/CDAnet version-guard modules** — untested, and nothing persists the result
   anywhere (worth deciding whether that's intentional before writing tests for it).
4. **Doc reconciliation**: `Collect-RX/`'s `GATES.md` covers PHI-audit mounting, org
   billing webhook sync, release signing, Vapi security boundary, hold-park isolation,
   doc accuracy, carrier-rule source, typecheck/lint — none of which overlap with
   Claude's list above. Keep maintaining it, but retitle/scope it so it stops reading
   as a general readiness signal (it answered a real but narrower question, and that's
   what triggered the "pretty close" misread that started this).

Either side can pick up backlog items not listed here — flag it in the handoff log
first so the other doesn't duplicate work.

## 4. Handoff log

`docs/operations/AGENT-HANDOFF.md` (created alongside this charter). Every entry:
author, one-line claim, evidence (§2), status (`open` / `verified` / `disputed`).
Whatever one agent claims, the other treats as unverified until it re-checks against
the code — not because either is assumed unreliable, but because that's what actually
caught the buffer-crc32/starvation fix sitting unmerged for a month: nobody re-checked
the claim "PR #90 is ready," they just let it sit.

## 5. What neither agent does without the owner's explicit go-ahead, every time

- Merge anything to `main`.
- Trigger a staging or production deploy.
- Force-push, rebase a shared branch, or delete a branch.
- Touch the other agent's local working tree or uncommitted changes directly — hand
  off through GitHub (a branch/PR), never by editing files in
  `Collect-RX/Collect-RX-main` from a Claude session or vice versa.

Approval for one instance doesn't carry forward to the next. This isn't a charter
clause specific to this project — it's how both agents are supposed to operate anyway.

## 6. Conflict resolution

If Claude and ChatGPT produce contradictory claims about the same thing (a gate status,
a test result, whether something is deployed), neither wins by default. Log both in the
handoff file as `disputed` with each side's evidence, and it's the owner's call — the
same rule the owner's own vision-PDF governance already established for open
product decisions.
