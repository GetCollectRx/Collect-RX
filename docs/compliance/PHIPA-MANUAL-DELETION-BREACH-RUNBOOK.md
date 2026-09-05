# PHIPA deletion / breach requests — manual process (interim)

**Status:** Interim manual process, shipped 2026-08-19. This is Option B from
[`docs/operations/HUMAN-DECISIONS-PENDING.md`](../operations/HUMAN-DECISIONS-PENDING.md) item 2 —
a documentation/runbook fix so the product stops implying a self-serve deletion/breach flow that
doesn't exist yet. It is **not** the automated workflow (Option A in that doc), which still needs
Legal/Privacy sign-off before any engineering work starts against `PHIPADeletionRequest` /
`PHIPABreachNotification` (see `prisma/schema.prisma` and
[`PHIPA-DELETION-TEST-GUIDE.md`](./PHIPA-DELETION-TEST-GUIDE.md) for the design those models were
built against).

Do not treat this runbook as a substitute for that sign-off, and do not start wiring the real
Prisma models into a route/cron based on this doc alone.

## When this applies

A patient (via the practice) or a practice asks CollectRx to:
- delete a patient's personal health information (PHIPA ss.37–39 access/deletion rights), or
- CollectRx becomes aware of, or is asked about, a possible breach (PHIPA ss.65–68, 14-day
  notification deadline once a breach is confirmed).

## Process

1. **Intake.** The request arrives as a support ticket, not a product action. Record: who asked
   (practice contact, or patient via the practice), what claim(s)/patient(s) are in scope, and the
   date the request was received — the 14-day breach-notification clock (if applicable) starts
   from confirmation of the breach, not from ticket creation, but both dates must be logged.
2. **Scope the deletion.** Confirm with the requesting practice what "delete" needs to cover.
   Practices have independent record-retention obligations for billing/insurance records — do not
   delete data the practice is legally required to keep without their explicit confirmation that
   deletion is what they want and that they understand the retention implications.
3. **Engineer runs a scoped, logged deletion.** An engineer with database access runs a targeted
   deletion against the specific claim/patient rows identified in step 2 — never a bulk or
   unscoped operation. Capture the operation (what was deleted, when, by whom, at whose request)
   in the ticket. This is manual today; it is exactly the gap Option A (the automated workflow)
   is meant to close.
4. **Breach notification (if applicable).** If the request involves a confirmed breach, notify the
   affected practice within the 14-day window per PHIPA s.65-68. Notification content and
   recipients should be reviewed against `docs/compliance/LEGAL-REVIEW-PROMPT.md`'s package before
   send if this hasn't been done for a prior incident — this runbook does not replace that review.
5. **Close the loop.** Confirm completion with the requester and close the ticket with the
   deletion/notification record attached. This ticket record is the audit trail for this request
   until the automated workflow exists.

## What this runbook deliberately does not do

- It does not create, read, or update `PHIPADeletionRequest` / `PHIPABreachNotification`.
- It does not change `tests/phipaCompliance.test.ts`, which tests that scoped multi-table deletion
  is mechanically possible — not that a request can be filed, tracked, or resolved by a
  non-engineer. That gap is exactly what Option A closes.
- It does not decide who besides the practice may file a request directly, what "delete" means
  when it conflicts with a practice's own retention duty, or how long this audit trail itself
  should survive after the underlying data is purged — those are the open questions in
  `HUMAN-DECISIONS-PENDING.md` item 2 that need Legal/Privacy sign-off before Option A is built.
