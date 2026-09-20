# DSO / multi-practice scale verification — 2026-08-04

**Point-in-time record.** Follow-up to [`PRODUCT-READINESS-ASSESSMENT-2026-08-02.md`](PRODUCT-READINESS-ASSESSMENT-2026-08-02.md), which audited every feature domain for a single practice. This pass asks a different question: **does the product actually work when run by a multi-location DSO — 20+ practices onboarding, queueing, and closing claims at once — not just one practice at a time?** Every claim below is backed by a test that was actually executed against a real Postgres, not inferred from reading code.

## What "the components" are, for this journey

Onboarding → tier setup → queue setup → addressing claims → closing claims, at fleet scale, touches:

1. **Practice onboarding** (audited previously, 7/10 — unchanged this pass)
2. **DSO/organization onboarding** — grouping N practices under one multi-location operator
3. **Billing tier setup** (audited previously, 8/10 — confirmed still per-practice and correct under DSO grouping)
4. **Queue setup and dispatch fairness** — does every practice in a large fleet actually get a turn
5. **Claim dispatch concurrency safety** — does the dispatch engine stay correct if the app is ever run on more than one machine
6. **Closing claims / reporting rollups** — does a DSO's cross-practice view stay correctly isolated per group

## Finding: DSO onboarding had no write path — now built

Before this pass, `Organization`, `OrganizationPractice`, and `OrganizationMember` existed only as schema, read by a 135-line, read-only reporting router (`groupAdminRoutes.ts`) and `GroupDashboard.tsx`. A repo-wide search found **zero** code anywhere that created a row in any of the three tables — no route, no UI, not even the seed script. A 20-practice DSO could not onboard through the product; someone would have had to hand-write rows into Postgres.

**Built this pass:**
- `POST /api/organizations` — a `practice_owner`+ creates a group; their own practice attaches automatically; they become an `org_admin` member.
- `POST /api/organizations/:id/invite-practice` + `GET`/`POST /api/organizations/invite/:token[/accept]` — a **consent-based** invite flow mirroring the existing staff-invite pattern. The inviter can never attach a practice they don't own — only the invited owner's own authenticated acceptance creates the attachment, closing an IDOR that a naive "add practice by ID" endpoint would have opened.
- `GET /api/organizations/mine` + a minimal panel in `GroupDashboard.tsx` + `OrganizationAcceptInvitePage.tsx` for the accept link.
- A DB-level guarantee that a practice belongs to at most one group (`OrganizationPractice.practiceId` is unique) — verified under a **real concurrent race** (two accept-invite requests firing at once for the same practice): exactly one succeeds, the other gets a clean 409, never both.

**Found and fixed along the way:** `authorizeRole()` checks the session JWT's role claim, not a live DB read. Creating a group upgrades the creator's DB role to `group_admin`, but without reissuing the session cookie, their *very next request* (e.g. inviting a practice) would 403 until they logged out and back in. Fixed by reissuing the cookie whenever the role actually changes — caught by the test suite, not by inspection.

**Known scope limit, not a bug:** only the user who created or accepted joins the group as an `OrganizationMember`. Adding *additional* staff at a member practice to the group-admin role isn't built — a real v2 gap, noted here rather than silently left implicit.

## Finding: dispatch fairness and distributed-lock safety were latent gaps

`runDeskQueueTick` (the function that actually places outbound carrier calls) iterates every practice in the system once every 60 seconds, in a single Node process, guarded by an **in-process** boolean (`isTickRunning`). Two problems only show up at DSO scale:

1. **No fairness rotation.** Practices were iterated in stable `findMany()` order every tick. Under Vapi slot-budget pressure (a fixed fleet-wide concurrent-call limit), practices earlier in creation-id order would always be served first — a practice later in the list could be starved indefinitely in a large fleet.
2. **The dispatch lock doesn't survive horizontal scaling.** The app currently runs as a single Fly machine (confirmed in `fly.toml`), which is the *only* reason the in-process guard hasn't already caused double-dispatch. If the app is ever scaled to 2+ machines to handle real DSO-level traffic — a realistic response, not a hypothetical — each replica would run its own independent 60-second timer and could dispatch the same claim twice.

