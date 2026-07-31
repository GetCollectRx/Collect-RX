# CSV-first AR expansion — rollout

## Migration

Apply on staging before production:

```bash
cd Collect-RX-main
npx prisma migrate deploy
```

Migration: `20260712213000_csv_ar_expansion` — adds `recovery_mode`, organization tables, PHI access events, denial/evidence/submission/underpayment models with RLS.

## Practice operating modes

| `recovery_mode` | Behavior |
|-----------------|----------|
| `CSV_FIRST` (default) | Payment verification closes on claims CSV re-import; EMR outbox writeback skipped |
| `PMS_WRITEBACK` | Legacy AbelDent/desktop sync path; EMR outbox active |

Set per practice in `Practice.recovery_mode` (admin/DB only for v1).

## CSV templates

### Claims (existing)

Required: claim ID, carrier, outstanding balance, patient PHI columns for call dispatch.

Optional new columns: `Expected Amount`, `Amount Paid`, `Denial Code`, `Transaction Type` (T11).

### EOB / remittance

`POST /api/admin/sync/import/eob` — multipart CSV with:

- Claim Number, Carrier, Paid Amount, Expected Amount, Reason Code, Remittance Date

### Pre-visit appointments

`POST /api/pre-visit/appointments/import-csv` — `text/csv` body with:

- Appointment Date, Carrier, Procedures (CDT codes), patient name/DOB/subscriber ID, optional Appointment ID

## Feature flags

Per-practice pause via `feature_flags.feature`:

- `csv_ar.denial_hub`
- `csv_ar.eob_reconciliation`
- `csv_ar.previsit_csv`
- `csv_ar.carrier_intelligence`
- `csv_ar.ar_command_center`
- `csv_ar.dso_console`
- `csv_ar.compliance_workspace`

Default: **enabled** when no row exists. Insert `paused=true` to stage rollout.

## API surfaces

| Area | Routes |
|------|--------|
| Denials & evidence | `/api/insurance/denials`, `/claims/:id/evidence`, attest, submissions, evidence-pack |
| Underpayments | `/api/insurance/underpayments`, `POST /claims/:id/underpayments` |
| AR command center | `/api/desk/:practiceId/ar-inbox`, `/managed-recovery` |
| Carrier intelligence | `/api/insurance/carrier-intelligence/feed`, `/api/group/carrier-lessons/*` |
| Compliance workspace | `/api/compliance/workspace/phi-access`, `/export-bundle` |
| DSO | `/api/group/practices-summary`, `/compliance/export` |

## UI

- **Claims → Denials & docs** tab
- **Claim detail → Denial & documentation** panel
- **AR command center** (`/ar-command-center`)
- **Carrier stats → approved lessons feed**

## Verification

```bash
npm test
npx vitest run tests/csv-ar-expansion.test.ts
```

Run DB-backed RLS tests on staging (`DATABASE_URL` with Postgres).

## Deferred (post-v1)

Encrypted clinical evidence vault — see `OUTSTANDING-FIXES-PRODUCT-READY.md`.
