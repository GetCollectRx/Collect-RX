# PHIPA deletion / breach notification: interim manual process

> Reviewed against research 2026-10-13; not legal advice; see policy-research/SYNTHESIS.md.

**Status:** interim, engineering-authored operational runbook. Not counsel-reviewed legal guidance. This exists because `PHIPADeletionRequest` and `PHIPABreachNotification` are schema with no route, service or UI behind them (see [`HUMAN-DECISIONS-PENDING.md`](../operations/HUMAN-DECISIONS-PENDING.md) item 2 and [`PHIPA-DELETION-TEST-GUIDE.md`](PHIPA-DELETION-TEST-GUIDE.md)). Until that is built and legal-reviewed, a human handles requests by following the steps below. Replace this document with the real automated workflow once it ships. Do not let both exist at once.

Before using this runbook for a real request, get Legal/Privacy Officer sign-off that this interim process is acceptable. This doc is a starting point for that conversation, not a substitute for it.

---

## Scope

CollectRx's tenant is the dental practice, not the patient directly (see root `CLAUDE.md`, "Practice → Insurance AR recovery"). Patients don't have CollectRx accounts. In practice, a PHIPA deletion or breach-related request will almost always arrive at the **practice**, which is the HIC (health information custodian) under PHIPA. CollectRx acts as the practice's agent or processor. This runbook covers what CollectRx engineering and ops do once a practice (or, rarely, a patient contacting CollectRx directly) asks CollectRx to act.

## 1. Deletion request (no general erasure right in PHIPA)

PHIPA does not contain a general right to have records erased. It gives individuals a right of access and correction (Part V) and requires secure disposal of records (s. 13). Whether a given deletion request is honoured, and against which retention period, is a counsel decision (PENDING_COUNSEL). Source: `policy-research/health-privacy.md`, conclusion 6 and row 12.

1. **Intake.** Request arrives via support channel. Record: requesting practice, patient identifier as given by the practice (name/DOB/claim number, whatever the practice used internally; CollectRx itself only knows the patient by `patientToken`, an opaque UUID), and date received.
2. **Resolve the `patientToken`.** Ask the requesting practice for the claim number(s), or use `InsuranceClaim` lookups scoped to their `practiceId` to find the associated `patientToken`(s). A patient may have multiple claims/tokens if imported more than once. Confirm all of them before proceeding.
3. **Get a second person's sign-off before deleting anything.** No single engineer executes a real patient-data deletion unilaterally. At minimum, a second engineer or the on-call lead reviews the exact `patientToken`(s) and `practiceId` before the commands in step 4 run.
4. **Execute the purge**, scoped to `practiceId` + `patientToken` (never `patientToken` alone, because a token is only unique within a practice). Cover every table the automated design in `PHIPA-DELETION-TEST-GUIDE.md` already enumerates:
   - `InsuranceClaim`
   - `CallAttempt` (via the claim relation)
   - `CallTranscriptLine`
   - `EligibilitySnapshot`
   - `ClaimRecoveryAction`
   - `PhiVaultEntry` (by `token`)

   Run each `deleteMany` manually against the production database (via the same access path used for any other supervised prod operation, not ad-hoc from a developer laptop), in the order above (children before the `InsuranceClaim` row they reference, to respect foreign keys).
5. **Log it.** Because there's no automated workflow, there's no automatic audit trail either. Write the audit log entries by hand:
   ```ts
   await prisma.auditLog.create({
     data: {
       practiceId,
       action: 'phipa_deletion_completed_manual',
       subjectType: 'patient_token',
       subjectId: patientToken,
       details: { requestedBy, executedBy, reviewedBy, purgedTables: [...], requestedAt, completedAt: new Date().toISOString() },
     },
   });
   ```
   Include who requested it, who executed it, and who reviewed it (step 3). This is the only record that a deletion happened until the automated workflow's own audit trail exists.
6. **Confirm back to the requesting practice** that the deletion is complete, in writing.
7. **Backups:** deleted rows persist in point-in-time backups until they age out. Flag this to whoever owns backup retention (see `PATH-TO-DELIVERY.md` section F). Full purge-from-backups is a separate, larger undertaking not covered by this runbook.

## 2. Breach notification (first reasonable opportunity)

PHIPA s. 12(2) requires notice to the individual at the **first reasonable opportunity**. O. Reg. 329/04 s. 6.3 sets the prescribed circumstances for notice to the Commissioner. The text read for this runbook sets no fixed day-count deadline for either notice (`policy-research/health-privacy.md`, row 3 and conclusion 6). The contractual notification time CollectRx offers practices is a counsel decision (PENDING_COUNSEL).

1. **On discovery of a suspected breach** (unauthorized access, data exposure, etc.), open the incident record immediately. Do not wait for full triage to start it. The obligation runs from the first reasonable opportunity, not from a fixed day count.
2. **Escalate to the Privacy Officer / Legal immediately.** This runbook does not cover legal breach-notification drafting or determining who must be notified (affected practices, patients, regulators). That is a legal judgment call, not an engineering one.
3. **Engineering's role:** identify the scope (which `practiceId`(s) and `patientToken`(s) were affected, what data was exposed, and when) and log it:
   ```ts
   await prisma.auditLog.create({
     data: {
       practiceId,
       action: 'phipa_breach_notification_logged_manual',
       subjectType: 'breach',
       subjectId: crypto.randomUUID(),
       details: { notificationType, description, discoveredAt, affectedPatientToken },
     },
   });
   ```
4. **Record when the practice (custodian) was notified.** Until the `PHIPABreachNotification` model is wired to a route, this log is the only record of the notification time. Track the contractual notification deadline in the ticket until automated tracking exists (PENDING_COUNSEL for the deadline value).

## Known gaps in this interim process

These are the gaps to be honest about. Do not quietly work around them.

- No self-serve patient-facing deletion request path. Everything routes through a human via support.
- No automated tracking or alerting for the contractual breach-notification deadline.
- No dedicated PHIPA request/breach admin UI. Status lives in `AuditLog` rows and whoever is tracking the support ticket.
- Deleted data can still be present in database backups (see step 7 above).

These are exactly the gaps the automated workflow (Option A in `HUMAN-DECISIONS-PENDING.md` item 2) is meant to close. This runbook is a bridge, not a destination.