**Fixed:**
- `orderPracticesByFairness()` orders practices by "time since last given a turn" (ascending, never-served first), backed by a new `PracticeDeskState.lastServedAt` column. A practice only loses its place in line if the loop actually reached it — one skipped for budget reasons keeps its old timestamp and moves to the front next tick. Verified at N=25 practices with a constrained 4-slot budget: every practice served within the mathematically tight bound (`⌈25/4⌉+1` ticks).
- A new `QueueEngineLease` singleton row, claimed atomically before the tick body runs, using the same claim-row idiom already proven in this codebase for `ProcessedVapiWebhook` idempotency (deliberately **not** a native Postgres advisory lock — those are tied to the physical connection that acquired them, and a pooled connection can route the matching unlock through a different one, silently failing to release). Verified: two concurrent claims, exactly one wins; a second claim while the lease is live is rejected; a stale lease from a crashed process is reclaimable.
- An existing dispatch test file (`tests/frontDesk/queueEngine.dispatch.test.ts`) mocked Prisma without `$executeRaw`/`$queryRaw` and broke when these landed — fixed the mock rather than routing around it, confirmed all 13 of its pre-existing tests still pass with the same intent.

## Finding: the DSO reporting layer had zero functional tests

`groupAdminRoutes.ts` (practices-summary, compliance/export) predates this pass and had only a static role-gate audit, never a real multi-org isolation test — meaningless before now since no second org could exist. With org creation now real, added `tests/groupAdminScoping.test.ts`: two separate groups, distinct seeded claim counts (3 vs. 5), confirmed each group's API response contains only its own practice and never leaks the other's practiceId or counts. Passed on the first real run — the underlying isolation logic (scoping by the caller's own `OrganizationMember` rows) was already correct, just never proven.

## What was re-confirmed, not just assumed

- **Per-practice billing stays correct under DSO grouping** — `Organization` has no billing fields; nothing in the tier/trial/overage logic (already audited 8/10, flagged sensitive, untouched again this pass) reads or depends on organization membership. A DSO's practices bill independently, exactly as the recommended design called for.
- **CARRIER_BLOCK remains practice-scoped**, not global — a block on one DSO-member practice's Sun Life calls does not affect a sibling practice's Sun Life calls. Confirmed by re-reading `carrierBlockService.ts` against the org model added this pass; no code path was found that could conflate the two.
- **RLS tenant isolation** (audited previously against a real `NOSUPERUSER NOBYPASSRLS` role, 40 tests) needed no changes — the new tables (`OrganizationPractice`, `OrganizationInviteToken`, `QueueEngineLease`, `PracticeDeskState.lastServedAt`) either aren't practice-scoped (the lease is a global singleton by design) or inherit scoping through existing `practiceId` foreign keys.

## Verification method

Every claim above was proven, not inferred: a local Postgres 16 instance matching CI's exact role configuration (`prisma` role, `BYPASSRLS` granted the same way `.github/workflows/collectrx-ci.yml` does it), real migrations applied via `prisma migrate deploy`, and the full suite executed — **154 test files, 1410 tests passed, 8 legitimately skipped (the strict-RLS suite needs CI's dedicated non-superuser role), 0 failures** — plus a clean `tsc --noEmit`, 0 ESLint errors, and a successful production build, all run after every change, not just at the end.

## What's still open (unchanged from the prior assessment, restated for this scale lens)

Everything flagged 🚩 in `PRODUCT-READINESS-ASSESSMENT-2026-08-02.md` — TELUS's dead day-21 carrier-wait branch, unimplemented PHIPA deletion/breach handling, incomplete PHI-access logging, the marketing/carrier Vapi credential overlap, and the production RLS role-verification dependency — remain exactly as flagged. None of them are DSO-scale-specific, and none were touched this pass; they still need the same human decisions described there.

**New from this pass:** adding staff beyond the group's original creator/acceptor to `group_admin` role is unbuilt (noted above) — a product-scope decision, not a bug, on whether that's needed before a real DSO pilot.
