# L2e. FSRA licensing and authorization, RCDSO dental records, Quebec private-sector Act

Date: 2026-10-13. Status: research record, not legal advice, not reviewed by a lawyer. Evidence: EVIDENCE-LOG-2026-10-13.md E11, E12, E16. Tags as in CORRECTIONS.md.

## FSRA

| # | Obligation or finding | Source | Groups | Required control | Acceptance test | Current-code status | Tag |
|---|---|---|---|---|---|---|---|
| 1 | Independent and public adjusters need an FSRA licence; insurer staff adjusters do not; adjusters must be sponsored by an adjusting firm | https://www.fsrao.ca/licensing/individual-adjuster/apply-new-insurance-adjuster-licence | MVA, property | Scope limit: CollectRx does not investigate, adjust, negotiate or settle claims (Insurance Act s.1(1) "adjuster", s.397, read in earlier research) | Transcript lint: no settlement proposals or coverage arguments | Scope lint not built (SYNTHESIS F2) | VERIFIED |
| 2 | FSRA licence authorizes a health service provider to receive direct payment from auto insurers for listed expenses billed through HCAI on OCF-21 | https://www.fsrao.ca/consumers/health-service-providers/about-fsra-licence | MVA | Tenant onboarding for the MVA module records the FSRA licence number and status; payment-trace objective blocked when unlicensed | Unlicensed tenant cannot enable MVA payment objective | MVA module not built | VERIFIED |
| 3 | FSRA regulates HSP business systems and billing practices under O. Reg. 90/14 and Insurance Act s.288.4; OCF-21 invoices must be signed by an authorized individual | FSRA HSP licensing toolkit (keyword scan) | MVA | CollectRx never signs or submits OCF forms | No code path writes to HCAI | None found | VERIFIED (quoted sentences) |
| 4 | Whether a third-party billing agent may chase payment or discuss a SABS file for an HSP, and whether written insured authorization is required | Not found on FSRA pages read | MVA | Until read: MVA module requires a direction to pay and a signed letter of authority (authorization_grants), as already planned | n/a | n/a | NOT FOUND (Cowork batch R5) |

## RCDSO dental records

| # | Finding | Source | Effect | Tag |
|---|---|---|---|---|
| 5 | Clinical and financial records kept at least ten years from the last entry; for minors ten years after age 18; claim form copies at least two years; EOBs and predeterminations until final settlement | RCDSO Guidelines, Dental Recordkeeping, approved by Council November 2019 (https://cdn.agilitycms.com/rcdso/pdf/guidelines/RCDSO_Guidelines_Dental_Recordkeeping.pdf) | The duty is the practice's as custodian. CollectRx's copies are working copies; the practice's PMS remains the record. CollectRx should not be the only place a record lives, and should export before deletion on offboarding | EXCERPT (words reached me only via a summarizing fetch tool; page 1 seen in Chrome) |
| 6 | Guidelines "may be used by the College or other bodies to determine if appropriate standards of practice ... have been maintained" | Same, page 1 (seen) | Guideline, not regulation; the underlying Dentistry Act regulation was not read | VERIFIED (page 1 text) |

Control: retention schedule (docs/legal-policy/06) treats CollectRx-held claim data as a working copy with periods PENDING_FOUNDER_DECISION; deletion on offboarding only after the practice confirms it holds its own record or receives an export.

## Quebec, CQLR c P-39.1 (current consolidation, "À jour au 12 août 2026")

| # | Obligation | Section | Groups | Required control | Acceptance test | Current-code status | Tag |
|---|---|---|---|---|---|---|---|
| 7 | PIA for any project to acquire, develop or overhaul an information system involving personal information; consult the person in charge from the outset | s.3.3 | QC | PIA reference required before enabling a Quebec tenant | Quebec tenant without PIA reference blocked | W9 planned (Quebec gate) | VERIFIED |
| 8 | Confidentiality incident: reduce risk; if risk of serious injury, "promptly" notify the Commission and affected persons; keep a register | ss.3.5 to 3.8 | QC | Breach register (W4 planned) with Quebec routing; no 72 hour rule | Seeded Quebec incident produces a register row and a CAI notice task | W4 planned | VERIFIED |
| 9 | Use for other purposes needs consent (express for sensitive, including medical) except listed cases; prospection is never a consistent purpose | s.12 | QC | Learning default-deny for Quebec tenants (W3); marketing wall | Quebec tenant contributes zero learning rows | W3 PR #125 | VERIFIED |
| 10 | Exclusively automated decisions: inform the person, give reasons on request, allow observations to staff who can review | s.12.1 | QC | Inventory of automated decisions (estimate engine) before Quebec launch | Inventory exists | Not present | VERIFIED |
| 11 | PIA before communicating outside Quebec, written agreement, also when entrusting a body outside Quebec | s.17 | QC | Per-vendor PIA and agreement references (US vendors) | Gate blocks Quebec dispatch without them | W9 planned | VERIFIED |
| 12 | Mandate to a service provider in writing, with protection measures and no keeping after expiry; provider must notify the person in charge without delay of violations | s.18.3 | QC | Customer agreement addendum clause (docs/legal-policy/02) and vendor terms | Clause present | Not present | VERIFIED |
| 13 | Destroy or anonymize when purposes achieved, subject to legal preservation periods | s.23 | QC | Retention schedule | Dry run | W7 planned | VERIFIED |
| 14 | Penalties: $5,000 to $100,000 (natural person); otherwise $15,000 to $25,000,000 or 4% of worldwide turnover if greater | s.91 | QC | n/a | n/a | n/a | VERIFIED |

## Open questions for the founder

1. Any Quebec practice within 90 days? If no, keep Quebec disabled by configuration and defer the Quebec PIA.
2. D4: use RCDSO ten years as the working assumption for what the practice must keep, pending Cowork batch R1?
