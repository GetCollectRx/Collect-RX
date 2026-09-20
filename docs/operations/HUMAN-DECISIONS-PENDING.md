# Human decisions pending

Three items surfaced by [`PRODUCT-READINESS-ASSESSMENT-2026-08-02.md`](PRODUCT-READINESS-ASSESSMENT-2026-08-02.md) were flagged as bare bullet points — real findings, but landed without a concrete recommendation or the tradeoffs spelled out. This doc closes that gap: each item below has verified current behavior, the actual options, and a recommendation. None of these are code bugs a coding pass should resolve unilaterally — each needs sign-off from whoever owns that decision (product, legal/privacy, or infra).

Status tracking lives in [PATH-TO-DELIVERY.md](PATH-TO-DELIVERY.md) section E; this doc is the detail behind those checkboxes.

---

## 1. TELUS's day-21 minimum wait never fires — and neither does the other carriers' day-32 minimum

**Owner needed:** Product (carrier-relationship risk call).

**Status: docs and dead code fixed; the underlying behavior decision (Option A vs. B below) is still open.**

**Verified current behavior (updated — the scope is wider than first reported):** `CLAUDE.md` and `Collect-RX-main/CLAUDE.md` used to document "TELUS minimum claim wait is day 21 (vs. day 32 for all other carriers)." The code that was supposed to enforce that was `validateDispatch()` in `Collect-RX-main/src/carriers/adapter.ts`. It checked a global floor first, then a TELUS-only carve-out:

```ts
// as it read before this fix
// 4. Claims under 30 days old — do not queue
const config = CARRIER_CONFIGS[carrierId];
if (daysOutstanding < 30) {
  return { allowed: false, code: 'CLAIM_TOO_YOUNG', reason: `Claim only ${daysOutstanding} days outstanding (min 30 days required)` };
}

// 5. TELUS minimum day 21 — but our global minimum is 30, so this is informational only
if (carrierId === 'telus_adjudicare' && daysOutstanding < config.minWaitDays) {
  return { allowed: false, code: 'CLAIM_TOO_YOUNG', reason: `TELUS requires minimum ${config.minWaitDays} days (currently ${daysOutstanding})` };
}
```

