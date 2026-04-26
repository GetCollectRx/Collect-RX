# Eligibility estimate + reconciliation persistence (P3-40 / P3-42)

## Estimates — `EligibilityEstimateLog`

- **Write:** `POST /api/eligibility/estimate` appends a row with `requestJson` and `resultJson` (`{ estimate }`).
- **Read:** `GET /api/eligibility/status/:patientId/:carrier` returns `{ success, lastEstimate }` where `lastEstimate` is the **most recent** saved `estimate` object for that patient and carrier.

## Reconciliation — `EligibilityReconcileLog` (P3-42)

- **Write:** `POST /api/eligibility/reconcile` computes the reconciliation and, on success, stores:
  - `adjudicationJson` — payload you sent
  - `resultJson` — full `ReconciliationResult` (variance, flag, reasons, etc.)
  - `patientId`, `estimateId`, optional `claimId`, optional `practiceId`

- **Read / compare:** `GET /api/eligibility/reconcile/history/:estimateId?limit=20` returns `{ success, runs }` (newest first). Use two or more runs with the same `estimateId` to compare adjudications or re-runs side by side (e.g. corrected EOB).

**Migration:** `EligibilityReconcileLog` is created by Prisma migration `20260424120000_eligibility_reconcile_log`.
