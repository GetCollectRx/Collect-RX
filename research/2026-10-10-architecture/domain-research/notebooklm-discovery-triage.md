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

## NotebookLM second pass: triage (2026-10-11)

Input: four domain tables with "exact quotes" from the loaded sources, plus an analysis section. Checked against our own documents and three follow-up searches. Quotes were not independently re-read on primary pages; the confidence labels in the tables are NotebookLM's own and are not accepted at face value.

### Problems with the output
1. **The "contradicted" list is invented framing.** Each "previous assumption" it says we made (all SABS benefits mandatory, holdbacks released only at completion, RSLA exclusively governing storage, implied consent for PHI to insurers) does not appear in our proposal or reports. The July 2026 SABS optionality change and TSSEA primacy were already recorded in the rehab and collision reports. No real contradiction with our documents was found.
2. **Quotes often do not support the finding beside them.** Examples: the HCAI "statuses ... Paid" claim is attached to a quote that lists no statuses; the "non-payment reasons" quote for MVA/WSIB is about eProvider Reporting; the phone-contact claim for restoration is attached to a quote about monthly invoices; the tow "phone" claim is attached to the 200 metre rule.
3. **The SABS s. 38(11) "confirmed" item repeats the wrong reading** (liability for services delivered before notice), with no quote. Our verification pass found the regulation text runs from the 11th business day after receipt until notice is given.
4. **HCAI "Paid" status remains unsupported.** Again no quote lists it. A follow-up search found only Submitted and the adjudication outcomes (approved, partially approved, declined) from third-party and HCAI adjudication guidance, and no definition of the full worklist status set.
5. **Domain 4 "quoted" items are not traceable**: no page or section for several VAC and ADP statements. Treat as leads.

### Findings that stand as leads worth carrying (still need a primary read)
- Contact numbers for WSIB payment inquiries and the TELUS Health help desk, with a quote. These are real phone paths for WSIB payment questions, which is evidence for a phone objective in the WSIB module, but a staff-facing hotline is a different thing from an insurer adjuster line. Do not hardcode numbers; store as `contact_routes` with verification.
- Construction Act: 28 day payment, 14 day notice, 10 percent holdback, annual holdback release from January 1, 2026. A follow-up search corroborates that the Bill 216 and Bill 60 amendments took effect January 1, 2026, annual holdback release, and a **seven day deemed-proper-invoice rule** (law-firm sources; subsection placement differs between s. 6.1(2) and s. 6.2). This reconciles the restoration agent's earlier single-source note. Still verify on e-Laws.
- TSSEA and O. Reg. 427/15: consent, published rates, itemized invoice, 200 metre rule, 15 day notice, TSSEA prevailing over the RSLA. Consistent with the collision report.
- VAC: 18 month claim limit (12 for rehabilitation), audit redress windows of 15 working days, 60 days and 15 working days. New, needs a primary read.
- WSIB hearing bundles: 5 business days to submit; ongoing bundle billing every 180 days. New, needs a primary read.
- **PHIPA express consent.** The IPC consent page (via search) states that express consent is needed when a custodian discloses to a non-custodian such as an insurance company, unless PHIPA allows it without consent. Providing information to the custodian's agent is a use, not a disclosure. Design consequence below.

### Design consequences accepted into the proposal
- `authorization_grants` gains a `patient_consent` kind with an evidence reference (for example the consent the provider already holds that lets the insurer receive and discuss health information), in addition to the billing agent letter. A call for a PHIPA custodian cannot assume the insurer will talk; the grant records what consent exists, and the objective pack's forced-handoff list includes "counterpart refuses to confirm without the patient's consent."
- Whether CollectRx qualifies as the custodian's agent is a legal determination (counsel). The architecture records the contract basis (`authorization_grants.document_ref`) either way.

### Still unresolved after this pass
HCAI provider-visible statuses (read the OCF-21B manual); the exact SABS s. 38(11) and invoice payment sections on e-Laws; whether CRTC rules reach calls to businesses and the 10 second rule; every statute subsection number; how any of the Construction Act rules apply when an insurer, not the owner, pays the contractor.
