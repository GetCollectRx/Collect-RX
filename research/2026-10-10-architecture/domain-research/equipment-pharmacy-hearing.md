# Domain research: medical equipment, pharmacy, hearing and disability-related services (Canada, Ontario first)

Date: 2026-10-11. Method: WebSearch only. IMPORTANT LIMITATION: WebFetch and direct HTTPS to ontario.ca, canada.ca (sac-isc.gc.ca), health.gov.on.ca and canadianaudiology.ca were blocked in this environment (DNS/proxy 403), so I could not open any page in full. Every fact below comes from search-result summaries that quote or paraphrase the named page. Tags:

- VERIFIED = search result quoted or closely paraphrased a primary source (government, regulator, insurer or PBM page) whose URL is listed. Not independently confirmed by a full page read, so re-check before external use.
- SECONDARY = association minutes, law firm blogs, university HR pages, news, job postings.
- UNVERIFIED = no source found; stated as inference or open question.

No figures are invented. Where nothing was found, it says so.

## 0. Bottom line (short)

1. Most payers in this domain adjudicate electronically at point of sale (pharmacy) or accept electronic submissions (ADP, MCEDT/GO Secure). Unpaid-receivable phone work is therefore thin and exception-driven.
2. The better phone fit is preauthorization and approval-status chasing (NIHB prior approval, WSIB pre-approval, group insurer predetermination, specialty drug prior auth, auto insurer OCF-18), not classic AR chasing.
3. Pharmacy is a weak fit for AR chasing (real-time adjudication, PBM intermediaries, audits are paper/portal processes). Hearing/audiology and orthotics/prosthetics are the medium fits. Employer HR and disability administration is a poor fit for an AR product.

## 1. Payers per sub-industry: who is billed, how, who is the debtor

Sub-industries: (E) home medical equipment, mobility, respiratory; (O) orthotics and prosthetics; (H) audiology and hearing clinics; (P) retail and specialty pharmacy.

