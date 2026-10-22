# 08. Risk acceptance process

> DRAFT. Not reviewed by a lawyer. This document governs how positions become signed; it takes no position itself. Open items listed at the end.

## Purpose

The founder interprets public law himself and signs each legal position. This process makes each signature traceable to the text read, the contrary reading, the control that holds under either reading, and a date to re-read.

## Who it binds

The founder, and anyone (person or Claude session) proposing a legal position, changing a control that implements one, or claiming a register row is satisfied.

## Register row lifecycle

| State | Entry condition | Who |
|---|---|---|
| PROPOSED | A row exists in `INTERPRETATION-AND-RISK-REGISTER.md` with: question; primary text quoted with section and URL and an evidence tag; adopted reading; contrary reading; default control; risk accepted; sources not read | Proposer |
| REVIEWED | Every quotation in the row has been checked against primary text in the evidence log (VERIFIED), or the row says plainly which parts are EXCERPT or UNVERIFIED; a reviewer note lists citation errors found | Reviewer (may be a separate session; reviewer citations must themselves be checked, see RISK-REGISTER-REVIEW-RESULT.md) |
| SIGNED | The founder writes Decision (sign or change), Date and Re-read by, and adds a line to the risk acceptance log | Founder only |
| EXPIRED | Re-read date passes, or a watch-list item for that row changes, or a source the row relied on changes | Automatic |
| RE-READ | Sources re-read; row updated; back to REVIEWED, then SIGNED again | Proposer, then founder |
| WITHDRAWN | Position abandoned; control may stay | Founder |

## Rules

1. A row cannot be SIGNED while any quotation it relies on is unverified unless the row names the gap and the founder accepts it explicitly in the signature line.
2. A signed row is the product's position. Code, docs and sales copy follow it; changing behaviour against a signed row requires a new signature.
3. Every signed row names its controls and tests in `docs/legal-policy/TRACEABILITY.md` (L5). A control removed or weakened re-opens the row.
4. Default when a row is unsigned: the cheapest control that holds under both readings, and no live activity in a new industry that depends on the row.
5. Re-read dates: 12 months by default; earlier when the watch list (`policy-research/WATCH-LIST.md`) names a pending change.
6. Counsel is optional. If counsel is consulted, record the advice and date in the row; it does not replace the founder's signature.
7. Signing does not make a statement true. Never describe a signed row as a compliance conclusion; describe the control it implements and the obligation it addresses.

## Rows to add (proposed by this workstream)

| Proposed row | Question | Source files |
|---|---|---|
| R11 Marketing | May CollectRx send cold email to published practice addresses, and place AI voice sales calls to dental offices? | CASL-AND-OWN-MARKETING.md; policy 07 |
| R12 Carrier rep data | Keep rep names, and on what basis? | CARRIER-REP-PERSONAL-INFORMATION.md |
| R13 Vendor route | Vapi ZDR or HIPAA mode for health workflows (D2)? | vendors file L1 addendum; policy 03 |
| R14 Practice records | Treat CollectRx data as working copies with RCDSO ten years as the practice-side minimum? | FSRA-RCDSO-QUEBEC.md; policy 06 |

## Founder risk acceptance log format

| Date | Row | Reading adopted | Risk accepted | Sources unread at signing | Re-read by | Signed |
|---|---|---|---|---|---|---|

## Open items

1. Where signatures are recorded (git commit by the founder on the register file is proposed, so history is auditable).
2. Whether a second reviewer is required for rows covering health data.

## Code control and test

| Control | Test | Status |
|---|---|---|
| Traceability check fails when a row references a missing file or test | `scripts/check-traceability.cjs` (L5) | L5 PR |
| Policy lint stops compliance claims | `scripts/policy-lint.cjs` (L4) | L4 PR |
