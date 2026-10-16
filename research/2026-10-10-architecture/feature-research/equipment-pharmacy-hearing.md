# Research: equipment, O&P, hearing and pharmacy (Ontario first)

Date: 2026-10-13. Method: WebSearch only. Every WebFetch call failed (getaddrinfo ENOTFOUND for ontario.ca, mckesson.ca, opatoday.com, blueprintsolutions.us, oma.org). No page was read directly.

IMPORTANT CAVEAT ON QUOTES: the search tool returns a summarised answer with embedded excerpts, not raw page text. Text in quotation marks below is the excerpt as returned by the tool. Unquoted wording is the tool's paraphrase. Treat all items as "seen in a search excerpt, not verified on the page". Re-check on the source before building anything.

Evidence tags: PRIMARY (government, regulator, program, vendor manual), SECONDARY (trade press, vendor marketing), OPINION (forum, job post, review).

---

## 1. What I verified (with quotes)

### A. Pharmacy (Ontario)

A1. Rejects at the Ontario public drug program are fixed by pharmacy staff, with a phone help desk as the fallback.
- PRIMARY-adjacent (McKesson pharmacy system help page, undated): https://portal.mckesson.ca/static/PTS/Rx/Content/Prescription%20Information/NMS/Failed%20and%20Rejected%20NMS%20Prescriptions.htm
- Excerpt: "If you receive rejections from NMS but do not understand why, review the Ontario Drug Program Reference Manual for a complete list of possible rejections. If you need further assistance, contact the ODB Help Desk at 1-800-668-6641."
- Also: a persistent date-of-birth rejection after checking the birth date means calling the ODB Help Desk. Outstanding NMS transactions have "a 365 day window".
- What it shows: the job (resolve reject, call help desk) exists. It is a NMS (minor ailments) page, so it is only an analogy for ODB claims.

