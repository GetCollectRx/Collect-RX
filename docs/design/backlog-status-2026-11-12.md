# Backlog status, 2026-11-12

Branch `feat/staff-conference-handoff`, all uncommitted. Tests below ran in a sandbox with no database; tests that need Postgres run on your Mac or CI.

Update: no counsel is involved for now. Items that named counsel are handled by conservative built-in defaults instead (off by default, per-practice acknowledgment, no recording, no PHI in logs, no speech by the listener), and the EXTERNAL label below means a vendor, carrier or ops task, not legal review.

Legend: BUILT = code and tests in the working tree. VERIFIED = existing code checked by tests. DECISION = needs the founder. EXTERNAL = needs counsel, carriers or vendors. SPIKE = needs approval for a deploy or live call.

| # | Status | What changed or what is needed |
|---|---|---|
| B-01 | SPIKE | Conference design in `staff-conference-handoff.md`. Needs approval to deploy and a second phone to play the rep. |
| B-02 | BUILT | `staffAvailability` setting (weekly windows, pause, lead 15 and tail 30 minutes, assumed), `STAFF_UNAVAILABLE` dispatch gate, queue stops without burning attempts. Unconfigured practices are unrestricted (DECISION: keep that default?). |
| B-03 | SPIKE | Needs the conference to detect voicemail or busy on the staff leg. |
| B-04 | BUILT | A scribe log with the suspicion flag opens an escalation and a log event. It does not suspend the carrier by itself (DECISION: auto-suspend after N flags per carrier?). |
| B-05 | EXTERNAL | `listenerConsentAcknowledged` setting added and validated. Nothing reads it yet; counsel wording is pending. |
| B-06 | BUILT | Events: `handoff_attempted`, `handoff_log_received`, `handoff_no_log`, `automation_suspicion_flagged` (ids only). "Staff answered" and "seconds to answer" cannot be seen under a blind transfer. |
| B-07 | SPIKE | Needs a conference leg that can be spoken to alone. |
| B-08 | BUILT | A late scribe log fills the attempt's outcome, rep and reference. The claim status is left as escalated on purpose. |
| B-09 | BUILT | `POST /:practiceId/attempts/:attemptId/outcome` writes the same log row as the scribe. No UI yet. |
| B-10 | SPIKE | Compare the Twilio invoice with metered minutes after a real call. |
| B-11 | SPIKE | Ring groups need the conference; a blind transfer has one number. |
| B-12 | BUILT | `scripts/check-scribe-sync.cjs <assistantId>` compares the live scribe prompt and tool enum with the resolver (needs `VAPI_API_KEY`, read-only). Model sunset (2026-11-30) and 600 s max duration still need a manual check in the dashboard. |
| B-13 | BUILT | `/dashboard/setup-status` now adds carrier-ready, staff phone and staff hours steps. Patient-data completeness is still checked at dispatch only. |
| B-14 | DECISION | Start the trial clock at first dial-ready state instead of signup. Billing change; not made. |
| B-15 | DECISION | Trial limits (500 min/month, 50 min/day). Numbers live in config; pick new ones after pilot counts. |
| B-16 | BUILT | `GET /dashboard/value-report?days=7`: attempts, handoffs, hold minutes saved, claims touched, logs received, needs review. No UI yet. |
| B-17 | BUILT | `buildCoverageReport(rows)` gives the supported share of AR by count and amount. Not wired to an endpoint or the CSV flow yet. |
| B-18 | DECISION | `validateDispatch` has no mode input. Decide whether human-assisted practices get a lower floor or no ceiling. |
| B-19 | BUILT | Persisted transcripts now use the wider phone and date patterns. Names are still caught only when the patient record is known. |
| B-20 | EXTERNAL | Read each carrier's terms; per-carrier opt-in. |
| B-21 | EXTERNAL | DPAs/BAAs, pen test or written exception, backup restore test, on-call, Sentry. |
| B-22 | EXTERNAL | PHIPA deletion and exit process; counsel sign-off. |
| B-23 | VERIFIED | Usage emails already go out at 80, 95 and 100 percent and are on by default. 50 percent not added. Credit rule for hold minutes lost to our failures is a DECISION. |
| B-24 | BUILT | When calls pause (overage, payment failure, cost breaker) the practice gets one notification with the reason and next step. Carrier-block notices already existed. |
| B-25 | DECISION | Per-carrier minimum waits (21 TELUS, 32 others) are not enforced; `HUMAN-DECISIONS-PENDING.md` item 1. |
| B-26 | DECISION | Windows are fixed Eastern. Needed only when a practice outside Eastern signs up. |
| B-27 | DECISION | `PILOT_SCOPE.md` says one practice until Day 90, but self-serve signup exists. Gate signup or amend the doc. |
| B-28 | EXTERNAL | Support promise and incident comms for one operator; run a tabletop drill. |
| B-29 | DECISION | Playbook threshold and the bar for moving a carrier to autonomous (ADR 0003 open item). |
| B-30 | VERIFIED (unit level) | Line-item export (H3), vanishing claims (H4) and payment-evidence gate (H2) tests pass (145 tests in phase-5 plus 11). End-to-end run needs a database. H8 savings claim text was not found in the marketing templates. |

## Not done and why
- Nothing here was deployed, committed or dialed.
- B-01, B-03, B-07, B-10, B-11 depend on the conference spike.
- Database-backed tests (usage snapshot, vapi desk) fail to start in the sandbox for lack of Postgres and the Linux Prisma engine. They failed the same way before these changes.