The `< 30` check ran first and rejected every claim under 30 days old, TELUS included. The TELUS-specific `< 21` check could only ever evaluate for claims aged 21–29 days — already rejected one line above — so it was unreachable, exactly as its own comment admitted. **What the first pass at this doc missed:** `config.minWaitDays` (from `carrier-configs.json`'s `minWaitDayForClaims`) was *only ever read in that one TELUS-only branch* — grep confirms it's not referenced anywhere else in dispatch. So the five non-TELUS carriers, each configured with a 32-day minimum, were never actually held to it either; they were dispatched at the flat 30-day floor, two days earlier than their own documented SLA. `tests/workflowDispatchSafetyRules.test.ts` already had a test pinning exactly this ("a standard (non-TELUS) claim at exactly 30 days is allowed, despite CARRIER_CONFIGS documenting a 32-day minimum for this carrier") — this was a known, tested condition, just not written up with options until now.

**Fixed on this pass (safe, zero behavior change — Option A below):**
- Removed the dead, unreachable TELUS-only branch from `validateDispatch()` in `Collect-RX-main/src/carriers/adapter.ts`.
- Updated the `minWaitDays` field's doc comment and both `CLAUDE.md` files to state plainly that `carrier-configs.json`'s per-carrier minimums (21 for TELUS, 32 for the rest) are documented data, not enforced — every carrier is gated by the same flat 30-day floor today.
- Left `minWaitDays`/`minWaitDayForClaims` and their values in place (removing the field would touch the `CarrierConfig` type contract and several unrelated tests in `tests/phase-5/carrier-adapter.test.ts`, `tests/agents/01-carrier-config-agent.test.ts`, and `tests/eligibility.test.ts` that check the config data itself, independent of whether dispatch enforces it — no reason to touch those just to fix the dead branch).

**Still open — the actual behavior decision:**

| Option | What changes | Tradeoff |
|---|---|---|
| **A — Leave the flat 30-day floor as the real policy (docs/dead-code already fixed to match this)** | No further code change. `carrier-configs.json`'s per-carrier numbers stay as documented-but-unenforced reference data. | Zero behavior change, zero risk — this is what's shipped as of this pass. Two known costs: TELUS claims wait 9 days longer than the number originally documented for them (if 21 days reflected a real TELUS SLA, that's real AR recovery speed left on the table for ~78% of the market's clearinghouse); the five other carriers get dialed 2 days *before* their own documented 32-day minimum, which is the one with more direct carrier-relationship risk (calling before a carrier's own claim is ready to be looked up) and deserves attention independent of the TELUS question. |
| **B — Enforce each carrier's own documented minimum** | Replace the flat `daysOutstanding < 30` check with `daysOutstanding < config.minWaitDays` for every carrier — TELUS gets gated at 21, the other five at 32, using the `minWaitDays` field that already exists and is already correctly populated per carrier. | Two independent behavior changes bundled in one flip: TELUS claims start reaching a live carrier IVR 9 days sooner than today, and the other five carriers' claims wait 2 days longer than today. Both are real changes to when automated calls hit a live carrier, which is exactly the class of change this repo already treats as needing explicit sign-off (CARRIER_BLOCK protocol, carrier-relationship risk). The two carrier groups don't need to move together — see below. |

**Recommendation:** Ship A now (done on this pass — safe, and it's what the code actually did anyway, just no longer silently). Then treat the two carrier groups in Option B as two separate decisions, not one bundled flip: (1) the five carriers' 32-day minimum is the one with more direct downside (calling 2 days before a carrier's own claim is ready to be looked up) and is worth confirming/enforcing sooner — verify 32 days is still correct for each and flip that side first; (2) TELUS's 21-day minimum trades off against 9 fewer days of grace, which is lower-risk in the "did we call too early" direction but still needs the TELUS relationship owner (or current AdjudiCare provider documentation) to confirm 21 is still accurate before flipping it. Don't let the docs claim either number is enforced until the corresponding code change ships.

---

## 2. `PHIPADeletionRequest` / `PHIPABreachNotification` — schema exists, zero implementation

**Update 2026-08-19 — Option B shipped.** `src/pages/LegalPrivacy.tsx` now states plainly that
deletion and breach-notification requests are handled manually (support ticket → an engineer
runs a scoped, logged deletion under supervision) until the automated workflow ships, and points
requesters at support rather than implying a self-serve flow exists. This is a documentation/
runbook change only — it does not touch `PHIPADeletionRequest`/`PHIPABreachNotification` or
`tests/phipaCompliance.test.ts`, and it does not start the clock on Option A. Option A (the real
workflow) still needs the legal/privacy sign-off below before any engineering work against those
models begins — that has not happened yet. `docs/compliance/PHIPA-MANUAL-DELETION-BREACH-RUNBOOK.md`
is the internal how-to for support/engineering handling a request under the interim manual process.

**Owner needed:** Product + Legal/Privacy Officer (PHIPA compliance sign-off), before any engineering work starts.

**Status: Option B's engineering-doable half is shipped (interim runbook below); Option A (the real automated workflow) is still blocked on legal/privacy sign-off, which only Legal/Product can unblock.**

**Verified current state:** Both models are real, fully-fielded Prisma models (`Collect-RX-main/prisma/schema.prisma:1793`, with `status`, `requestedAt`/`completedAt`, `purgedClaimsCount`/`purgedCallsCount`/`purgedRecordingsCount` on the deletion side; `notificationType`, `notificationDeadline`, `remediationSteps` on the breach side). A repo-wide search turns up **zero production code that ever creates, reads, or updates either model** — no route, no admin UI, no cron job. The only file that references this workflow at all is `tests/phipaCompliance.test.ts`, and it doesn't exercise the real models either: it defines a local TypeScript `interface PHIPADeletionRequest` (a plain mock, not `prisma.phipaDeletionRequest`) and simulates "deletion" by directly calling `deleteMany()` on `insuranceClaim`/`callAttempt`/`phiVaultEntry`/etc. The test file's own docstring calls it what it is: it's testing that raw multi-table deletion is *possible*, not that a PHIPA request can be filed, tracked, or resolved by anyone. There is a companion doc, `docs/compliance/PHIPA-DELETION-TEST-GUIDE.md`, that includes a full "Implementation Guide for Cron Job" section — i.e. the design for this already exists in writing, it was just never built.

This was previously carried in `OUTSTANDING-FIXES-PRODUCT-READY.md` as "Done," which it isn't — that line was corrected during the 2026-08-02 audit.

**Why this needs sign-off before code, not after:** PHIPA ss.37-39/65-68 give patients real deletion and breach-notification rights with real deadlines (the schema's 14-day breach window is not adjustable after the fact once a practice is telling patients that's the SLA). Building the wrong workflow — wrong retention period on the audit trail, wrong notification recipient, deletion that's too aggressive (destroys billing records a practice is legally required to keep) or too weak (leaves PHI behind) — is worse than not building it, because it creates a documented, auditable process that's documented wrong.

**Options:**

| Option | What it requires | Tradeoff |
|---|---|---|
| **A — Build the real workflow now** | Legal/Privacy sign-off first on: (1) who can file a deletion request (patient directly? only via the practice? both?), (2) what "delete" actually means given practices' independent record-retention obligations for billing/insurance records, (3) how long the audit trail itself survives after the underlying data is purged, (4) who receives breach notifications and within what channel. Then: a route + admin UI to file/track requests, a cron job per the existing implementation guide, wiring the real Prisma models in place of the test's mock. | Real engineering effort (route, cron, UI, tests against the actual models) gated on legal review that has its own timeline. This is the only option that actually closes the compliance gap. |
| **B — Ship without it, document as a known gap with a manual process** | No code. Add explicit language to the Terms/Privacy policy and an internal runbook: deletion/breach requests are handled manually (support ticket → engineer runs a scoped deletion script under supervision) until the automated workflow ships. | Fastest path to not misrepresenting capability. Manual process is real operational burden and slower for patients exercising a legal right, and doesn't produce the same audit trail quality — acceptable for an early pilot with a handful of practices, less so at scale. |
| **C — Remove the unused schema** | Drop `PHIPADeletionRequest`/`PHIPABreachNotification` from the schema entirely until there's a real implementation plan, so the codebase doesn't imply a capability that doesn't exist. | Cleanest signal, but throws away a design (the models + the cron-job guide) that's otherwise ready to build against once legal sign-off lands — probably not worth the churn versus just being honest in B. |

**Recommendation:** B immediately (it's a documentation/runbook change, doable today, and stops the schema from implying a capability nobody should assume exists), with A as the actual target — kick off the legal/privacy review now since it's the long pole, and let engineering build against the existing `PHIPA-DELETION-TEST-GUIDE.md` design once that review lands. Don't do C; the design work in that guide is worth keeping.

**Shipped on this pass — Option B's internal-runbook half:** [`docs/compliance/PHIPA-MANUAL-PROCESS-RUNBOOK.md`](../compliance/PHIPA-MANUAL-PROCESS-RUNBOOK.md) — step-by-step process for a human to handle a deletion or breach-notification request today (intake, second-person sign-off before any deletion, the exact tables to purge, manual audit-log entries, 14-day breach deadline tracking), with its known gaps stated plainly at the bottom. Linked from `PHIPA-DELETION-TEST-GUIDE.md` (which now opens with a status callout clarifying it's a design spec, not a shipped feature) and from `COMPLIANCE-LAUNCH-TRACKER.md`'s Reviews table.

**Deliberately not done on this pass — and shouldn't be done without counsel:** Option B also mentioned "add explicit language to the Terms/Privacy policy." `src/pages/LegalPrivacy.tsx` is explicitly marked in its own text as "template, have counsel review before production" and doesn't currently mention deletion/breach process at all. Writing new legal policy language into that page without counsel review would be worse than leaving the gap — it would be shipping unreviewed legal copy under the banner of a privacy policy. That page edit stays a P9-02 counsel-review item (`COMPLIANCE-LAUNCH-TRACKER.md`), not something engineering should draft unilaterally.

---

## 3. Production RLS tenant isolation depends on the DB role never being superuser

**Update 2026-08-06 — Option B is now implemented.** `src/server/observability/rlsRoleSafety.ts` queries `pg_roles` for the connecting role's `rolsuper`/`rolbypassrls` once at boot (production only — `NODE_ENV === 'production'`, which Fly sets on both staging and prod) and caches the result; `GET /api/health/ready` now returns `503` in production if the role fails that check, instead of silently reporting healthy. This turns the failure mode from silent into loud and deploy-blocking (Fly won't route traffic to a machine that never passes its readiness check), but it does **not** replace Option A below — running it once against this repo's own local dev Postgres found the connecting role (`collectrx`) genuinely **is** a superuser, which is exactly the class of misconfiguration this check exists to catch. Whoever holds Fly Postgres production credentials should still run the manual verification once and fix the role if needed; the runtime check is the safety net for future drift, not a substitute for confirming today's actual state.

**Owner needed:** Whoever manages the production Fly.io Postgres role/credentials (infra/ops) — this is a verification task, not a code change.

**Verified current state:** Postgres RLS is real and deployed (`prisma/migrations/20260712000000_rls_and_phi_vault_practice`), and it's genuinely tested — but only under a role built specifically for the test. `.github/workflows/collectrx-ci.yml`'s `rls-strict` job (lines 279-330) creates a dedicated `collectrx_rls_tester` role with `NOSUPERUSER NOBYPASSRLS` explicitly, then runs `tests/rls.strict.test.ts` against it — that test (`Collect-RX-main/tests/rls.strict.test.ts`) is itself gated behind `COLLECTRX_RLS_TEST_STRICT=1` and proves practice A genuinely cannot read or update practice B's claims under that role. That part is solid: the isolation mechanism works correctly *when the connecting role is non-superuser and doesn't have `BYPASSRLS`*.

What's unverified is whether the **actual production connection** — the role `DATABASE_URL` on the live `collect-rx` Fly app authenticates as — meets that condition. Postgres superusers and any role with the `BYPASSRLS` attribute silently ignore `FORCE ROW LEVEL SECURITY` with no error and no log line; a misconfigured production role wouldn't fail loudly, it would just make every RLS policy a no-op while everything continues to look like it's working (queries still return correct-looking results, because the app-layer `practiceId` filters in Prisma queries are still there — RLS is currently defense-in-depth on top of those, not the only thing preventing cross-tenant reads). `docs/security/PRE-LAUNCH-STATUS.md` §3.2 currently marks this "Pass (defense-in-depth)" based on the migration being deployed and Prisma setting the session vars — it does not claim the production role was checked, and it should be read as "the mechanism exists" rather than "the mechanism is confirmed active in prod." The PATH-TO-DELIVERY.md staging RLS checkbox (`tests/rls.test.ts` + `csv-ar-expansion.test.ts`, 42 passed) also isn't this check — that suite validates policies exist and pass under whatever role staging happens to use; it's not the same as running `rls.strict.test.ts` with a purpose-built `NOSUPERUSER NOBYPASSRLS` role against the staging or production database the way CI does against its ephemeral one.

**What verification actually looks like** (this is a `psql` session against the real database, not a code change):

```sql
-- 1. What role does the app actually connect as, and is it privileged?
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- rolsuper must be false, rolbypassrls must be false. Either true = RLS is a no-op for this connection.

-- 2. Confirm FORCE RLS is actually set on the tenant tables (not just RLS "enabled",
--    which table owners still bypass by default — FORCE is what closes that hole).
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN ('insurance_claim', 'call_attempt', 'phi_vault_entry'); -- etc., the RLS-covered tables
-- relforcerowsecurity must be true.
```

Then, ideally, actually run `tests/rls.strict.test.ts` with `COLLECTRX_RLS_TEST_STRICT=1` pointed at the production (or a production-mirror staging) role directly — the same proof CI already produces against its throwaway role, just against the role that matters.

**Options:**

| Option | What it requires | Tradeoff |
|---|---|---|
| **A — One-time manual verification (recommended, minimum bar)** | Whoever holds Fly Postgres admin access runs the two queries above against the production DB role once, records the result in `PRE-LAUNCH-STATUS.md` §3.2 with a date, and fixes the role (`ALTER ROLE ... NOSUPERUSER NOBYPASSRLS` or provisions a new restricted role and rotates `DATABASE_URL` to it) if it fails. Cheap, closes the gap for launch. | Doesn't protect against the role being changed later (e.g., a future ops action that re-grants superuser for a one-off maintenance task and forgets to revoke it). |
| **B — A + a standing runtime check (implemented on this pass)** | In addition to A, add a startup check that runs query 1 above and refuses to serve traffic / alerts loudly if the connected role is superuser or has `BYPASSRLS`. | Small amount of new code, but turns a silent, undetectable failure mode into a loud one permanently — worth it given how quietly this fails today. This is the only option that survives a future credential-rotation mistake. |
| **C — Do nothing, rely on defense-in-depth** | None. | The Prisma-layer `practiceId` scoping in application code is real and would still be the operative tenant boundary — this isn't "no isolation at all" if RLS silently no-ops. But it means RLS is providing zero actual protection against exactly the class of bug it exists to catch (an app-layer query that forgets a `practiceId` filter), while every doc in the repo describes it as active. Not recommended given how easy A is. |

**Recommendation:** A now, as part of the go-live checklist (it's minutes of work for whoever has prod DB access) — this is the one item in this doc that's pure verification with no design ambiguity, so there's no reason to leave it as a bare checkbox. B is worth scheduling as a near-term follow-up once A confirms the current state, since it's the only option that catches future drift rather than just today's state.

**Shipped on this pass — Option B's code half:** `Collect-RX-main/src/server/db/rlsRoleGuard.ts` (`assertRlsRoleSafeInProduction`), wired into server boot right after `connectDatabase()` in `src/server/index.ts`. In production, it queries `pg_roles` for the connected role's `rolsuper`/`rolbypassrls` flags and calls `process.exit(1)` with a message pointing at this doc if either is true; a diagnostic-query failure logs but does not crash (this guard must not become a new outage cause on its own); `COLLECTRX_RLS_ROLE_GUARD=0` is a temporary escape hatch for the window between discovering an unsafe role and rotating `DATABASE_URL`. Covered by `tests/rlsRoleGuard.test.ts` (13 tests: skip outside prod, skip when RLS is intentionally off, safe-role pass, unsafe-role exit, escape hatch, and query-failure non-fatal behavior) — all against a mocked Prisma client, no live DB required. **This code cannot verify Option A on its own** — it only reports what the role is the *next time the app boots against it*; someone still needs to trigger a production deploy (or run the two manual queries in the meantime) to actually get the result for today.

---

## How to close these out

- **#1 (TELUS timing):** shipped on this pass — docs and the dead unreachable branch are now honest about the flat 30-day floor. What's still open is a product decision on whether to move either carrier group (TELUS to 21 days, the other five to 32) off that flat floor — see the recommendation above for why those are two separate calls, not one.
- **#2 (PHIPA):** needs legal/privacy review kicked off (long pole); Option B's doc/runbook update can ship immediately and independently.
- **#3 (RLS role):** Option B's runtime guard is shipped and tested — it will refuse to boot against an unsafe role in production from the next deploy onward. Option A's actual verification (what the role is *today*, before that deploy happens) still needs whoever holds Fly Postgres production credentials to run the two queries above, or to trigger a production deploy and watch the boot log for the guard's result.

None of these block the rest of the launch checklist in [PATH-TO-DELIVERY.md](PATH-TO-DELIVERY.md) — they're tracked separately here because each needs a decision-maker outside engineering, not because they're blocked on more code.