A2. Ontario drug claims are paid and reversed through the Ministry Health Network System (HNS), and the Ministry recovers inappropriate claims through inspection.
- PRIMARY: Auditor General of Ontario 2017 summary, https://www.auditor.on.ca/en/content/news/17_summaries/2017AR%20summary%203.09.pdf
- Excerpt: "In 2016/17, the Ministry inspected 286 of the more than 4,260 pharmacies, and recovered $9.1 million in inappropriate claims. However, our audit identified a further $3.9 million in inappropriate claims and payments that the Ministry did not inspect and/or recover."
- PRIMARY (Ministry notice, EO communications page, https://health.gov.on.ca/en/pro/programs/drugs/opdp_eo/eo_communiq.aspx): list of pharmacy operations "that has had its billing privileges revoked, its right to receive payment suspended, and its Health Network System (HNS) Subscription Agreement terminated."
- Claim reversal: "Pharmacists are required to retain a copy of the Drug Benefit Claim Reversal Form on file for a period of two years from the day of claim reversal submission." (Ministry form, search result 5069-87e.)
- Caveat: data is from 2016/17. Only 286 inspections a year means a given pharmacy is audited rarely.

A3. Private-payer admin burden is quantified by the national association (survey, advocacy-linked).
- SECONDARY/OPINION: Canadian Pharmacists Association release, https://www.pharmacists.ca/news-events/news/cpha-calls-for-regulation-of-insurer-practices-straining-pharmacies-and-threatening-patient-choice/ (September 2025 per the tool).
- Excerpt: "75% of pharmacists spend 5 hours or more per week managing third-party payer claims, with nearly 20% dedicating over 15 hours weekly." Also "81% of pharmacies report moderate to significant disruptions to workflow and patient care due to these administrative tasks."
- Caveat: the follow-up search to reconfirm this did not return the CPhA item, so it rests on one search. The survey does not say how much of this is phone time. "Managing third-party payer claims" is broad (PPN steering, audits, reversals), not only chasing unpaid receivables.

A4. Reconciliation tooling exists in pharmacy software (mostly US vendors in the results).
- SECONDARY: FDS listing on GetApp, https://www.getapp.com.au/software/2048568/fds : "Its claims reconciliation system allows drugstores to identify missing reimbursements, monitor paid and overdue payments from third parties, and track discrepancies in payments." Also a single user review complaining claims do not match even on "date, RX number and amount".
- SECONDARY: Cervey, https://recon.cervey.com : "claim-by-claim reconciliation of third-party payments and adjudicated amounts".
- Not found: Canadian pharmacy systems (Kroll, Shoppers Assyst, Fillware, Nexxsys, PharmaClik). NO EVIDENCE FOUND for their reject or reconciliation features. FDS and Cervey are not shown to be sold to Ontario pharmacies.

### B. Hearing clinics (Ontario)

B1. Process and staffing: a job post shows the AR job exists in Ontario hearing clinics.
- OPINION (job post): Davidson Hearing Aid Centres, Nepean ON, "Bookkeeping & Insurer Billing Clerk", $50,000 to $60,000. Per the tool: duties include "submitting electronic claims on a weekly and bi-monthly schedule, following up on them, and posting remittances from ADP and other insurers", plus "resolving partial payments, rejections, and unpaid claims". URL was not returned in the result I can quote (found via Indeed/Workopolis style listing). Date unknown.
- OPINION (job post): HearCanada Sudbury "Client Care & Billing Clerk": clinic billing, direct billing with insurers, collections.
- What it shows: a dedicated insurer-billing role exists at at least one clinic group. It does not show phone time.

B2. Program (ADP) mechanics for hearing aids.
- PRIMARY: Ontario ADP hearing devices manual (revised March 2, 2026): https://www.ontario.ca/files/2026-02/moh-adp-policy-and-administration-manual-hearing-devices-2026-02-11.pdf . Tool excerpt: "ADP will pay the registered vendor 75% up to a maximum of $500 of the cost of the hearing aid, earmold, the accessories listed with ADP and the dispensing fee." Two aids cap at $1,000.
- PRIMARY: Ministry memo 2020, https://files.ontario.ca/moh-adp-memo-advance-payments-ending-en-2020-06-18.pdf : "beginning with the June 29 payment to vendors, payments will be based only on approved claims invoiced and eligible for payment." Advance payments ended.
- PRIMARY: CASLPO notice, https://caslpo.com/news/view/update-changes-to-adp-hearing-aid-funding-application-process-effective-march-2-2026 : new form from March 2, 2026 needs signatures from an ADP authorizer, a vendor representative and the applicant; vendors must keep the original prescription.
- OPINION (vendor clinic page): "ADP issues an ADP Claim number. This process takes between 4-6 weeks to complete." Not an official timeline.
- NO EVIDENCE FOUND: an official ADP payment turnaround, a reject-reason list, or a phone line for vendors to check claim status.

B3. WSIB hearing billing is electronic with a published payment rhythm.
- PRIMARY: WSIB, https://www.wsib.ca/en/billing-tips-hearing-health-care-providers : "Hearing health care providers should continue to bill electronically through the WSIB payment system (TELUS Health Provider Portal)." The bill can be submitted after dispensing and fitting is complete.
- SECONDARY (vendor docs): Blueprint OMS, https://blueprintoms.atlassian.net/wiki/x/DgBp : "Claims are submitted nightly." Status and EFT "every Monday and Thursday morning". "Claims on the Submitted claims tab with a triangle alert symbol have been rejected." Guidance for a rejection: check birth date and policy number, then contact WSIB with the claim number.
- Pre-approval: WSIB archived policy says workers "should request pre-approval from the WSIB for the initial purchase and for the subsequent repair/replacement". WSIB trial period is 30 days in policy vs 90 days on a billing page (conflict, see section 4).

B4. Hearing practice software: Blueprint OMS (Toronto-founded, 2005) lists "Canadian Insurance Billing" and Noah integration. SECONDARY: https://blueprintsolutions.us/features/canadian-insurance-billing/ and https://blueprintsolutions.us/?p=262. A Blueprint release note says Claims Tracking is "US only". Auditdata Manage and HiClinic appear in a Slashdot comparison with claims features, Canadian support not stated.
- What the software does NOT do (per excerpts): in Blueprint the rejection path ends at "contact WSIB". That is a phone/portal step the software hands to staff. This is an inference from the documentation wording, not a stated limitation.

B5. Veterans Affairs hearing (Medavie Blue Cross, Program of Choice 03): see C below.

### C. Orthotics, prosthetics, equipment

C1. VAC authorization has a phone and fax route plus portal.
- PRIMARY: https://veterans.gc.ca/en/health-support/information-for-healthcare-service-providers . Excerpt: "As an approved provider, you are responsible for verifying your clients' eligibility and obtaining authorization before providing the service or benefit." VAC Medical Authorization Centre (Medavie Blue Cross) 1-866-811-6060, fax 1-888-232-3544 (tool-reported, verify).
- PRIMARY: Medavie program doc FAP-022 POC 11, https://pub.medavie.bluecross.ca/pub/0001/PublicDocuments/FAP-022%20POC%2011.pdf : portal is "the easiest way to submit pre-authorization requests (VAC only), electronic claims and view all program information". Participating providers "submit claims directly to Medavie Blue Cross".
- So for VAC, preauth can be portal-only. The phone is the fallback.

C2. Ontario ADP orthotic devices: only certified orthotists (CBCPO, Orthotics Prosthetics Canada) can authorize. PRIMARY: https://files.ontario.ca/moh-adp-authorizer-attachment-a-orthotic-devices-2023-07-01.pdf . Hospital clinics (Hamilton Health Sciences) are registered ADP vendors.

C3. Private insurer preauth for orthoses is manual in at least one clinic policy: SickKids orthotics financial policy asks that the insurer fax authorization before the device is provided; "responsibility of the client to determine if their insurance plan will provide coverage". OPINION/PRIMARY (hospital policy): https://www.sickkids.ca/contentassets/5dd43252e4bb495eb2a64ce87495ec81/orthotics-clinic-financial-policy.pdf . This puts coverage checking on the patient in this setting, which weakens the case for a provider-side phone product.

C4. DME billing job posts exist but are US only (Brightree, Medicare). They list "regular payer follow-ups, and reconciling unpaid or partially paid claims" and a separate Prior Authorization Specialist role. OPINION, not Ontario. NO EVIDENCE FOUND for Ontario DME billing postings.

### D. Preauthorization programs

D1. ODB Exceptional Access Program: submitted by SADIE online, fax or mail. PRIMARY: https://ontario.ca/page/exceptional-access-program . Excerpt: "SADIE also will ask for all of the required information when a request is created and identify any missing information before the request is submitted." Inquiry Services 1-800-262-6524. Response time dataset covers 2014 to 2017 only. Relevant to prescribers and pharmacies mainly, not to equipment suppliers.
D2. WSIB hearing: pre-approval required (B3).
D3. VAC: pre-authorization required for listed benefits, portal or phone (C1).
D4. Private hearing aid insurers: NO EVIDENCE FOUND that Green Shield or other Ontario insurers require preauth for hearing aids. A cochlear implant guide and an Alberta (AADL) module describe "predetermination" in general terms only. Green Shield general claim form: claims within 12 months of date of service.
D5. How long approvals last: NO EVIDENCE FOUND.

### E. Employer HR and disability administration

E1. Employer role is to provide a statement and forms, not to chase payment. OPINION/SECONDARY: Sun Life form guide (search excerpt): "This form provides us with information on your claim and on your employment, salary, benefits, and other sources of income." and "Check to see whether your employer has completed and submitted this form to Sun Life." Insurers contact physicians and others during the absence (CLHIA submission).
E2. Is there a true employer receivable (for example an ASO plan where the employer awaits insurer reimbursement)? NO EVIDENCE FOUND. The search returned nothing on administrative services only arrangements, insurer reimbursement to the employer, or employer chasing a payer. The claim "poor fit" is supported only by absence of evidence plus E1. It is not proven.

### F. Privacy and trust

F1. Ontario IPC issued "AI Scribes: Key Considerations for the Health Sector" on 2026-01-28 (tool-reported, via DWW and Mondaq). SECONDARY.
F2. PHIPA agent framework: PHIPA defines an agent as a person "authorized by a custodian to perform services or activities in respect of personal health information on the custodian's behalf", and the custodian must take "reasonable steps (such as training, oversight and having policies in place)". SECONDARY (Securiti summary). A voice agent calling payers for a pharmacy or clinic would probably be an agent. Not confirmed in IPC text.
F3. NO EVIDENCE FOUND of any IPC statement on AI voice agents or third-party call recording.
F4. Pharmacy fraud history: the Toronto Star/Global News 2019 investigation (https://globalnews.ca/news/4979855/ontario-pharmacy-fraud-prescription-for-profit/amp) increases ministry scrutiny of pharmacy billing. A tool that touches ODB claims may attract suspicion. This is inference.

---

## 2. What I could not verify

- Any direct page read (all fetches failed). No raw quotes.
- ODB claim reject codes and the Ontario Drug Program Reference Manual contents.
- How ODB recoupments are invoiced, timelines, and appeal route today. The OPA "Audit Assist" page exists (https://www.opatoday.com/membership/audit-assist/) but I did not see its text beyond the tool's summary.
- Whether private-insurer pharmacy claims (real-time, via adjudication networks) produce meaningful pended or short-paid receivables. NO EVIDENCE FOUND of unpaid-receivable volume. Real-time adjudication likely means the payer decision is known at the counter; I found nothing contradicting that, but nothing confirming volumes either.
- Features of Kroll, Shoppers Assyst, Fillware, Nexxsys, PharmaClik, Noah, HiClinic, and any Canadian DME billing system.
- Phone minutes per week for any sub-industry. No quantified phone figure exists in what I found (CPhA figure is total third-party claim management time).
- Ontario DME vendor workflows (ADP mobility, oxygen, diabetic supplies), orthotics and prosthetics claim workflows with WSIB, private insurers.
- Preauth lead times for private insurers, ADP, or WSIB.
- Association guides for audiology (CASLPO, Canadian Academy of Audiology, HIS regulator) on billing.
- Employer reimbursement receivable (NO EVIDENCE FOUND).

---

## 3. Feature candidates

Confidence scale: STRONG (job and pain both evidenced), WEAK (job evidenced or plausible, pain not evidenced or evidence is indirect), NONE.

### A. Accounts receivable

| Feature | Job | Evidence | Confidence |
|---|---|---|---|
| Call WSIB/insurer to chase a rejected or unpaid hearing claim | Resolve rejected or short-paid claim | Job post: "resolving partial payments, rejections, and unpaid claims" (Davidson). Blueprint docs end rejection path at "contact WSIB with the insurer claim number". No time or dollar figure. | WEAK |
| Ontario ADP vendor claim status check | Learn whether ADP claim is approved and when paid | Vendor page: ADP claim "takes between 4-6 weeks". No evidence of a phone line or of staff calling. | WEAK |
| ODB help desk call on rejects (date of birth, ID) | Fix reject then resubmit | McKesson excerpt names 1-800-668-6641. Pharmacy staff normally fix fields in-system; calls only when persistent. Reaching the Ministry help desk by AI is a different trust issue. | WEAK |
| Private payer short-pay or pend follow-up for pharmacies | Chase pended or reduced claims | CPhA: "75% ... 5 hours or more per week managing third-party payer claims". Not split into phone vs other, not shown to be receivables chasing. | WEAK |
| Audit/recoupment dispute support | Respond to recovery notice | Auditor General 2017 shows recoveries exist ($9.1M in 2016/17). Phone is not evidenced; disputes are written. | WEAK |
| Reconciliation (match remittance to claims) | Find missing payments | FDS, Cervey vendor pages (US). It is a software job, not a phone job. | WEAK for phone product |
| Hearing/O&P private insurer AR follow-up | Chase unpaid private claims | HearCanada post mentions "direct-billing with insurers, and collections". No pain data. | WEAK |
| Employer-side receivable chasing | n/a | NO EVIDENCE FOUND | NONE |

### B. Preauthorization

| Feature | Job | Evidence | Confidence |
|---|---|---|---|
| VAC preauth request and status | Get authorization before service | VAC page: provider "responsible for ... obtaining authorization before providing the service". Phone and fax exist; Medavie says portal is easiest. | WEAK (portal exists) |
| WSIB hearing aid pre-approval status | Track approval for purchase or replacement | WSIB policy text requires pre-approval. No evidence of phone burden. | WEAK |
| Private-insurer preauth/predetermination for orthoses | Confirm coverage before fitting | SickKids policy: insurer faxes authorization. Shows a manual step exists at one clinic, not pain. | WEAK |
| ODB Exceptional Access status call | Check status of EAP request | SADIE portal exists; Inquiry Services 1-800-262-6524. Mostly prescriber-driven. | WEAK |
| Pharmacy preauth | n/a in domain | NO EVIDENCE FOUND | NONE |
| Eligibility and benefit verification call before sale | Confirm hearing aid or O&P benefit | Not evidenced for Ontario private plans. | NONE |

No candidate reaches STRONG. No source quantifies phone minutes.

---

## 4. Conflicting evidence

- WSIB hearing trial period: policy says "at least 30 days", a billing page says 90 days.
- ADP hearing: published payment rule (75% to $500) vs vendor claim of 4 to 6 weeks processing. No official timeline found.
- CPhA 5+ hours/week figure vs the absence of any phone-specific figure. The figure may include non-phone work and non-receivable work (audits, PPN steering).
- Sources for EAP fax numbers conflict (416 327-7526 and 1-866-811-9908 vs 1-844-227-6590).
- Blueprint: "Claims Tracking (US only)" vs Canadian billing features. Emergis vs TELUS (older vs newer page).
- Electronic adjudication (pharmacy, WSIB nightly submission) means decisions are fast; the evidence of a large unpaid-receivable phone problem is thin. The only quantified pain is the CPhA survey.
- Medavie says portal is easiest for VAC preauth, which weakens a phone product for that payer.

---

## 5. Eight most important remaining unknowns and the source that would answer each

1. How many hours per week hearing and O&P staff spend phoning payers, and for which payers. Source: interviews are out of scope; closest desk source is the CASLPO or Canadian Academy of Audiology practice management surveys, or Davidson/HearCanada full job descriptions (Indeed Canada, Workopolis).
2. Whether ODB claim rejects or recoupments need phone contact beyond the help desk. Source: Ontario Drug Program Reference Manual and the HNS Operations manual on health.gov.on.ca (opdp_eo section).
3. Recoupment process and timelines for ODB and private payers. Source: Ontario Pharmacists Association Audit Assist page and the Ministry "Drug Benefit Claim Reversal" and inspection pages; Ontario Regulation 201/96 on e-laws.ontario.ca.
4. Private-insurer pended or short-pay rate for Canadian pharmacy claims. Source: CPhA full survey PDF (September 2025 release) and Canadian Pharmacy Technicians or OPA reconciliation guidance.
5. ADP hearing and orthotic claim status and payment timing for vendors. Source: ADP Hearing Devices Policy and Administration Manual (ontario.ca file 2026-02-11), sections on vendor claims and invoicing, and the ADP vendor billing bulletin.
6. Feature set of Kroll, Shoppers Assyst, Fillware, PharmaClik, Noah, HiClinic and Canadian DME software (reject management, reconciliation, preauth tracking). Source: each vendor's product or support site; Blueprint OMS user guide space blueprintoms.atlassian.net (BPUG21).
7. Private-plan preauth requirements for hearing aids, orthoses and DME (Sun Life, Manulife, Canada Life, Green Shield provider manuals), and approval validity. Source: each insurer's provider/pharmacy or "paramedical" provider portal manuals (for example Green Shield providerconnect.ca manuals).
8. Privacy and procurement stance: IPC views on AI voice agents and call recording, and what a custodian must contract. Source: IPC "AI Scribes: Key Considerations for the Health Sector" (ipc.on.ca, 2026-01-28) and PHIPA ss. 10, 17 on e-laws.ontario.ca. Also: any ASO employer reimbursement model (CLHIA, insurer ASO documentation) for the employer fit question.

---

## 6. Buyer objections found

- PHIPA agent liability: custodian must supervise agents (F2). No IPC guidance specific to voice agents.
- Regulatory scrutiny of pharmacy billing (F4, Auditor General 2017). Pharmacies may avoid tools touching ODB claims.
- ADP and VAC place authorization duties on the provider personally ("you are responsible for ...").
- Payer-side objection: carrier automation detection (stated in repo rules, not found in sources here). NO EVIDENCE FOUND in external sources.
- Several payers already offer portals (Medavie, TELUS WSIB, SADIE), which reduces the need to phone.
