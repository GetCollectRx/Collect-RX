# PHIPA deletion / breach notification — interim manual process

**Status:** interim, engineering-authored operational runbook — not counsel-reviewed legal guidance. This exists because `PHIPADeletionRequest`/`PHIPABreachNotification` are schema with zero implementation behind them (see [`HUMAN-DECISIONS-PENDING.md`](../operations/HUMAN-DECISIONS-PENDING.md) item 2 and [`PHIPA-DELETION-TEST-GUIDE.md`](PHIPA-DELETION-TEST-GUIDE.md)) — until that's built and legal-reviewed, requests are handled by a human following the steps below, not by the app. Replace this document with the real automated workflow once it ships; don't let both exist at once.

Before using this runbook for a real request, get Legal/Privacy Officer sign-off that this interim process is acceptable — this doc is a starting point for that conversation, not a substitute for it.

---

## Scope

CollectRx's tenant is the dental practice, not the patient directly (see root `CLAUDE.md` — "Practice → Insurance AR recovery"). Patients don't have CollectRx accounts. In practice, a PHIPA deletion or breach-related request will almost always arrive at the **practice**, which is the HIC (health information custodian) under PHIPA — CollectRx is their agent/processor. This runbook covers what CollectRx engineering/ops does once a practice (or, rarely, a patient contacting CollectRx directly) asks CollectRx to act.

## 1. Deletion request (PHIPA ss.37–39)

1. **Intake.** Request arrives via support channel. Record: requesting practice, patient identifier as given by the practice (name/DOB/claim number — whatever the practice used internally; CollectRx itself only knows the patient by `patientToken`, an opaque UUID), and date received.
2. **Resolve the `patientToken`.** Ask the requesting practice for the claim number(s) or use `InsuranceClaim` lookups scoped to their `practiceId` to find the associated `patientToken`(s). A patient may have multiple claims/tokens if imported more than once — confirm all of them before proceeding.
3. **Get a second person's sign-off before deleting anything.** No single engineer executes a real patient-data deletion unilaterally. At minimum, a second engineer or the on-call lead reviews the exact `patientToken`(s) and `practiceId` before the commands in step 4 run.
4. **Execute the purge**, scoped to `practiceId` + `patientToken` (never `patientToken` alone — a token is only unique within a practice), covering every table the automated design in `PHIPA-DELETION-TEST-GUIDE.md` already enumerates:
   - `InsuranceClaim`
   - `CallAttempt` (via the claim relation)
   - `CallTranscriptLine`
   - `EligibilitySnapshot`
   - `ClaimRecoveryAction`
   - `PhiVaultEntry` (by `token`)

   Run each `deleteMany` manually against the production database (via the same access path used for any other supervised prod operation — not ad-hoc from a developer laptop), in the order above (children before the `InsuranceClaim` row they reference, to respect foreign keys).
5. **Log it.** Because there's no automated workflow, there's no automatic audit trail either — write the audit log entries by hand:
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
   Include who requested it, who executed it, and who reviewed it (step 3) — this is the only record that a deletion happened until the automated workflow's own audit trail exists.
6. **Confirm back to the requesting practice** that the deletion is complete, in writing.
7. **Backups:** deleted rows persist in point-in-time backups until they age out. Flag this to whoever owns backup retention (see `PATH-TO-DELIVERY.md` section F) — full purge-from-backups is a separate, larger undertaking not covered by this runbook.

## 2. Breach notification (PHIPA ss.65–68, 14-day deadline)

1. **On discovery of a suspected breach** (unauthorized access, data exposure, etc.), the 14-day notification clock starts immediately — do not wait for full triage to start it.
2. **Escalate to the Privacy Officer / Legal immediately** — this runbook does not cover legal breach-notification drafting or determining who must be notified (affected practices, patients, regulators); that's a legal judgment call, not an engineering one.
3. **Engineering's role:** identify the scope (which `practiceId`(s) and `patientToken`(s) were affected, what data was exposed, when), and log it:
   ```ts
   await prisma.auditLog.create({
     data: {
       practiceId,
       action: 'phipa_breach_notification_logged_manual',
       subjectType: 'breach',
       subjectId: crypto.randomUUID(),
       details: { notificationType, description, discoveredAt, notificationDeadline /* discoveredAt + 14 days */, affectedPatientToken },
     },
   });
   ```
4. **Set a calendar reminder for the 14-day deadline** — there's no automated deadline tracking without the real `PHIPABreachNotification` model wired up. Missing this deadline is a compliance failure independent of the breach itself.

## Known gaps in this interim process (be honest about these, don't quietly work around them)

- No self-serve patient-facing deletion request path — everything routes through a human via support.
- No automated 14-day deadline tracking or alerting.
- No dedicated PHIPA request/breach admin UI — status lives in `AuditLog` rows and whoever's tracking the support ticket.
- Deleted data can still be present in database backups (see step 7 above).

These are exactly the gaps the automated workflow (Option A in `HUMAN-DECISIONS-PENDING.md` item 2) is meant to close. This runbook is a bridge, not a destination.