| Payer | Sub-industries | How the provider bills | Debtor vs payer | Source / tag |
|---|---|---|---|---|
| Ontario ADP (Ministry of Health) | E, O (some), H | Vendor must be ADP-registered (application with original signatures, mailed; ministry target to review within six months of complete application; changes reported within 10 days). Claims since 1 Jan 2022 are electronic only, via GO Secure plus MCEDT enrolment, XML files; vendor gets an e-submission status report for each file, downloadable for 12 months. For hearing aids the vendor completes the application with the client and submits electronically. ADP pays the program share (cited as 75 percent; cap per device conflicting in sources) and the client pays the rest. | Split: ADP pays its share to vendor; client owes the remainder (the vendor's receivable from the client is outside a payer-chasing product). | Vendor registration https://www.ontario.ca/document/assistive-devices-program-health-care-professionals/register-authorizer-or-vendor (VERIFIED, search summary); hearing page https://www.ontario.ca/page/hearing-devices (VERIFIED, search summary); eSubmission memos https://files.ontario.ca/moh-adp-memo-esubmission-qa-en-2020-11-04.pdf and https://www.ontario.ca/files/2025-07/moh-adp-training-technical-specification-electronic-submissions-en-2025-07-10.pdf (VERIFIED); 75 percent and per-device cap: City of Toronto https://www.toronto.ca/community-people/employment-social-support/health-support/medical-supplies-and-devices/ and advocacy docs (SECONDARY, cap conflicts, UNVERIFIED) |
| Ontario Drug Benefit (ODB), Trillium Drug Program (TDP), Exceptional Access Program (EAP) | P | Pharmacy claims via the ministry's Health Network System (HNS), which handles submission, adjudication and payment; described by the Auditor General as linked to roughly 3,050 pharmacies in 2009 (historical). ODB Act: operator entitled to payment if claim is submitted in the prescribed manner with prescribed information. TDP: patient pays a deductible of about 4 percent of household income in quarters, then $2 per prescription; any Ontario pharmacy can bill. | Debtor = the province (payer = debtor). Patient owes copay/deductible. | Auditor General https://www.auditor.on.ca/en/content/annualreports/arreports/en09/405en09.pdf (VERIFIED, historical); ODB Act https://www.ontario.ca/laws/statute/90o10/v4 (VERIFIED); TDP https://www.ontario.ca/page/get-help-high-prescription-drug-costs (VERIFIED) |
| Group extended health insurers, TPAs, PBMs | P, H, E, O | Pharmacy: electronic claim to a PBM (Express Scripts Canada, TELUS Health are named as the two largest), not directly to the insurer; pharmacy carries the cost until reimbursed. TELUS says it settles claims for 15 insurers and payers. Hearing/orthotics: typically patient pays and claims, or provider submits via insurer portal; some plans want predetermination. | Debtor = plan sponsor/insurer (or patient where not pay-direct). | CPhA PBM fact sheet https://www.pharmacists.ca/cpha-ca/assets/File/cpha-on-the-issues/PBM_FactSheet_final.pdf (SECONDARY, advocacy); TELUS https://www.telus.com/en/health/health-professionals/pharmacies/support-documents (VERIFIED, vendor page); Sun Life hearing page https://www.sunlife.ca/en/health/personal-health-insurance/need-a-hearing-aid-heres-how-you-can-pay-for-it/ (VERIFIED, says check plan booklet) |
| NIHB (Indigenous Services Canada), run via Express Scripts Canada | P, H, E, O | Providers bill the program directly via Express Scripts Canada, which processes claims and payment; many medical supplies and equipment (MS&E) items need no prior approval, some go to the NIHB regional office; audiology prior approval form goes to the regional office with a prescription/referral and an audiometric assessment under 6 months old. | Debtor = federal program. | MS&E https://www.sac-isc.gc.ca/eng/1579620079031 (VERIFIED); audiology list https://www.sac-isc.gc.ca/eng/1585321635593 (VERIFIED); general policies https://sac-isc.gc.ca/eng/1585321312092/1585321331369 (VERIFIED) |
| Veterans Affairs Canada (VAC), administered by Medavie Blue Cross | H, O, E, P | Providers submit claims to Medavie via its provider portal; portal also used for VAC pre-authorization requests. Hearing aids on the pre-approved grid can be ordered without waiting for approval (2020 Q&A); VAC stated a processing goal of under 10 days (2024 minutes). | Debtor = federal program. | Medavie program doc https://pub.medavie.bluecross.ca/pub/0001/PublicDocuments/FAP-022%20POC%2011.pdf (VERIFIED); audiology association minutes https://canadianaudiology.ca/wp-content/uploads/2024/07/2024-Spring-FHP-Meeting-Minutes_final.pdf and https://canadianaudiology.ca/wp-content/uploads/2020/05/2020-May-21-FHP-Q-and-A-.pdf (SECONDARY) |
| WSIB (Ontario workers' compensation) | H, O, E | Hearing: clinics work with one of five contracted vendors; entry and mid-level models have expedited billing; exception-level aids need pre-approval before dispensing; audiogram within six months. Orthopaedic devices and prostheses covered when necessary; wheelchairs need clinical evidence. Provider invoice timelines: not found. | Debtor = WSIB (worker is not the debtor). | https://www.wsib.ca/en/operational-policy-manual/hearing-devices and https://www.wsib.ca/health-care-providers/preferred-suppliers/information-about-hearing-devices (VERIFIED) |
| Ontario auto insurers (SABS) | H, O, E, P | Treatment plan on OCF-18 submitted before services (insurer must respond within 10 business days); approved goods and services billed on OCF-21. Items costing $250 or less each, including hearing aids, wheelchairs, prostheses, orthotics, are listed as exceptions to the OCF-18 pre-approval requirement. | Debtor = auto insurer; claimant is the insured party. | LAT decision https://ztgh.com/wp-content/uploads/2022/07/Opoku_v._Jevco_Insurance__2021_ONLAT_20-003302_-_JW.pdf (VERIFIED, tribunal); OCF-21 form copy https://trlaw.com/wp-content/uploads/2026/05/OCF-21-AF-134E.pdf (SECONDARY); a note on a 1 July 2026 change in payor order was seen on a form copy and could not be confirmed (UNVERIFIED) |
| Other: ODSP (Ontario Disability Support Program) hearing aids, provincial programs, private pay | H, E | ODSP policy directive on hearing aids exists (not read). | Program or patient. | https://www.ontario.ca/document/ontario-disability-support-program-policy-directives-income-support/911-hearing-aids (title only, UNVERIFIED content) |

## 2. Electronic adjudication norm and where phone calls actually occur

What I verified:
- ADP: electronic-only since 1 Jan 2022 with status reports per file (VERIFIED, links above). Ministry states the intent is faster claims processing and payments; no payment-window figure found.
- ODB/TDP: HNS handles claim submission, adjudication and payment in a real-time online system (Auditor General 2009 and a 2004 committee transcript, https://www.ola.org/en/legislative-business/committees/public-accounts/parliament-38/transcripts/committee-transcript-2004-feb-12) (VERIFIED but old).
- NIHB: claims processed by Express Scripts Canada, which has a Provider Call Centre at 1 800 563-3274, open Mon-Fri 6:30 a.m. to midnight ET (from a recall bulletin, hours may differ for NIHB) https://express-scripts.ca/sites/default/files/2025-07/Drug%20Recall%20Protocol.pdf (VERIFIED, single document). The same bulletin says recall reversals older than 90 days go through the call centre.
- ODB help desk number, ODB claim deadline, pharmacy payment cycle: not found.

Inferred (not source-confirmed):
- Pharmacy: with real-time adjudication, the claim is accepted or rejected at the counter, so there is rarely an "unpaid pended claim" to chase. Phone work is mostly the pharmacy staff calling the PBM or ministry help desk for rejects, plus audit/recoupment disputes.
- Where phone calls happen today (inferred from the sources above): ADP vendor registration and status questions (adpvendors@ontario.ca is the listed mailbox, which suggests email is also used); NIHB prior approval status with regional office or Express Scripts; WSIB pre-approval for exception-level hearing aids; auto insurer follow-up on OCF-18 and OCF-21 payment; group insurer predetermination; audit and recovery correspondence (mostly written).

Fit honesty:
- Pharmacy (retail): weak for AR chasing. Real-time adjudication, remittance via PBM, little aging receivable. Auditor General evidence: ministry inspected 286 of more than 4,260 pharmacies in 2016/17 and recovered $9.1 million (VERIFIED, https://www.auditor.on.ca/en/content/news/17_summaries/2017AR%20summary%203.09.pdf), so audit recoveries are real but are formal inspections, not calls.
- Equipment (E): weak to medium. ADP e-submission shrinks phone need; power mobility needs clinical authorizer steps; auto and WSIB are payer-chasing cases.
- Hearing (H): medium. Mix of ADP, NIHB, VAC, WSIB, auto and group insurers, with real approval and predetermination steps.
- Orthotics/prosthetics (O): medium, driven by VAC/Medavie, WSIB, NIHB and group insurers. I found no source detailing O&P prior approval beyond VAC and WSIB mentions.

## 3. Preauthorization (type B: output is an approval reference, not money)

| Program | Requires prior approval for | Submission | Communication / validity | Phone? |
|---|---|---|---|---|
| ADP hearing | Application before purchase; ADP will not cover if the device is ordered or bought first (children's page). Prescription from audiologist or physician; from 2 March 2026 the ADP form has no prescriber section (CASLPO) | Vendor submits electronically | Not found | Not documented. Source: https://www.ontario.ca/page/hearing-devices (VERIFIED), https://caslpo.com/news/view/update-changes-to-adp-hearing-aid-funding-application-process-effective-march-2-2026 (VERIFIED, regulator) |
| NIHB | Audiology prior approval form to regional office (prescription or referral plus audiometric test under 6 months old). 2024 minutes: prior approval now needed for any new equipment; IIC/CIC regardless. Some MS&E items need prior approval | Forms from Express Scripts Canada NIHB site to regional office | Validity period not found | Regional office contact implied, not documented. https://www.sac-isc.gc.ca/eng/1585321635593 (VERIFIED); minutes (SECONDARY) |
| VAC / Medavie | Pre-authorization for items off the pre-approved grid, e.g. a third hearing aid accessory with justification | Provider portal is "easiest way" (VAC only) | Not found | Not documented |
| WSIB | Pre-approval for exception-level hearing aids and for HAT initial purchase, repair and replacement. One lost/stolen/damaged replacement considered every five years (policy) | Not detailed | Audiogram within six months | Not documented |
| Ontario EAP (drugs) | Non-formulary or restricted drugs. Request by Ontario physician or nurse practitioner via SADIE portal or fax (1-866-811-9908 toll-free, 416-327-7526); Telephone Request Service for selected drugs, decision usually by end of call | Prescriber-driven | Decision on call for selected drugs | Yes, but the caller must be authorized prescriber or delegate, not the pharmacy. https://www.ontario.ca/page/applying-exceptional-access-program (VERIFIED) |
| Group insurer drug prior auth | Specialty and select drugs. Prescriber completes a form (Express Scripts Canada: blank mandatory fields cause automatic denial; fax 1 (855) 712-6329; appeal right). Empire Life: prescription can still be filled without approval but may not be covered. Sun Life pay-direct for specialty drugs at network pharmacies | Prescriber form by fax/portal; TELUS Health, Canada Life and Innomar piloted electronic prior auth | Turnaround: no insurer standard found; only forum anecdotes (UNVERIFIED) | Mostly fax/portal. https://www.express-scripts.ca/sites/default/files/paf/en/default.pdf (VERIFIED); https://www.empire.ca/sites/default/files/2025-10/GRP-1027-PBM-PriorAuthorization-Brochure-EN-web.pdf (VERIFIED); Sun Life https://www.sunlife.ca/content/dam/sunlife/regional/canada/documents/gb/drug-costs-matter-prior-authorization-gb00233.pdf (VERIFIED) |
| Group insurer predetermination (hearing, long-term aids) | Recommended, not universally required; plan-specific | Insurer submission | Not found | University HR pages (SECONDARY): https://carleton.ca/hr/description/when-do-i-need-predeterminations-or-estimates-approved-by-canada-life/ |
| Auto SABS | OCF-18 before services except items of $250 or less each | OCF-18 via insurer | Insurer must respond within 10 business days with reasons for any denial | Law firm and LAT sources; phone not documented |

Call objectives for preauthorization (inferred from the above): confirm receipt of the request; confirm missing documents; get the approval or reference number and effective/expiry dates; confirm approved item, quantity, code and amount; confirm whether the insurer will pay the provider directly. These are different from AR calls (see section 9). Prescriber-side prior auth (EAP, specialty drug) is initiated by the prescriber; a provider-side agent would at most track status.

## 4. Reasons for delay or rejection and phone-resolvability

Documented: ordering before approval leads to denial (ADP children's page, NIHB 2015 note); mandatory blank fields cause automatic denial (Express Scripts form); audiometric report age limits (NIHB 6 months, WSIB 6 months); pre-approval required for exception items (WSIB); prescription must be documented separately from the ADP form from March 2026; OCF-18 denial requires stated reasons.

Inferred mapping:
- A call can plausibly resolve: confirming receipt/status, finding which field or document is missing, getting a reference number, learning the resubmission channel, confirming eligibility on the date of service, benefit-maximum remaining (if the payer gives it by phone).
- Needs staff or clinical judgment: missing or invalid prescription or assessment (clinician must produce it), medical necessity disputes, appeals, expired authorization needing a new clinical justification, coverage exclusions, coordination of benefits (which plan is primary), audit holdbacks and recoupments (documentation and sometimes legal response).
- Rejects needing resubmission rather than payment: ADP e-submission files with errors (status report), NIHB rejects, PBM claim rejects. Resubmission is a data fix, not a chase.

## 5. Verifiable timelines and rules

- ADP vendor registration review target: six months from complete application (VERIFIED). Changes reported within 10 days (VERIFIED). Status reports retained 12 months (VERIFIED). Electronic-only since 1 Jan 2022 (VERIFIED).
- ADP hearing aid replacement: City of Toronto says every five years (SECONDARY). 75 percent share (SECONDARY).
- ADP audit: 2018 Auditor General found two compliance staff; 235 vendors reviewed over eight years and about $10 million recovered (VERIFIED) https://www.auditor.on.ca/en/content/news/18_summaries/2018AR_summary_3.01.pdf (historical).
- ODB: pharmacy must keep a copy of the paper Drug Benefit Claim Submission Form for two years (VERIFIED, ministry form 2784-87E). Proposed change of electronic claim reversal window from 7 to 90 days (SECONDARY, JD Supra, proposal only) https://www.jdsupra.com/legalnews/proposed-amendments-to-ontario-61742/. Initial claim submission deadline and payment cycle: not found.
- ODB audit: 2016/17 recoveries as above (VERIFIED, historical); ministry publishes list of pharmacies whose HNS accounts were terminated for unsupported claims (VERIFIED) https://health.gov.on.ca/en/pro/programs/drugs/opdp_eo/eo_communiq.aspx.
- NIHB: audits by Express Scripts Canada reported in 2012 press, one Yukon pharmacy asked to repay over $25,000 (SECONDARY, historical) https://www.theglobeandmail.com/news/national/aboriginal-health-benefit-claims-under-review/article4597268. NIHB submission deadline: not found.
- SABS: insurer response to OCF-18 within 10 business days (VERIFIED, LAT decision).
- WSIB: audiogram within six months; Form 7 within three business days (SECONDARY law-firm summaries for Form 7). WSIB provider payment timelines: not found.
- OHIP physician claims (not this domain, shown only because the search surfaced it): three-month submission window from 1 April 2023. Do not apply to pharmacy or ADP.

## 6. Contact patterns

Verified: Express Scripts Canada Provider Call Centre 1 800 563-3274 with hours above (single bulletin); Express Scripts Canada Clinical Services fax 1 (855) 712-6329 for prior auth; EAP faxes above; Trillium 416-642-3038 or 1-800-575-5386, trillium@ontariodrugbenefit.ca (enrolment, not pharmacy billing); ADP vendors mailbox adpvendors@ontario.ca (from ADP memos). Not found: hold times for any payer, ODB pharmacy help desk number, WSIB provider line, Medavie provider line, authentication requirements for discussing a member file.

Identifiers likely required (inferred from forms and policies seen): client/member id, plan or group, provider registration (ADP vendor number, CPSO number or NP registration for prescribers on EAP), device or drug identifier (DIN for drugs, ADP device codes), prescriber, date of service, authorization or reference number. Specific verification questions per payer remain UNVERIFIED.

## 7. Reconciliation

Verified: ADP e-submission status report per file; ADP also has e-invoice and e-renewal file types (memo). Inferred: pharmacy reconciliation is via PBM or HNS remittance with reversals/recoupments; NIHB via Express Scripts payment statements; VAC via Medavie "payment summaries" in the portal (the Medavie document says the portal lets providers view payment summaries). Rejects needing resubmission are common and are not payment chases. No remittance format details found for WSIB, auto or group insurers.

## 8. Employer HR and disability administration

I did not find sources on STD/LTD, ASO administration, accommodation or leave-form workflows in Ontario (the search returned only WSIB Form 7 material). Everything below is inference.

- Workflows: employee leave/claim forms, attending physician statements, insurer claim adjudication, return-to-work and accommodation, WSIB Form 7 reporting (employer's report within three business days, SECONDARY law-firm summary).
- Counterparties: group disability insurer or ASO administrator, WSIB, employee, treating clinician.
- True receivables: rare. Cases that might qualify: employer wage advances during a WSIB waiting period said to be reimbursable (SECONDARY, unverified at WSIB); self-insured/ASO plans where the employer funds and is not owed anything; employer top-up recoveries from an insurer after retroactive approval (inferred, not sourced).
- Recommendation: out of scope for an AR-chasing product. The business is not the payee for its own services, the work is form completion and status checking that serves an employee claim, and the phone contact usually requires the employee's consent. If ever pursued, treat it as a separate "claim status for employee" workflow, not receivables.

## 9. Conclusion

Ranking for realistic phone-based follow-up (fit is my judgment; evidence base is thin):

1. Hearing and audiology clinics: MEDIUM. Multiple payers, real approvals (NIHB regional office, WSIB exception-level, VAC grid exceptions, group predetermination), A-type and B-type calls both exist.
2. Orthotics and prosthetics providers: MEDIUM. Payers VAC/Medavie, WSIB, NIHB, group insurers, auto; evidence for process detail is weak.
3. Home medical equipment, mobility, respiratory: WEAK to MEDIUM. ADP e-submission removes much phone work; value is in auto/WSIB/NIHB cases and authorizer-dependent funding, which need clinical staff.
4. Retail and specialty pharmacy: WEAK for AR (real-time adjudication, PBMs), pockets of MEDIUM for specialty drug prior auth status and PBM audit disputes, but prior auth is prescriber-initiated and fax/portal-based.
5. Employer HR and disability administration: NONE for AR.

Distinct call objectives:
- AR (A): status of a submitted claim, why short-paid, remittance/payment trace, resubmission channel, documents needed.
- Preauth (B): confirm receipt, missing documents, reference number, validity dates, approved scope.
- Audit/recoupment (C): what is being recouped, which claims, documents needed, deadline to respond (mostly written; phone to obtain instructions).
- Registration (D): vendor/provider registration status (ADP, Express Scripts, Medavie).

Separate workflows needed: yes. B-type calls have different completion criteria (an authorization number and expiry), different timing (before service), and sometimes prescriber-only authority (EAP). Pharmacy audit and registration calls differ again. Recommend B and A as separate call types in any payer-agnostic engine, with a payer-specific script library.

Five most important unknowns:
1. Actual ADP vendor payment timing and whether vendors call ADP for status (no source found); also current ADP per-device funding cap.
2. ODB claim submission deadline, payment cycle and pharmacy help desk process, and whether pharmacies call at all after real-time rejection.
3. Whether payers (NIHB regional offices, Medavie, WSIB, Ontario auto insurers, group insurers) will speak to a third-party AI agent on a provider's behalf, and what authentication they require. No source found for any payer.
4. Real volume of unpaid or aged receivables per sub-industry (no primary data found; ask practitioners and association members, e.g. audiology clinics, O&P providers, HME vendors).
5. Validity periods and expiry rules for approvals (NIHB, WSIB, VAC, group predetermination), and WSIB/auto insurer provider payment turnaround.

## Source list (all unfetched, referenced via search results)

- https://www.ontario.ca/document/assistive-devices-program-health-care-professionals/register-authorizer-or-vendor
- https://www.ontario.ca/page/hearing-devices
- https://files.ontario.ca/moh-adp-memo-esubmission-qa-en-2020-11-04.pdf
- https://www.ontario.ca/files/2025-07/moh-adp-training-technical-specification-electronic-submissions-en-2025-07-10.pdf
- https://caslpo.com/news/view/update-changes-to-adp-hearing-aid-funding-application-process-effective-march-2-2026
- https://www.toronto.ca/community-people/employment-social-support/health-support/medical-supplies-and-devices/
- https://www.auditor.on.ca/en/content/news/18_summaries/2018AR_summary_3.01.pdf
- https://www.auditor.on.ca/en/content/news/17_summaries/2017AR%20summary%203.09.pdf
- https://www.auditor.on.ca/en/content/annualreports/arreports/en09/405en09.pdf
- https://www.ontario.ca/laws/statute/90o10/v4
- https://health.gov.on.ca/en/pro/programs/drugs/opdp_eo/eo_communiq.aspx
- https://www.ontario.ca/page/get-help-high-prescription-drug-costs
- https://www.ontario.ca/page/applying-exceptional-access-program
- https://www.sac-isc.gc.ca/eng/1579620079031
- https://www.sac-isc.gc.ca/eng/1585321635593
- https://sac-isc.gc.ca/eng/1585321312092/1585321331369
- https://express-scripts.ca/sites/default/files/2025-07/Drug%20Recall%20Protocol.pdf
- https://pub.medavie.bluecross.ca/pub/0001/PublicDocuments/FAP-022%20POC%2011.pdf
- https://www.wsib.ca/en/operational-policy-manual/hearing-devices
- https://www.wsib.ca/health-care-providers/preferred-suppliers/information-about-hearing-devices
- https://ztgh.com/wp-content/uploads/2022/07/Opoku_v._Jevco_Insurance__2021_ONLAT_20-003302_-_JW.pdf
- https://www.pharmacists.ca/cpha-ca/assets/File/cpha-on-the-issues/PBM_FactSheet_final.pdf
- https://www.telus.com/en/health/health-professionals/pharmacies/support-documents
- https://www.sunlife.ca/en/health/personal-health-insurance/need-a-hearing-aid-heres-how-you-can-pay-for-it/
- https://www.express-scripts.ca/sites/default/files/paf/en/default.pdf
- https://www.empire.ca/sites/default/files/2025-10/GRP-1027-PBM-PriorAuthorization-Brochure-EN-web.pdf
- https://www.sunlife.ca/content/dam/sunlife/regional/canada/documents/gb/drug-costs-matter-prior-authorization-gb00233.pdf
- https://canadianaudiology.ca/wp-content/uploads/2024/07/2024-Spring-FHP-Meeting-Minutes_final.pdf
- https://canadianaudiology.ca/wp-content/uploads/2020/05/2020-May-21-FHP-Q-and-A-.pdf
- https://carleton.ca/hr/description/when-do-i-need-predeterminations-or-estimates-approved-by-canada-life/
- https://www.theglobeandmail.com/news/national/aboriginal-health-benefit-claims-under-review/article4597268
- https://www.jdsupra.com/legalnews/proposed-amendments-to-ontario-61742/
