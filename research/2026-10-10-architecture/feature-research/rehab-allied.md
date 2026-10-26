# Rehab and allied health clinics (Ontario): billing follow-up evidence

Date: 2026-10-13. Domain: Ontario auto rehab and allied health clinics billing SABS insurers (OCF-18/21, HCAI), extended health, WSIB.

## Method and limits (read first)

- WebFetch failed on every attempt (getaddrinfo ENOTFOUND for fsrao.ca, hcaiinfo.ca, jane.app, ola.org). No page was read in full.
- All "quotes" below are excerpts as returned by the WebSearch tool. Some excerpt text is the tool's own summary wording, not a verified verbatim quote from the page. Items marked [EXCERPT, UNVERIFIED VERBATIM] must be re-checked against the live page before anyone cites them externally.
- Tags: PRIMARY (regulator, program, vendor manual), SECONDARY (law firm, trade press, vendor blog), OPINION (job post, submission by interested party, forum).
- No phone call, signup or contact was made.

## 1. What I verified (with quotes)

### 1a. The process: who submits what where

1. HCAI is mandatory for OCF-18/21/23 submission. PRIMARY (HCAI program site, hcaiinfo.ca, via search; also Canadian Underwriter). URL: https://www.hcaiinfo.ca/insurers/adjuster-support/form-overview . Excerpt: "The Health Claims for Auto Insurance (HCAI) system is where decisions are recorded." and, from the search summary of HCAI intro, "Every Ontario health care business ... that directly submits OCF-18s, -21s, -23s ... must do so only through HCAI." [EXCERPT, UNVERIFIED VERBATIM]
2. OCF-18 is approval, OCF-21 is the invoice. PRIMARY (OCF-21 form PDF, https://trlaw.com/wp-content/uploads/2026/05/OCF-21-AF-134E.pdf, FSRA form hosted by a law firm). Excerpt: "The OCF-21 is used to invoice automobile insurers for the medical and rehabilitation goods and services, assessments and examinations submitted under the OCF-18 and OCF-23 forms."
3. First-payor change effective July 1, 2026 (same form). Excerpt: "effective July 1, 2026, auto insurers are the first payors for medical and rehabilitation benefits" (not medication). [EXCERPT, UNVERIFIED VERBATIM] Implication: extended health is now secondary for rehab, which changes who the clinic chases. I did not verify the underlying regulation.
4. Licensing decides who gets paid directly. PRIMARY (FSRA/HCAI via search). Excerpt: "Only FSRA-licensed providers can receive direct payment from insurers." Unlicensed facilities submit the OCF-21 in HCAI but the claimant is reimbursed; the insurer waits for a paper copy from the claimant and HCAI "cannot tell when that paper copy arrived", so "Days Left" is blank. URLs: https://www.fsrao.ca/licensing/health-service-provider/about-service-provider-licence-ontario , https://www.hcaiinfo.ca/insurers/adjuster-support/entering-a-response-decision/adjudicating-the-ocf-21 . [EXCERPT, UNVERIFIED VERBATIM]
5. Invoicing cadence. SECONDARY (search summary of a 2011 FSCO bulletin, Canadian Underwriter / OLA collections): invoices "only once a treatment plan has been completed, or once every 30 calendar days if the treatment extends beyond a month." [EXCERPT, UNVERIFIED VERBATIM]
6. Plan number needed for reconciliation. SECONDARY (Canadian Underwriter, 2012, https://canadianunderwriter.ca/2012/06/29/fsco-introduces-new-hcai-guidelines-to-help-insurers-reconcile-health-care-invoices/ ): FSCO made the OCF-18/23 plan number mandatory on OCF-21 "so insurers can match each invoice to its plan." A missing or wrong plan number is plausible as a stall cause; no source states it as a measured cause (see section 2).
7. Decision step in HCAI. PRIMARY (https://www.hcaiinfo.ca/insurers/adjuster-support/entering-a-response-decision/adjudicating-the-ocf-21): adjuster approves, partially approves or declines line items, then "validating the decision by submitting a final decision." Partial approval is therefore a built-in outcome.

### 1b. Roles and duties (job postings, OPINION)

- Concussion-care clinic billing coordinator (Job Bank): https://nb.jobbank.gc.ca/jobsearch/jobposting/41328066 . Excerpts: "Submitting monthly invoices (OCF-21) to Insurance for patients' treatment plans." "Connecting with insurance adjusters directly for payments." "Ensuring A/R for all clinics remains low". Also weekly WSIB billing, monthly A/R reports, 3+ years MVA/WSIB experience, $18 to $21 per hour part-time. [EXCERPT, UNVERIFIED VERBATIM]
- Workopolis medical billing posting: https://www.workopolis.com/jobsearch/medical-ohip-billing-jobs . Excerpt: "Communicate directly with insurance adjusters and lawyers regarding claim status, documentation, and approvals."
- Sunnybrook St. John's Rehab service coordinator: https://sunnybrook.talcura.com/Cands/Job.aspx?JobId=8981 . Excerpt: "Act as Authorizing Officer ... on Health Claims for Auto Insurance (HCAI), oversee submission of OCF-18 treatment plans". Shows the role of the HCAI Authorizing Officer (who signs) is distinct from the biller.
- Toronto MVA Coordinator posting: "Manage all Motor Vehicle Accident (MVA) billing processes from intake through claim resolution." Pay $45,000 to $55,000. Source URL from search: simplyhired.ca JZ7CE... listing (not re-opened).
- Roles evidenced: front desk/intake, MVA billing coordinator, clinic manager (liaison with adjusters, lawyers, case managers), HCAI Authorizing Officer.

### 1c. Software and what it does and does not do

- Jane (jane.app). PRIMARY (vendor help). HCAI is not integrated: "we can only submit to HCAI by launching a portal outside of Jane and submitting from there." Recommended workflow is "third-party billing": one insurer profile per auto insurer, with the HCAI portal URL saved. URLs: https://jane.app/guide/hcai-billing-in-jane-faq , https://jane.app/guide/hcai-billing-in-jane-third-party-billing-workflow . A/R report lists "patients and insurers with money owing", filterable by account type and sortable by "how long the amount has been owing"; clicking an insurer opens outstanding invoices (https://jane.app/guide/accounts-receivable-report). Under block billing, a lump-sum insurer payment is applied to an appointment (https://jane.app/guide/hcai-billing-in-jane-block-billing-workflow). Electronic claim status and 835 remittance matching exist only through Claim.MD (https://jane.app/guide/integrated-claims-with-claim-md), which I could not confirm covers Ontario auto; that integration is a US-style 837/835 flow. NO EVIDENCE FOUND of any Jane reminder or follow-up-task feature for overdue insurer invoices (absence of mention in search results only, not proof).
- Embodia. PRIMARY (vendor guide): https://embodiaapp.com/guides/1169-clinic-billing-software-payments-invoicing-insurance-workflows-in-embodia-embodia-team/guide/20922-receiving-payment-from-hcai . HCAI payment is entered by staff: "Click Add payment, then enter the payment date, subtotal, and taxes", with an optional "Try to associate this payment with patient invoices on Embodia" auto-match. Payment recording is manual, not fed from the insurer.
- Juvonno. PRIMARY (vendor help): https://support.juvonno.com/hc/en-us/articles/360016411273 . HCAI dashboard statuses: "Submitted" lasts "30 days after submission"; "Awaiting EHB" when more than one insurer; "Ready to Submit". Statuses are about submission stage, not insurer payment chasing. Related titles seen: "How to Apply Third-Party Payments to HCAI Invoices" (not read).
- Practice Perfect. PRIMARY (vendor page): https://practiceperfectemr.com/features/billing-payments-accounts/ . Says it submits OCF-21 and OCF-18/23 to HCAI and lists Telus Health, WSIB, OHIP. No follow-up feature seen.
- ClinicMaster, Noterro, Cliniko: NO EVIDENCE FOUND (searches returned nothing on their Ontario MVA payment features).
- Pattern across vendors: payment is posted by hand; the HCAI portal holds the adjudication record; no vendor page found claims it phones insurers. Absence of "call the insurer" wording on vendor pages: NO EVIDENCE FOUND either way. The only "contact adjuster" language is in job postings.

### 1d. Payment rules (what a "late" payment is)

- SECONDARY (search summary of FSCO 2015 bulletin, https://collections.ola.org/ser/261677/2015/A03-15.pdf ): "The SABS requires all invoices to be paid within 30 days of receipt." and s. 38(15): insurer pays "within 30 days after receiving an invoice." Interest: "1 per cent per month, compounded monthly" on overdue amounts (O. Reg. 236/14 / s. 51). "Insurers shall not avoid their duty to pay interest owing for late benefits payments." The search did not confirm current consolidated text; verify at https://www.ontario.ca/laws/regulation/r14236 and O. Reg. 34/10.
- Implication: a 30-day deadline plus 1 percent monthly interest gives a concrete trigger for a follow-up call and an interest-owing claim. Whether clinics actually claim that interest: NO EVIDENCE FOUND.

### 1e. WSIB

- PRIMARY (WSIB forms): https://www.wsib.ca/sites/default/files/2024-09/3947a_202407_providerpaymentrequest_web.pdf and billing instructions. Billing questions go to the Health Professional Access Line (416-344-4526 or 1-800-569-7919, 8:30 to 4:30 weekdays). Bills must be submitted within 6 months of service; late bills can be reduced 25 to 100 percent. E-billing "lets providers view status of all bills." Vendor phone listings conflicted between documents (BCE Emergis vs Telus Health). No payment turnaround time published in what I saw. [EXCERPT, UNVERIFIED VERBATIM]

## 2. Payment delay evidence (Q4)

- OPA/OCA 2014, OLA Hansard (https://www.ola.org/fr/affaires-legislatives/comites/affaires-gouvernementales/legislature-40/transcriptions/transcription-comite-2014-avril-30 ): search summary says an association witness said members "remain vulnerable to not being paid in a timely fashion or sometimes not being paid at all." SECONDARY, UNVERIFIED VERBATIM, speaker not identified, 12 years old.
- OTLA submission to FSRA HCAI review, 29 Nov 2024 (https://fsrao.ca/sites/default/files/comments/2024-11/OTLA%20Submission%20FSRA%20Health%20Claims%20for%20Auto%20Insurance%20Submission%20-%20November%2029%2C%202024.pdf ): argues HCAI complexity "creates errors that delay payments" and added admin work. OPINION (lawyers' lobby, and about claimant treatment delay more than clinic cash).
- NNN Physio submission to FSRA, Nov 2024 (https://fsrao.ca/sites/default/files/comments/2024-11/NNN%20Physio%20-%20Auto%20Reforms%20Consultation%202024.pdf ): confirmed excerpt is about fighting adjusters and rates frozen about a decade. One search summary also said it cites insurer denials and partial payments as growing; I could not confirm that from an actual excerpt. OPINION.
- FSRA 2021-22 HSP market conduct report (https://www.fsrao.ca/industry/health-service-providers/publications/health-service-provider-2021-2022-market-conduct-compliance-annual-report ): lists unsigned OCF-21s among compliance concerns. Relevant because it is a provider-side cause of rejected or delayed invoices. Figures not retrieved.
- NO EVIDENCE FOUND: any published statistic on days-to-payment of OCF-21s, share of OCF-21 invoices short-paid or declined, write-off rates, FSRA or OmbudService complaint counts about unpaid provider invoices, LAT decisions about provider invoices (LAT results found were claimant benefit disputes, e.g. Hu v. Aviva 2023 ONLAT, Cross v. TD 2021 ONLAT, not clinic payment disputes), or quantified staff hours spent calling insurers. A Canadian physiotherapy A/R or hours-per-week benchmark: NO EVIDENCE FOUND. The only quantified denial survey surfaced was US (Experian Health 2024 State of Claims, 210 staff), not applicable.

## 3. Outsourced billing and phone time cost (Q3)

- NO EVIDENCE FOUND of an Ontario MVA-specific outsourced billing vendor with advertised pricing, turnaround or hours-saved claims. A generic Fiverr PT/OT billing gig was surfaced (https://fiverr.com/magnet_billing/do-your-pt-and-ot-billing), not Ontario auto.
- Phone follow-up as a task exists (job postings in 1b) but no posting or article quantifies call time.
- No forum thread found. A Reddit-style search returned none.

## 4. Privacy, trust and compliance objections (Q6)

- Confirmed only generic: vendor guide (callin.io, https://callin.io/ai-voice-agents-in-canada-privacy-compliance/ ) says recordings are personal information under Canadian law and callers must be told. SECONDARY, vendor marketing. PHIPA coverage absent.
- Clinic owner liability: Law Times reports the Ontario Superior Court upheld the College of Physiotherapists' authority over billing inaccuracies, with clinic owners obliged to ensure invoice accuracy (https://www.lawtimesnews.com/practice-areas/medical-malpractice/ontario-superior-court-upholds-the-college-of-physiotherapistss-authority-over-billing-inaccuracies/383982 ). Implication (inference, not stated by source): buyers will not want an agent that states things about invoices that the clinic has not verified.
- FSRA audits and fraud scrutiny of rehab billing (Canadian Underwriter story on a clinic fined $50,000 for false invoices). Context only, not an objection to phone automation.
- Buyer objections specifically about AI calling adjusters: NO EVIDENCE FOUND.
- Insurer-side policy on AI callers or recording: NO EVIDENCE FOUND.

## 5. Feature candidates

Confidence: STRONG = primary or several independent sources for both job and pain; WEAK = one source or opinion; NONE = no evidence.

| Feature | Job | Evidence | Confidence |
|---|---|---|---|
| Call adjuster for invoice payment status (OCF-21 submitted, no payment) | Replace biller's "connecting with insurance adjusters directly for payments" | Job Bank posting excerpt "Connecting with insurance adjusters directly for payments"; Workopolis "Communicate directly with insurance adjusters... regarding claim status". Pain (time, volume, outcomes): none quantified | WEAK on pain, job exists with 2 postings. Overall WEAK |
| Trigger on 30-day deadline | Start follow-up when day 30 after OCF-21 receipt passes | FSCO 2015 bulletin via search: "within 30 days after receiving an invoice"; 1 percent per month interest. Not verified on e-Laws | WEAK (rule found in secondary excerpt; no evidence clinics act on it) |
| Short-pay / partial approval query: ask adjuster which line items were reduced and why | Obtain reason and next step for partial decisions | HCAI adjudication has partial approve/decline per line (primary). Rates frozen and denial complaints in NNN submission (opinion). No frequency data | WEAK |
| Payment trace (cheque/EFT date, payee, amount) | Find where a paid-in-HCAI invoice's money is | Embodia and Jane both require manual payment posting; HCAI shows decisions not payments (search summary, not confirmed). No clinic complaint found about missing remittance | WEAK |
| Verify HCAI final decision recorded / pending | Ask if the adjuster has submitted a final decision | HCAI doc on final decision step (primary). No evidence of stalls | WEAK |
| Unlicensed-facility / paper OCF-21 receipt confirmation | Confirm insurer received claimant's paper copy | HCAI doc (primary) that receipt date is not tracked in HCAI. Niche (unlicensed only) | WEAK |
| Write outcome back to practice-management system as a follow-up note/task | Close loop in Jane/Embodia/Juvonno | Vendors record payments by hand (Embodia, Jane). Jane has no HCAI integration (primary). API access to these systems unverified | WEAK for need; NONE for feasible integration |
| Overdue insurer-invoice worklist from aging data | Pick which invoices to call | Jane A/R report exists with insurer filter and age sort (primary). Shows data is available to export; does not show clinics lack a worklist | WEAK |
| Extended health first-pay/second-pay confirmation after July 1, 2026 change | Confirm EHB secondary billing after auto decision | Form text on first-payor change; Juvonno "Awaiting EHB" status. Whether this generates calls: no evidence | WEAK |
| WSIB payment status call | Chase WSIB bill status | WSIB access line and "6 months" rule (primary); no payment timing or complaint found | WEAK |
| Staff handoff when adjuster requires clinic authorizer or documentation | Transfer live to biller or HCAI Authorizing Officer | Role split evidenced (Sunnybrook posting). No evidence adjusters ask for it on invoice calls | WEAK |
| Authorization capture (adjuster reference numbers, call ID, adjuster name) | Log who said what | No clinic-side source. General practice only | NONE |
| Consent / recording disclosure | Disclose AI and recording | Only generic vendor blog; no PHIPA or insurer policy source | NONE |
| Multi-invoice remittance reconciliation | One payment covers many OCF-21s | Jane block billing lump sum; Embodia auto-match attempt. No complaint about unmatched lump sums | NONE (for a phone product) |
| Reporting (days-to-pay by insurer) | Show insurer performance | Jane A/R report exists; no demand evidence | NONE |

## 6. Conflicting or weak evidence

- WSIB e-billing vendor/phone appears as BCE Emergis in one form and Telus Health in a billing guide.
- OTLA frames HCAI inefficiency as claimant treatment delay; clinics' cash delay is a different problem. OTLA and Équité (insurers' fraud body) have opposing interests; both are interested parties.
- Search summaries sometimes said "payment delays are long-running" while no source gave a number. Treat the pain claim as unproven.
- 30-day rule comes from a 2015 bulletin summary; later amendments (including 2026 first-payor changes) could differ.
- Jane's Claim.MD claim-status is for 837/835 flows; Ontario MVA is not a claims-clearinghouse flow. So "Jane has claim status" must not be read as covering OCF-21.

## 7. What I could not verify

- Verbatim text of any page (fetch failed everywhere).
- Whether insurers pay late or short with any measurable frequency.
- Hours of staff time, A/R days, write-off rates.
- Ontario outsourced billing vendors and their claims.
- Professional association manuals (OPA, OCA, RMTAO, CPO billing guides): not found.
- ClinicMaster, Noterro, Cliniko, other Ontario PMS features.
- Psychology, OT, SLP specific billing differences.
- Extended health follow-up processes (Telus eClaims etc.).
- OmbudService, FSRA complaint statistics on provider invoices.
- Insurer attitudes to AI callers.

## 8. Eight most important remaining unknowns

1. How often and how long OCF-21s go unpaid past 30 days. Source: ask clinics (founder-led interviews, outside this agent's scope), or FSRA's HCAI review reports at https://www.fsrao.ca/engagement-and-consultations/consultation-auto-reforms and its HCAI data publications.
2. Current text of the 30-day payment and interest rule. Source: https://www.ontario.ca/laws/regulation/100034 (O. Reg. 34/10 s. 38, s. 51) and FSRA's current guidance.
3. Whether HCAI shows payment, not just decision. Source: HCAI provider user manual and OCF-21B page https://www.hcaiinfo.ca/health-care-facilities/provider-support/ocf-21b .
4. Staff time per invoice chase. Source: Ontario Physiotherapy Association and Ontario Chiropractic Association member surveys, and their FSRA responses (https://www.fsrao.ca/sites/default/files/comments/2024-11/Ontario%20Physiotherapy%20Association%20Response%20to%20FSRA%20Auto%20Consultation.pdf ).
5. What the NNN Physio submission actually says about denials and partial payments. Source: the full PDF at the fsrao.ca URL in section 2.
6. Which PMS products Ontario MVA clinics use and their export/API options. Source: Jane, Juvonno, Embodia, ClinicMaster, Practice Perfect developer or API pages; Jane marketplace at https://integrations.jane.app .
7. Legality and consent of an AI voice agent calling an insurer about a patient's claim in Ontario (PHIPA agent/custodian rules). Source: IPC Ontario PHIPA guidance (ipc.on.ca) and a health privacy lawyer.
8. Insurer adjuster policies on third-party or automated callers, and whether they will discuss claims by phone with clinics. Source: insurer provider portals/guides (Intact, Aviva, TD, Co-operators) and the Insurance Bureau of Canada or FSRA adjuster guidance.
