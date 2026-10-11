# NotebookLM source discovery: triage (2026-10-11)

Status: **unverified leads.** The discovery output gave URLs, dates and section numbers but no quoted text. NotebookLM can produce plausible URLs and section citations that do not exist. Nothing here enters the proposal as fact until the page text is quoted from the live source.

Egress from the cloud session blocks these hosts, so these were not checked here. Verification must happen in NotebookLM (load each URL as a source and ask for the exact sentence) or in a browser session.

## Agrees with earlier agent reports (still needs the quote)

| Claim | Earlier support |
|---|---|
| SABS: insurer responds to an OCF-18 within 10 business days (s. 38(8)) | rehab report, excerpt |
| SABS: invoices paid within 30 days; interest 1 percent per month compounded | rehab report, FSCO excerpt |
| Minor Injury Guideline cap of $3,500 | rehab report |
| Direct payment only to FSRA-licensed facilities; unlicensed paid via the insured | rehab report |
| July 1, 2026 SABS optionality reform (medical, rehab, attendant care stay mandatory) | rehab report |
| WSIB e-billing through TELUS Health; 6 month limit appears elsewhere | rehab report |
| Construction Act: 28 days to pay a proper invoice; 14 days notice of non-payment; 7 days sub payment | restoration report, law-firm sources |
| O. Reg. 427/15: 15 day storage lien notice | collision report |
| TSSEA: consent, published maximum rates, certificates | collision report |

## New claims, not previously supported (verify each)

- SABS s. 38(11): if the insurer misses the 10 business day response, it must pay for goods and services provided before it gives notice (deemed approval). Earlier reports listed deemed approval as unknown.
- WSIB hearing service bundles: reports and invoices within 5 business days; ongoing bundles billed at 180 day intervals; prior approval for replacement devices, hearing assistive technology and exception-level aids.
- WSIB payment inquiry hotline and TELUS Health help desk numbers (the TELUS number matches a number surfaced in an earlier search; the WSIB number is new).
- Construction Act: sub payment within 35 days and 42 days; 10 percent basic holdback; annual holdback release provisions in force January 1, 2026 (s. 26, s. 87.4). The restoration agent separately reported a 2026 deemed-proper-invoice change (O. Reg. 264/25); these two accounts are different and neither is confirmed.
- TSSEA details: 200 metre collision scene restriction, itemized invoice, s. 60 priority over the RSLA.
- FSRA Unfair or Deceptive Acts or Practices Rule, amended February 14, 2024 (prohibits failing to pay without reasonable cause, among other things).
- VAC: claims within 18 months (12 for rehabilitation); audit review windows.
- CRTC: AI-voiced calls fall under the ADAD rules (Part IV); calls to businesses are subject to Parts III and IV though exempt from the National DNCL; non-sales calls need opening disclosure and calling hour limits and a 10 second disconnect rule. This matches the repo's compliance note but answers the open legal question only if the CRTC text says it. Counsel still decides.
- PHIPA: insurers are not custodians; providers are; agent and recipient roles. Section numbers cited (13, 14, 15, 24, 25, 52, 53) look unreliable and must be checked.

## Contradiction that matters most

HCAI "worklist status tracking for providers (Submitted, Received, Approved, Partially Approved, Declined, Paid)". The rehab agent found no evidence that HCAI shows payment status. If a provider can see "Paid" in HCAI, the phone need for MVA payment trace shrinks sharply. Resolve by reading the HCAI provider documentation directly. This decides whether MVA is a real first vertical.

## Low confidence items

- Section numbers: "s. 51" for both the 30 day payment rule and interest; "s. 25.1" for the licensed facility rule; MIG described as "OCF-23 for pre-approved frameworks" (muddled).
- Insurer, TPA and adjusting firm "portals" (Crawford, ClaimsPro): the descriptions read as generic homepages. They are the claims that decide whether restoration invoice status is electronic. Treat as unsupported until a contractor-facing page is quoted.
- Dates such as "updated October 7, 2026" and "consolidated July 1, 2026" are unverified.
- IPC URL given is the home page only.

