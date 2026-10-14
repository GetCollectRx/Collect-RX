# 05. Incident response and breach procedure

> DRAFT. Not reviewed by a lawyer. Positions per the founder's signed risk register. Open items listed at the end. Intended to replace the breach section of `docs/compliance/PHIPA-MANUAL-PROCESS-RUNBOOK.md` (already corrected in PR #123) once W4 (breach register) ships; until then both point to each other and this document governs the steps.

## Purpose

What CollectRx does when personal information it handles is, or may have been, stolen, lost, accessed, used or disclosed without authority: contain it, record it, tell the right party on time, and give custodians what they need.

## Who it binds

All CollectRx staff and contractors. The incident lead is the founder unless delegated in writing.

## Obligations implemented (all VERIFIED unless noted)

| Obligation | Source (research file#row) |
|---|---|
| Agent notifies the custodian at the first reasonable opportunity | PHIPA s.17(4)(b) (health-privacy.md#2) |
| Custodian notifies individuals at the first reasonable opportunity, with a statement of the right to complain to the Commissioner; notifies the Commissioner in prescribed circumstances | PHIPA s.12(2), (3); O. Reg. 329/04 s.6.3(1), (3) (health-privacy.md#3) |
| Custodian annual report by March 1, five categories | O. Reg. 329/04 s.6.4 (CORRECTIONS A9) |
| Report to the OPC and notify individuals as soon as feasible where real risk of significant harm; notify organizations that can reduce harm; keep a record of every breach | PIPEDA ss.10.1, 10.2, 10.3 (private-sector-privacy.md#12) |
| Record content and retention: 24 months; report fields | SOR/2018-64 (private-sector-privacy.md#12, VERIFIED in earlier research, not re-read this session) |
| Quebec: reduce risk; promptly notify the CAI and persons concerned if risk of serious injury; keep a register | P-39.1 ss.3.5 to 3.8 (FSRA-RCDSO-QUEBEC.md#8) |
| Alberta HIA affiliate duty; Alberta PIPA notice to the Commissioner | HIA s.60.1; PIPA s.34.1 (health-privacy.md#19; private-sector-privacy.md#13; earlier research) |

There is no 14 day period in PHIPA. "First reasonable opportunity" governs.

## Procedure

### Step 1. Detect and open (hour 0)
- Anyone who suspects an incident tells the incident lead immediately through the incident channel (PENDING_FOUNDER_DECISION).
- Open an incident record (W4 breach register once built; until then a restricted document) with: discovery time, who discovered it, what is known.

### Step 2. Contain
- Stop the exposure: revoke keys, disable the affected integration, suspend calling for affected practices if needed (existing CARRIER_BLOCK and practice suspension controls), preserve logs.
- Do not delete evidence. Do not contact patients.

### Step 3. Assess (target within 24 hours of discovery; internal target, not statutory)
Record:
- Which practices (tenants) and how many individuals are affected (by token, never by name in the incident record).
- Data elements involved (identifiers, claim data, transcripts, rep data).
- Vendors involved.
- Period during which the incident occurred.
- Whether the information was stolen, lost, used or disclosed without authority, and by whom if known.
- PIPEDA real risk of significant harm factors: sensitivity, probability of misuse (s.10.1(8)).
- Quebec risk of serious injury factors: sensitivity, anticipated consequences, likelihood of injurious use (s.3.7).
- Province of each affected practice and, where known, of affected individuals.

### Step 4. Route

| Situation | Who CollectRx notifies | Who notifies regulators and individuals |
|---|---|---|
| Patient information of an Ontario practice (CollectRx as PHIPA agent) | The practice, at the first reasonable opportunity, and within the contractual service level (02, clause 7) | The practice decides on individual notice (s.12(2)) and Commissioner notice (O. Reg. 329/04 s.6.3) |
| Alberta practice | The practice (HIA s.60.1 affiliate duty) | The practice |
| Quebec practice | The practice's person in charge, without delay (P-39.1 s.18.3) | The practice (s.3.5) |
| Information CollectRx controls for its own purposes (prospect data, carrier rep data, staff accounts) | Not applicable | CollectRx: OPC report and individual notice if real risk of significant harm (PIPEDA s.10.1); Quebec CAI if risk of serious injury and Quebec residents affected |
| Vendor-originated incident | The affected practices as above; record the vendor's notice time | As above |

### Step 5. Custodian incident packet (sent with the notice to the practice)
1. Incident reference and CollectRx contact.
2. What happened, when it started and ended, when discovered.
3. Affected patient tokens and claim references for that practice only (the practice resolves tokens to patients).
4. Data elements involved per token.
5. Vendors involved and their statements.
6. Containment and mitigation steps taken.
7. CollectRx's assessment of risk factors (for the practice's own decision).
8. Information the practice needs for its notices and its annual report category (stolen, lost, used without authority, disclosed without authority).

The packet contains no patient names, dates of birth or policy numbers.

### Step 6. Record and retain
- Every incident is recorded, including those assessed as low risk, with the SOR/2018-64 fields: circumstances, date or period, personal information involved, number of individuals, steps taken to reduce harm, notification steps, contact.
- Records are kept at least 24 months and are excluded from automated purge.
- Each practice can request a yearly count per category to support its March 1 report.

### Step 7. Review
Within 30 days: root cause, control changes, and whether any register row needs to be re-read.

## Open items

1. Incident channel and on-call (PENDING_FOUNDER_DECISION).
2. Contractual service level to practices (72 hours proposed in 02).
3. SOR/2018-64 field list re-read before W4 freezes its schema.

## Code control and test

| Control | Test | Status |
|---|---|---|
| Breach register with required fields, 24 month retention, province, custodian notification timestamps | W4 tests (planned in FIX-PROMPT-PRIVACY-GAPS W4) | Planned |
| Packet generator with no direct identifiers | W4 test "packet contains no identifiers" | Planned |
| Annual per-category export (five categories) | W4 | Planned (note five, not four) |
| Retention job skips breach rows | W4 / W7 | Planned |
