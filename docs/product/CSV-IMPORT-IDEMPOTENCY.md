# Patient AR CSV import — columns & idempotency (P3-30 / P3-31)

## Endpoint

- `POST /api/admin/import-patient-csv` (authenticated)
- Multipart field name: `file` (text/csv, max 5 MB)

## Column headers

Headers are normalized to **snake_case** (e.g. `Patient First Name` → `patient_first_name`), then optional **aliases** map to canonical field names (P3-30) — see `HEADER_ALIASES` in `Collect-RX-main/src/server/csv/parseSimple.ts`. Examples:

| Typical export label | Resolves to |
|----------------------|-------------|
| `first_name`, `fname` | `patient_first_name` |
| `last_name`, `lname` | `patient_last_name` |
| `balance`, `owes`, `amount_owed` | `patient_owes` |
| `dos`, `service_date` | `treatment_date` |
| `cdt`, `cdt_code`, `proc_code` | `procedure_code` |
| `abeldent_id`, `patient_id` (external) | `abeldent_patient_id` |

If two columns map to the same canonical field, **the later column in the file wins**.

**Required** for a row to be **imported** (per `upsertBalances` in `Collect-RX-main/src/server/patients/balances.ts`):

- `patient_first_name`, `patient_last_name`, `patient_owes` (numeric, &gt; 0)

**Optional** / used when present:

- `abeldent_patient_id`, `treatment_date`, `procedure_code`, `procedure_description`, `patient_email`, `patient_phone`, `amount_billed`, `insurance_paid`, `adjudication_date`, `days_since_adjudication`

**Validation:** rows that fail checks are **not** imported; they add an entry to `errors` with a `Row {line} — {name?}` label and a message. Completely blank data rows are skipped with no error.

## Idempotency (P3-31)

- If `abeldent_patient_id`, `treatment_date`, and `procedure_code` are all present and match an **existing** row for the same `practiceId`, the row is **updated** (not inserted), unless the existing row is already `paid` or `written_off` (then skipped).
- Re-uploading the same file should **not** create duplicate open balances for the same procedure line.

## Response shape

`{ ok: true, imported, updated, skipped, errors: [{ patient, error }] }`
