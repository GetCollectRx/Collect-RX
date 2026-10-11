# Manual "Call now": rollout flag and rollback

Applies to `POST /api/insurance/queue/trigger/:claimId` (the Call now buttons).

## What the flag controls

The route dials through the shared dispatch decision, call builder and claim
reservation (`src/server/frontDesk/dispatchDecision.ts`, `dispatchCallBuilder.ts`,
`dispatchReservation.ts`). Feature key: `dispatch.manual_shared_builder`, stored
as a `FeatureFlag` row, per practice or global (`practice_id` null).

- **No row, or no paused row: ON.** The route uses the shared path.
- **A paused row at either scope: OFF (rollback).** The route does **not dial**.
  It answers `503` with code `MANUAL_DISPATCH_PAUSED` and reserves nothing. The
  previous manual path is deliberately not kept: it could not select the
  human-assisted squad, so keeping it as a fallback would put Hold Sentinel
  practices on whatever squad `VAPI_SQUAD_ID` names.
- The scheduler is not affected by the flag.
- The payer-program rule (CDCP and provincial claims are never dialed) and the
  other guard checks run **before** the flag is read, so they apply either way.

## Pause (roll back) and resume

These change production data, so run them only with approval.

```sql
-- Pause manual calling for every practice
INSERT INTO feature_flags (id, practice_id, feature, paused, pause_reason, paused_at, resume_requires_manual_confirmation, created_at, updated_at)
VALUES (gen_random_uuid(), NULL, 'dispatch.manual_shared_builder', true, 'rollback: <reason>', now(), true, now(), now());

-- Pause for one practice
INSERT INTO feature_flags (id, practice_id, feature, paused, pause_reason, paused_at, resume_requires_manual_confirmation, created_at, updated_at)
VALUES (gen_random_uuid(), '<practice id>', 'dispatch.manual_shared_builder', true, 'rollback: <reason>', now(), true, now(), now());

-- Resume: remove the paused rows
DELETE FROM feature_flags WHERE feature = 'dispatch.manual_shared_builder' AND paused = true;
```

Confirm the table and column names against the deployed schema before running
(`prisma/schema.prisma`, model `FeatureFlag`).

## Before releasing

1. **Know what `VAPI_SQUAD_ID` points to (V1).** Until now the manual route used
   it. After this change a Hold Sentinel practice's manual call goes to the
   human-assisted squad, as the scheduler does.
2. **Imports now require a payer type for new claims.** Rows can carry a
   "Payer Type" column, or the upload declares one for the file
   (`defaultPayerType`). The CSV upload page asks. **Automated clients that post
   claims without either will have new claims rejected until they send
   `defaultPayerType`**: the AbelDent desktop connector
   (`POST /api/connector/claims/import`) and any scripted
   `POST /api/admin/sync/import`. Update those before release.
3. Claims with no payer type are treated as PRIVATE and logged
   (`claim has no payerType`). Re-importing them with a declared type classifies them.
