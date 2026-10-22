# 06. Retention and disposal schedule

> DRAFT. Not reviewed by a lawyer. Positions per the founder's signed risk register (R7 unsigned; reviewer recommended MODIFY). Every period below is PENDING_FOUNDER_DECISION. Open items listed at the end.

## Purpose

Set how long each kind of data is kept, what ends its life, and how it is disposed of, so the retention job (`src/server/jobs/dataRetentionJob.ts`) can be configured from a signed schedule rather than code defaults.

## Who it binds

CollectRx systems and staff. Practices keep their own records under their college standards; CollectRx holds working copies.

## Obligations implemented

| Obligation | Source (research file#row) | Tag |
|---|---|---|
| Retain, transfer and dispose of securely; keep records subject to an access request until recourse is exhausted | PHIPA s.13(1), (2) (health-privacy.md#12) | VERIFIED |
| Retention guidelines with minimum and maximum periods; destroy, erase or anonymize when no longer needed | PIPEDA Sched. 1 cl. 4.5.2, 4.5.3 (private-sector-privacy.md#10) | VERIFIED |
| Quebec: destroy or anonymize when purposes achieved, subject to legal preservation periods | P-39.1 s.23 | VERIFIED |
| BC: one year after use in a decision | BC PIPA s.35 (earlier research) | VERIFIED (earlier pass) |
| Practice-side minimums (dental records) | RCDSO Guidelines: ten years from last entry; claim forms two years (FSRA-RCDSO-QUEBEC.md#5) | EXCERPT |
| Breach records 24 months | SOR/2018-64 (private-sector-privacy.md#12) | VERIFIED (earlier pass) |

## Principles

1. CollectRx is not the practice's record of care or billing. The practice's PMS holds the record. CollectRx keeps only what it needs to follow up and to show the practice what happened.
2. Nothing is purged until this schedule is signed and the job's dry run has been reviewed (register R7 default: purge stays off).
3. Legal hold (access request, dispute, incident investigation) suspends deletion for the affected rows.
4. On offboarding: export to the practice on request, then delete within the period in 02 clause 9.

## Schedule

| Data | Where | Life ends at | Proposed period | Status |
|---|---|---|---|---|
| Patient identifiers (vault) | `PhiVaultEntry` | Claim resolved or abandoned | PENDING_FOUNDER_DECISION (vault TTL default 120 days in code; must cover up to 3 attempts over days, per reviewer) | PENDING_FOUNDER_DECISION |
| Claim records and outcomes | `InsuranceClaim`, `CallAttempt` outcome fields | Claim resolved | PENDING_FOUNDER_DECISION (code default 12 months after resolution) | PENDING_FOUNDER_DECISION |
| Call transcripts (CollectRx copy) | `CallAttempt.transcriptText`, `CallTranscriptLine` | Call completed | PENDING_FOUNDER_DECISION (shorter than claim record; outcome fields carry what the practice needs) | PENDING_FOUNDER_DECISION |
| Vendor-side transcripts, logs, recordings | Vapi, STT, TTS, LLM vendors | Call completed | Zero if Vapi ZDR enabled (D2); otherwise delete via API after outcome is captured | PENDING_FOUNDER_DECISION |
| Human-assisted call logs | `HumanAssistedCallLog` | Claim resolved | PENDING_FOUNDER_DECISION | PENDING_FOUNDER_DECISION |
| Carrier rep first name and reference number | `repName`, `referenceNumber` | Same as claim record | Same as claim record | PENDING_FOUNDER_DECISION |
| Learning lessons (approved, de-identified) | `CarrierLesson` | Provenance link expiry | Provenance link nulled after PENDING_FOUNDER_DECISION (W3 provenance expiry job) | PENDING_FOUNDER_DECISION |
| Audit and PHI access events | `PhiAccessEvent`, `AuditLog` | Event | PENDING_FOUNDER_DECISION (code default 18 months) | PENDING_FOUNDER_DECISION |
| Breach and incident records | W4 register | Incident closed | At least 24 months | Minimum fixed by regulation; maximum PENDING_FOUNDER_DECISION |
| Consent attestations and agent permissions | W2 tables | Superseded or revoked | Life of the customer relationship plus PENDING_FOUNDER_DECISION | PENDING_FOUNDER_DECISION |
| Prospect marketing data | `Prospect`, activity rows | Opt-out or no engagement | Suppression entry kept indefinitely (email or number only); other fields PENDING_FOUNDER_DECISION | PENDING_FOUNDER_DECISION |
| Backups | Fly.io and AWS (United States) | Rolling | Per vendor configuration; deleted rows persist until backups age out | PENDING_FOUNDER_DECISION |

## Disposal method

Database deletes through the retention job with a certificate row (counts per table, no identifiers); vault entries deleted and keys not reused; vendor artifacts deleted through vendor APIs with the response logged (no content). Backups expire on their own schedule; the privacy notice says so.

## Open items

1. Every period above (PENDING_FOUNDER_DECISION).
2. Cowork batch R1 to confirm the RCDSO figures and the underlying regulation.
3. D2 (ZDR) decides vendor-side retention.

## Code control and test

| Control | Test | Status |
|---|---|---|
| Retention job coverage of all tables above, dry run, legal hold, certificate | W7 (planned) | Planned |
| Purge off by default | Existing job flags (`DATA_RETENTION_ENABLED`, per-practice `purgeEnabled`) | Present |
| Provenance expiry for lessons | W3 `provenanceExpiry.ts` | PR #125 |
| Vendor artifact deletion after call | `handlePostCallAudioDeletion()` (audio only) | Partial |
