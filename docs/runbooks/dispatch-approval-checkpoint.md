# Dispatch approval checkpoint (DEC-9 b)

Staff approve automated calling to a carrier once per practice, before the first call to that carrier. This replaces PR #87's per-claim default of PENDING_REVIEW, which would have stalled all calling until every queued claim was reviewed.

## Behaviour

- Scope: one approval per practice and carrier. Approving Sun Life for a practice does not approve Manulife, and does not approve Sun Life for any other practice.
- Enforced inside `validateDispatch()`, so the scheduler and the manual "Call now" route both stop on the same check. Code: `PENDING_DISPATCH_APPROVAL`.
- A refusal creates the checkpoint request (status PENDING, with a REQUESTED event) if none exists. Concurrent ticks create it once.
- The scheduler parks the queue entry with the deferral code and does not count an attempt or escalate the claim. Approving releases parked entries for that carrier immediately; revoking stops new dials. A call already in progress is not interrupted.
- Manual route: HTTP 422 with `code: PENDING_DISPATCH_APPROVAL`.
- Audit trail: `dispatch_checkpoint_events` is append-only (the database rejects UPDATE and DELETE). Each event records the action, the acting user id, the time, the number of queued claims for the carrier at decision time, and optional notes. No claim or patient data is stored.
- API (practice owner sessions only; front desk gets 403): `GET /api/dispatch-checkpoints`, `POST /api/dispatch-checkpoints/:id/decision` with `{ "decision": "APPROVED" | "REVOKED", "notes": "..." }`.

## Default is OFF

The rollout flag is `dispatch.approval_checkpoint` in `feature_flags`. Unlike `dispatch.manual_shared_builder`, no row means the checkpoint is NOT enforced, so deploying the code changes nothing.

Resolution: practice row decides (`paused = false` means enforced), else a global row decides, else off.

## Staged release

1. Deploy. Nothing is enforced.
2. Enforce for one practice:

```sql
-- runbook:enable-practice
INSERT INTO feature_flags (id, practice_id, feature, paused, resume_requires_manual_confirmation, created_at, updated_at)
VALUES (gen_random_uuid(), '<practice id>', 'dispatch.approval_checkpoint', false, false, now(), now())
ON CONFLICT (practice_id, feature) DO UPDATE SET paused = false, updated_at = now();
```

3. The practice owner approves each carrier they want called (API above). Until then calls to that carrier wait and the queue shows `PENDING_DISPATCH_APPROVAL`.
4. To enforce for every practice without its own row, enable the global row last:

```sql
-- runbook:enable-global
UPDATE feature_flags SET paused = false, updated_at = now()
WHERE feature = 'dispatch.approval_checkpoint' AND practice_id IS NULL;
INSERT INTO feature_flags (id, practice_id, feature, paused, resume_requires_manual_confirmation, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'dispatch.approval_checkpoint', false, false, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM feature_flags WHERE feature = 'dispatch.approval_checkpoint' AND practice_id IS NULL
);
```

## Rollback

- Stop enforcing for one practice (touches only that practice's row):

```sql
-- runbook:disable-practice
UPDATE feature_flags SET paused = true, pause_reason = 'checkpoint rollback', paused_at = now(), updated_at = now()
WHERE feature = 'dispatch.approval_checkpoint' AND practice_id = '<practice id>';
```

  Entries parked by the checkpoint retry on their next deferral expiry (up to 4 hours); to retry sooner, clear their deferral code.
- Stop enforcing everywhere (touches only the global row; practices with their own enabled row stay enforced):

```sql
-- runbook:disable-global
UPDATE feature_flags SET paused = true, pause_reason = 'checkpoint rollback', paused_at = now(), updated_at = now()
WHERE feature = 'dispatch.approval_checkpoint' AND practice_id IS NULL;
```

- Revoke one carrier without turning the feature off: `decision: REVOKED`.
- Rows in `dispatch_checkpoints` and `dispatch_checkpoint_events` are not removed by a rollback; the events are the audit record.

## Not in this change

- No staff-facing page. Approval is by API only until a page is built (PR #87's `DispatchApprovals.tsx` is per-claim and would need to be reworked to per-carrier).
- Permission shape: owner-only. Whether office managers or billing roles may also approve is a product decision.
- The measure for DEC-9 (staff review minutes in the value metric) needs the page, or the API call timestamps, to be collected.
- Retention: events carry no PHI but are append-only, so practice deletion does not remove them. Confirm that is acceptable before release.