## Reported gaps (agree with ours)

No single payment deadline statute across sectors. No standalone AI-calling statute; ADAD rules apply by definition, with 2026 consultations ongoing.

## Verification pass 1 (2026-10-11, cloud session)

Method limits: every primary host (ontario.ca, fsrao.ca, hcaiinfo.ca, crtc.gc.ca, wsib.ca, canlii.org, laws-lois.justice.gc.ca, ipc.on.ca, veterans.gc.ca, sac-isc.gc.ca, storyblok manual PDFs) returned no response from this environment (proxy block). Only web search excerpts were available, so nothing below is verified against a full primary page. Results are labelled by what the excerpts support.

| Claim | Result |
|---|---|
| SABS s. 38(11), NotebookLM wording: insurer pays for goods and services "provided prior to giving notice of refusal" | **Wrong as stated.** An excerpt reproducing the regulation says the insurer pays for goods, services, assessments and examinations in the plan relating to the period starting on the 11th business day after receipt and ending on the day it gives the s. 38(8) notice. Scope is contested: *Aviva General Insurance Co. v. Catic*, 2022 ONSC 6000 records an insurer arguing it covers only services actually incurred in that window. Holding not confirmed. Sources are law-firm blogs and decision summaries. |
| SABS s. 38(8): response within 10 business days | Consistent across excerpts (law firm sources). Not read on e-Laws. |
| SABS s. 51: interest 1 percent per month compounded monthly | **Supported by a CanLII consolidation excerpt** (rate cut from 2 percent at the 2010 rewrite, per a law-firm overview). Section 51(3) variant says amounts on an invoice are not overdue while a provider fails a subsection (2) requirement; wording differs between consolidations. Current e-Laws text not read. |
| SABS: 30 days to pay an invoice, cited to "s. 51" | **Section number unconfirmed.** An earlier FSRA material excerpt supports the 30 day period, but no excerpt located the provision. Do not cite "s. 51" for it. |
| HCAI worklist shows a "Paid" status | **Not supported.** Excerpts show the provider worklist exposes the provider invoice number; insurers record decisions as approved, partially approved or declined; third-party guides list Approved, Partially Approved, Declined, Successfully Delivered. The 2026 OCF-21B manual excerpt shows payments received and overdue amounts as fields the provider enters on the next invoice, not as HCAI statuses. This leans toward the rehab agent's finding: HCAI does not tell a provider whether it was paid. Not conclusive without the manual. |
| CRTC: AI voice calls fall under the ADAD rules | **Secondary only** (vendor and law-firm blogs treating synthesized voice as ADAD). CRTC Notice 2026-132 is a compliance and enforcement consultation reviewing the rules, including whether the ADAD definition should cover AI explicitly; consultation open. |
| CRTC: non-solicitation ADAD calls must open with caller identification and purpose | **Supported by an excerpt of CRTC 2026-132 para. 29.** |
| CRTC: 10 second disconnect rule | **Not found in CRTC text.** A vendor summary only. The repo's own compliance note (CRTC UTR Part IV) cites it; read Part IV. |
| CRTC: rules apply to calls to businesses | **No source found** either way. Stays an open legal question. |
| All other items in the triage lists | Not re-checked. Still unverified. |

### What this changes
1. Correct the NotebookLM 38(11) text before anyone encodes a deemed-approval rule. It is a payable-period rule with a disputed scope.
2. The HCAI "Paid" status is, so far, unsupported. MVA payment trace likely still needs the adjuster; confirm in the OCF-21B manual (hcaiinfo.ca) and the provider worklist screens.
3. The CRTC question stays open and needs counsel. Opening disclosure of identity and purpose is supported and matches the existing disclosure design.
