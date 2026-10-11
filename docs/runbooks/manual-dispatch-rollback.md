# Manual "Call now": staged release, rollback and resume

Applies to `POST /api/insurance/queue/trigger/:claimId` (the Call now buttons).
Every SQL block below is exercised by `Collect-RX-main/tests/step1/manualDispatchRunbook.integration.test.ts`,
which extracts the blocks from this file and runs them against Postgres. Running
any of them on production changes production data and needs separate approval.

## What the flag controls

The route dials through the shared dispatch decision, call builder and claim
reservation. Feature key: `dispatch.manual_shared_builder`, stored as
`feature_flags` rows, one per practice, or a global row (`practice_id` NULL).

Resolution, most specific first:

1. **A row for the practice decides**: `paused = false` is on, `paused = true` is off.
2. Otherwise **a paused global row** turns it off.
3. Otherwise **it is ON**.

**Default-on.** With no row at all the feature is on. So merging and deploying
this change without any row in place turns the new manual path on for every
practice at the moment the new build starts. Placing a global pause row *before*
the deploy is what makes the release staged.

**When it is off the route does not dial.** It answers `503` with code
`MANUAL_DISPATCH_PAUSED` and reserves nothing. The previous manual path is
deliberately not kept: it could not select the human-assisted squad, so keeping
it as a fallback would send Hold Sentinel practices to whatever `VAPI_SQUAD_ID`
names. Rollback therefore disables manual calling; the automatic queue is not
affected. The payer-program rule and the other guard checks run before the flag
is read, so they apply either way.

## Statements

Replace `<practice id>` with one practice's id. Each statement names its scope
exactly; none of them touches another practice's row. The practice statements use
`ON CONFLICT (practice_id, feature)`, which is the table's unique key. A global
row has a NULL `practice_id`, which that key does not constrain, so the global
statements are written to be safe to repeat.

Check the current rows first:

```sql
-- runbook:show
SELECT practice_id, paused, pause_reason, paused_at
FROM feature_flags
WHERE feature = 'dispatch.manual_shared_builder'
ORDER BY practice_id NULLS FIRST;
```

Pause everything (global):

```sql
-- runbook:pause-global
UPDATE feature_flags
SET paused = true, pause_reason = 'staged release / rollback', paused_at = now(), updated_at = now()
WHERE feature = 'dispatch.manual_shared_builder' AND practice_id IS NULL;
INSERT INTO feature_flags (id, practice_id, feature, paused, pause_reason, paused_at, resume_requires_manual_confirmation, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'dispatch.manual_shared_builder', true, 'staged release / rollback', now(), true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM feature_flags WHERE feature = 'dispatch.manual_shared_builder' AND practice_id IS NULL
);
```

Remove the global pause (only the global row):

```sql
-- runbook:resume-global
DELETE FROM feature_flags
WHERE feature = 'dispatch.manual_shared_builder' AND practice_id IS NULL;
```

Enable one practice while a global pause is in place:

```sql
-- runbook:enable-practice
INSERT INTO feature_flags (id, practice_id, feature, paused, pause_reason, paused_at, resume_requires_manual_confirmation, created_at, updated_at)
VALUES (gen_random_uuid(), '<practice id>', 'dispatch.manual_shared_builder', false, NULL, NULL, true, now(), now())
ON CONFLICT (practice_id, feature) DO UPDATE
SET paused = false, pause_reason = NULL, paused_at = NULL, updated_at = now();
```

Pause one practice (works with or without a global pause):

```sql
-- runbook:pause-practice
INSERT INTO feature_flags (id, practice_id, feature, paused, pause_reason, paused_at, resume_requires_manual_confirmation, created_at, updated_at)
VALUES (gen_random_uuid(), '<practice id>', 'dispatch.manual_shared_builder', true, 'practice rollback', now(), true, now(), now())
ON CONFLICT (practice_id, feature) DO UPDATE
SET paused = true, pause_reason = 'practice rollback', paused_at = now(), updated_at = now();
```

