# PMS integration plan (P3-32) — outline

**Scope:** Long-term path from today’s **CSV / admin upload** to a **live or scheduled connector** (AbelDent, Dentrix, etc.).

| Phase | Deliverable | Notes |
|--------|-------------|--------|
| 1 (now) | CSV + idempotent `upsertBalances` | Documented in [CSV-IMPORT-IDEMPOTENCY.md](CSV-IMPORT-IDEMPOTENCY.md). |
| 2 | File drop or SFTP | Staging folder watched by a worker; same CSV contract. |
| 3 | Read API or vendor agent | Per-vendor spike (time-boxed). **BAA** and data-processing agreements with the practice and any vendor before **production PHI**; protocol choice (proprietary API vs HL7/FHIR vs file) per vendor. |
| 4 | Reconciliation | Tie PMS line ↔ `PatientBalance` with stable external IDs. |

**Epics (rough sequencing):** (a) **Vendor** shortlist + connector ROI; (b) **Protocol** proof (read-only export or API) in a sandbox; (c) **Legal** / BAA path with clinic and, if needed, PMS host; (d) **Timeline** — treat v1 as CSV+manual; target automated sync only after a successful phase-3 spike.

**Exit criteria for “v1 connector”:** defined sync frequency, error alerting, and rollback if a bad file ships.
