# PMS claims import — columns & idempotency (P3-30 / P3-31)

> Updated 2026-08-02 to describe the live import path. The endpoint and file
> this doc previously documented (`POST /api/admin/import-patient-csv`,
> `Collect-RX-main/src/server/patients/balances.ts`) were removed in commit
> `f69e003` as part of the patient-pay retirement — patient/client payment
> collection is out of scope (see `docs/operations/PATH-TO-DELIVERY.md`).
> Insurance-claim CSV/PMS import is a separate, still-live pipeline; this doc
> now describes that pipeline.

## Endpoint

- `POST /api/admin/sync/import/:pmsVendor` (authenticated, practice-scoped session) — see `Collect-RX-main/src/server/routes/pmsSyncRoutes.ts`, mounted at `/api/admin/sync` in `Collect-RX-main/src/server/index.ts`.
- `:pmsVendor` is a catalog vendor id (e.g. `abeldent`, `dentrix`, `other`) or `auto` to use the practice's configured default (resolved via `resolvePmsImport`).
- Multipart field name: `file` (CSV, max 12 MB), **or** a JSON body of the form `{ records: [...] }` when not uploading a file.
- Related endpoints on the same router: `GET /api/admin/sync/runs` (list recent import runs), `GET /api/admin/sync/runs/:id` (single run detail with validation/row errors), `POST /api/admin/sync/import/eob` (separate EOB/remittance import, not covered here).

## Pipeline

`runPmsImportPipeline` (`Collect-RX-main/src/server/pms/pmsImportPipeline.ts`) orchestrates each import:

1. Resolves the PMS vendor and import family (`abeldent` / `dentrix` / `generic`) via `resolvePmsImport`.
2. Creates a `pmsImportRun` row (status `running`) recording `recordsTotal` and the caller-supplied `sourceRecordCount` / `sourceBalanceTotal` (when the export file states its own totals, for drift comparison).
3. Calls `importPmsClaimsToPrisma` (`Collect-RX-main/src/server/pms/prismaClaimImporter.ts`) to upsert each row.
4. Calls `validateImportTotals` (`Collect-RX-main/src/server/pms/importValidation.ts`) to compare imported record count/balance total against the source-stated totals and compute `driftPct`.
5. Updates the `pmsImportRun` with final status (`success` / `partial` / `validation_failed` / `failed`), counts, and an `errorLog` (validation messages + first 50 row errors).
6. Re-syncs work queue items for the practice (`syncWorkItemsForPractice`) and records the practice's active PMS vendor.

## Column headers

Row values are read via flexible header matching in `Collect-RX-main/src/server/pms/parseExportRows.ts` (`getCell` tries several header spellings per field, case-insensitively) — there is no fixed canonical-header list to configure. Examples of accepted headers per field:

| Field | Accepted headers (examples) |
|---|---|
| Claim number | `Claim ID`, `ClaimID`, `Claim Number`, `claim_number`, `Ref`, `id` |
| Patient first/last name | `Patient First Name`/`First Name`/`patient_first_name`/`fname`, similarly for last name |
| Carrier | `Insurance Carrier`, `Carrier`, `carrier_name`, `Plan Name`, etc. |
| Procedure code | `Procedure Code`, `Code`, `CDT`, `cdt_code` |
| Outstanding amount | `Amount Outstanding`, `Balance`, `Ins Balance`, `Patient Balance` |
| Service / submission dates | `Date of Service`/`DOS`/`treatment_date`; `Submission Date`/`Submitted Date` |
| PHI fields (DOB, subscriber ID, group number, subscriber name) | see `parseExportRows.ts` — never persisted to the database, only passed to the PII vault |

A row with no resolvable claim number throws and is counted under `failed`, not `skipped`.

## Idempotency

The mechanism is a Prisma upsert keyed on the `practiceId_claimNumber` unique constraint on `InsuranceClaim` (`upsertInsuranceClaim` in `prismaClaimImporter.ts`):

- If no existing claim matches `(practiceId, claimNumber)`, a new `InsuranceClaim` is created.
- If a matching claim exists, it is **updated in place** — outstanding amount, billed amount, carrier, PHI token, and (when present in the new row) `submittedAt`, `treatmentCodes`, `expectedAmount`, and denial fields are refreshed. The PHI token is re-tokenized on every re-import so corrected patient data reaches call dispatch.
- Re-importing the same file (or an updated export covering the same claims) therefore **updates existing claims rather than duplicating them** — idempotency is keyed on claim number, not on file identity or a request hash.
- A row whose outstanding amount is `<= 0` and has no existing open claim is **skipped** (never created); if it matches an existing open claim, that claim's outstanding amount is zeroed out (treated as resolved), not deleted.
- A row that fails to normalize (missing claim number) or has an unrecognized carrier is **failed**, not imported, and recorded in `errors`.

## Response shape

`RunPmsImportResult` (`pmsImportPipeline.ts`): `{ runId, pmsVendor, status, validationPassed, imported, skipped, failed, driftPct, errors: [{ claimNumber?, error }], paymentsVerified, dollarsRecoveredSyncVerified, ediMigrationRequired?, ediVersionStatus?, ediVersionMessage? }`, wrapped as `{ success: true, ...result }` by the route handler.