Remove one practice's row (it then follows the global state, or the default):

```sql
-- runbook:clear-practice
DELETE FROM feature_flags
WHERE feature = 'dispatch.manual_shared_builder' AND practice_id = '<practice id>';
```

Roll back every practice that was enabled, and keep everything paused:

```sql
-- runbook:rollback-all
UPDATE feature_flags
SET paused = true, pause_reason = 'rollback', paused_at = now(), updated_at = now()
WHERE feature = 'dispatch.manual_shared_builder' AND practice_id IS NOT NULL AND paused = false;
UPDATE feature_flags
SET paused = true, pause_reason = 'rollback', paused_at = now(), updated_at = now()
WHERE feature = 'dispatch.manual_shared_builder' AND practice_id IS NULL;
INSERT INTO feature_flags (id, practice_id, feature, paused, pause_reason, paused_at, resume_requires_manual_confirmation, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'dispatch.manual_shared_builder', true, 'rollback', now(), true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM feature_flags WHERE feature = 'dispatch.manual_shared_builder' AND practice_id IS NULL
);
```

Never run `DELETE ... WHERE feature = 'dispatch.manual_shared_builder'` without a
`practice_id` condition: it removes every practice's row, including pauses placed
on purpose.

## Staged release, step by step

Preconditions (see "Before releasing" below): V1 known, the import-client plan in
`docs/operations/import-payer-type-compatibility.md` done, the PR merged and
approved for release.

1. **Before the deploy**, run `runbook:pause-global`, then `runbook:show` and confirm one global row with `paused = true`.
2. **Deploy.** The new build starts with manual calling off everywhere.
3. **Verify off.** From any practice session, click Call now on an eligible claim. Expected: `503 MANUAL_DISPATCH_PAUSED`, no call, claim unchanged. (This places no call.)
4. **Enable the pilot practice**: `runbook:enable-practice` for that one practice. Confirm the guard's refusals still apply to it (a CDCP claim gets `PAYER_PROGRAM_NOT_ENABLED`).
5. **First real manual call** (needs its own authorization): confirm it goes to the human-assisted squad and the attempt row shows `is_human_assisted = true`.
6. **Widen** in waves: `runbook:enable-practice` for each next practice. Watch `claim has no payerType`, `CARRIER_CONCURRENCY_LIMIT`, and any `VAPI_CALL_NOT_CANCELLED` or `VAPI_DISPATCH_OUTCOME_UNKNOWN` escalations.
7. **Finish**: run `runbook:resume-global` (removes only the global row). Every practice now follows the default (on). The practice rows with `paused = false` are redundant and can stay; remove one with `runbook:clear-practice`.

**Rollback at any point:** `runbook:rollback-all` (or `runbook:pause-global` if no practice was enabled). Manual calling stops everywhere; the scheduler keeps running.
**Pause or resume one practice:** `runbook:pause-practice` / `runbook:clear-practice`. These touch that practice's row only.

## Before releasing

1. **Know what `VAPI_SQUAD_ID` points to (V1).** The old manual route used it. A Hold Sentinel practice's manual call now goes to the human-assisted squad, as the scheduler's does.
2. **Imports now require a payer type for new claims** (a "Payer Type" column, or `defaultPayerType` for the file). Automated clients that send neither will have new claims rejected. Follow `docs/operations/import-payer-type-compatibility.md`.
3. Claims with no payer type keep working (treated as PRIVATE, logged). Re-importing with a declared type classifies them.
4. A call that may exist but cannot be confirmed or ended now leaves an `ESCALATED` claim and an open escalation instead of re-entering the queue. Staff need to know to look at the Escalations page for `VAPI_CALL_NOT_CANCELLED` / `VAPI_DISPATCH_OUTCOME_UNKNOWN`.
