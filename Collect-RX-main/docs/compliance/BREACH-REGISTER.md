# Breach register and custodian packet

> Reviewed against research 2026-10-13; not legal advice; see policy-research/SYNTHESIS.md.

**Status:** engineering procedure for the breach register built under workstream W4. Counsel must confirm the notification duties, the category mapping, and the notice wording (PENDING_COUNSEL). This document does not replace the interim manual runbook until counsel signs off on both.

## What it records

Every incident is recorded, including low-risk ones. Required fields follow the Breach of Security Safeguards Regulations, SOR/2018-64 s. 2(1)(a) to (g):

| Field | Regulation element |
|---|---|
| `circumstances` | (a) circumstances of the breach |
| `periodStart`, `periodEnd` | (b) period |
| `dataElements` | (c) personal information involved, as categories only |
| `individualsCount` | (d) number of individuals |
| `stepsToReduceHarm` | (e) steps to reduce risk of harm |
| `notificationSteps` | (f) steps to notify individuals and others |
| `contactRole` | (g) contact. A role, not a person's name |

Also recorded: `category`, `province`, `discoveredAt`, `affectedTokens` (patient token UUIDs only), `vendorsInvolved`, the real-risk-of-significant-harm assessment, and the custodian and regulator notification times.

## Rules enforced in code

- Free-text fields are scanned for names, phone numbers, dates, emails and long numbers. A match is rejected with a reason code. The text is not echoed.
- `affectedTokens` accepts UUIDs only.
- Records are kept at least 24 months after recording, or after closure if later. `retainUntil` holds that date. The retention job does not touch this table, and there is no purge path for it.
- Patient notification is the custodian's duty. CollectRx does not contact patients.

## Procedure

1. **Create** the entry as soon as the incident is known (`POST /api/compliance/breaches`). Leave the real-risk assessment blank until it is made.
2. **Assess** real risk of significant harm and record it (`PATCH /api/compliance/breaches/:id`). Counsel decides the threshold (PENDING_COUNSEL).
3. **Notify the custodian** and record `custodianNotifiedAt` the same way. The custodian owns patient and regulator notices where it is the custodian.
4. **Generate the packet** for the custodian (`GET /api/compliance/breaches/:id/packet`). The packet has a fixed key set. Each packet request writes a PHI access event and an audit row.
5. **Close** the entry by setting `closedAt`. This extends `retainUntil`.
6. **Annual count** (`GET /api/compliance/breaches/annual-counts?year=YYYY`) returns counts for the four categories in O. Reg. 329/04 s. 6.4. `UNAUTHORIZED_ACCESS` and `OTHER` are reported as `unclassified` until counsel confirms their mapping (PENDING_COUNSEL).

## Access

Practice owners only. Every create, update and packet request is audited.

## Not covered here

- Alerting on the contractual notification deadline. The register records the times; it does not alert.
- Patient notices and regulator filings. These are the custodian's duties.
- Subject access and deletion requests. Those are separate workstreams.
