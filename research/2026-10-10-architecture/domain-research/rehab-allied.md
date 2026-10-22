# Domain research: Auto rehab and allied healthcare (Ontario)

Date: 2026-10-11. Scope: physio, multidisciplinary rehab, chiro, psychology, OT, SLP, massage. Workflows: (1) Ontario MVA / SABS, (2) extended health benefits (EHB), (3) WSIB.

## 0. Method and honesty note (read first)

- WebFetch could NOT reach any primary site (fsrao.ca, hcaiinfo.ca, ontario.ca, wsib.ca): DNS failure, then the egress proxy returned 403 on CONNECT. I did not try to bypass this.
- Everything below therefore comes from WebSearch result summaries, which quote or paraphrase primary pages and decisions. No primary page was read in full by me.
- Tag meaning used here:
  - VERIFIED = the search excerpt quoted or closely paraphrased a primary source (regulation, regulator, WSIB, HCAI, CRTC page, tribunal decision citing the regulation). Excerpt-level only; re-read the full page before relying on it.
  - SECONDARY = law firm, broker, vendor, practice-software or insurer-consumer blog.
  - UNVERIFIED = not found, or only an inference.
- No dollar, percentage or day figure appears here unless a source returned it.

## 1. What I verified (by question)

### Q1. Debtor, payer, administrator, payee, who staff call when late

MVA / SABS
- Payer: the claimant's auto insurer (accident benefits insurer). Administrator: the insurer's accident benefits adjuster, who adjudicates OCF-18 and OCF-21 and records decisions in HCAI. Evidence: HCAI says the insurer must mark adjudication decisions on the form in HCAI; OCF-21B has tabs for adjuster info, line-item adjudication and decisions. VERIFIED (excerpt) https://www.hcaiinfo.ca/health-care-facilities/provider-support/ocf-21b
- Payee depends on licensing. A facility with a valid FSRA Service Provider Licence at both the service date and the invoice submission date can be paid directly by the insurer. An unlicensed facility must still submit the OCF-21 via HCAI, answers "No" to "payee is the facility", must give the claimant a printed copy, and the insurer reimburses the claimant, not the facility. VERIFIED (excerpt) https://www.hcaiinfo.ca/insurers/adjuster-support/service-provider-licensing and https://hcaiinfo.ca/Insurers/News/Bulletins/Invoicing-on-HCAI-Its-not-just-for-licensed-facilities.asp
- Legal debtor: for a licensed facility paid directly, the insurer is the practical payer; for an unlicensed facility the money flows to the claimant, so the claimant is the practical debtor to the clinic. The exact SABS wording on the insurer's obligation to the provider was not retrieved. UNVERIFIED for statute text.
- Who staff contact when late: adjuster (inferred, see section 2). Licence info: https://www.fsrao.ca/licensing/health-service-provider/about-service-provider-licence-ontario (listed in results, content not read).

EHB
- Payer: group insurer or administrator (e.g. Canada Life, Sun Life, Manulife, Green Shield). Direct billing by clinics via TELUS Health eClaims is described by vendors; payee is set per claim (provider or insured member); timing and method vary by insurer and TELUS publishes an "Insurer Payment Guide" with payment contacts. SECONDARY https://embodiaapp.com/guides/1169-practice-management-on-embodia-part-3-billing-embodia-team/guide/16177-submitting-a-claim and https://support.clinicsense.com/hc/en-us/articles/41596491205523-TELUS-Health-eClaims-FAQ
- Legal debtor: the plan member owes the clinic when the insurer does not pay (inferred). UNVERIFIED.
- Plan sponsor (employer) is the policyholder; insurer usually administers. Not sourced. UNVERIFIED.

WSIB
- Payer and administrator: WSIB. The worker is not liable: practitioners cannot ask a worker to pay for care under the insurance plan; no action lies against anyone other than WSIB for payment; no action lies against WSIB for more than the scheduled fee. VERIFIED (excerpt) https://www.wsib.ca/node/2191 and archived https://www.wsib.ca/en/operational-policy-manual/health-care-fees-archived-december-5-2024
- Billing channel: e-billing processed through TELUS Health Solutions (submit, update, void, view bill status, view online remittance). VERIFIED (excerpt) https://www.wsib.ca/en/fee-schedule-musculoskeletal-program-care
- Who staff call: the TELUS Health e-billing help desk for bill and payment inquiries; WSIB's 2019 billing guide lists 1-866-240-7492, but that number also appears on an older form that cites a former provider, so it may be stale. SECONDARY/UNVERIFIED for the number https://www.wsib.ca/sites/default/files/2019-03/billinginstructions_1.pdf and https://go.telushealth.com/hubfs/wsib/THS2684_WSIB_Start_Up_Guide_EN.pdf

### Q2. How status is found today; electronic vs phone

- MVA: all OCF-18/OCF-21 go through HCAI (OCF-21 and OCF-18 are forms required to be submitted via HCAI). VERIFIED (excerpt) https://www.hcaiinfo.ca/insurers/adjuster-support/form-overview. Insurer records adjudication decision (approve/partial/decline) in HCAI, so decision status is electronic. I found no source saying HCAI shows a "paid" status or processes payment; a vendor guide has staff record payment manually after receiving it. SECONDARY https://blog.embodiaapp.com/guides/1169-practice-management-on-embodia-part-3-billing-embodia-team/guide/20921-connecting-hcai-plans-and-invoices-to-invoices-on-embodia. So "was it paid / when / to whom" is the likely phone gap. Inference, see section 2.
- EHB: eClaims returns an EOB within seconds for accepted claims, or rejection, pending, or error. SECONDARY (vendor docs, see Q1 links). Payment after EOB varies by insurer; the TELUS insurer payment guide, not read, lists contacts. So status after adjudication: portal/remittance first, phone for trace.
- WSIB: e-billing portal shows status of all bills and online remittance statements. VERIFIED (excerpt) https://www.wsib.ca/en/fee-schedule-musculoskeletal-program-care. Phone only via help desk (above).
- Where phone is the only path: not directly sourced for any workflow. Inferred below.
- Where phone is unnecessary/rare: WSIB bills with e-remittance; EHB claims paid same-session; MVA decisions already visible in HCAI. Inferred.

### Q3. Timelines, interest, deadlines, consequences

MVA / SABS
- Invoice payment: insurer must pay within 30 days of receiving the invoice (s.38(15) for OCF-18 goods and services, s.39(2)(c) for certain no-plan expenses; a secondary table lists s.40(4) MIG invoices at 30 days too). VERIFIED (excerpt of FSCO bulletin) https://fsrao.ca/media/6796/download ; SECONDARY table https://virtualassociates.ca/?p=142
- Interest: s.51(2) per FSCO 2015 bulletin: 1 per cent per month, compounded monthly, accruing daily from the day overdue; cannot be negotiated away. VERIFIED (excerpt) https://fsrao.ca/media/6796/download and https://collections.ola.org/ser/261677/2015/A03-15.pdf. I did not confirm that this rate is unchanged in 2026; a bulletin points to a 2014 amendment that altered how interest is calculated. Old accidents (pre Sept 1 2010) use 2 percent per month. VERIFIED (excerpt) https://www.ontario.ca/laws/regulation/100034/v7 via search
- Treatment plan response: s.38(8): within 10 business days after receiving the treatment and assessment plan the insurer shall give notice of which items it will pay for and which it refuses, with medical and other reasons. Tribunal consequence in one decision: insurer paid incurred treatment from the 10th business day to denial date; 5 extra business days were added for regular mail. VERIFIED (excerpt of regulation text as quoted in tribunal decisions) https://ztgh.com/wp-content/uploads/2024/04/He-v-Co-operators-General-Insurance-Company-2023-CanLII-50591.pdf and https://ztgh.com/wp-content/uploads/2022/07/Kyrylenko_v._Aviva_Insurance_Canada_-_Reasons_for_Decision_-_Final_July_14signed.pdf. Whether silence is "deemed approval" was NOT confirmed.
- Receipt date matters; some insurers count from HCAI review rather than transmission, and a tribunal accepted the respondent's evidence on receipt date in one case. SECONDARY https://neinstein.com/news-blog/legal-news/what-to-do-if-auto-insurance-denies-your-treatment-plan-in-ontario
- MIG cap: medical and rehab limited to $3,500 where impairments are predominantly minor injury; exception with compelling evidence of pre-existing condition preventing maximal recovery within the cap. VERIFIED (excerpt of tribunal decisions quoting s.18(1)) https://ztgh.com/wp-content/uploads/2024/04/22-002955-Decision.pdf
- July 1, 2026 SABS change: medical, rehabilitation and attendant care remain mandatory; other accident benefits become optional; coverage narrowed to named insured, spouse, dependants, listed drivers for optional benefits; auto insurer pays first for medical/rehab (except medications), which affects EHB coordination; endorsements OPCF 47R / OEF 47R; insurers may add at renewal or midterm for pre-July policies. SECONDARY summary of FSRA pages; FSRA page itself is https://www.fsrao.ca/industry/auto-insurance/changes-statutory-accident-benefits-coverage-ontario-july-1-2026 (listed, not read). Also https://www.ribo.com/licensee-resources/sabs-changes/ and https://www.belairdirect.com/blog/changes-statutory-accident-benefits-coverage-ontario-july-1-2026
- July 2026 HCAI change: Release 3.35 live June 29, 2026; new OCF versions available July 1, 2026 (Gender X option, first-payor wording, FSCO to FSRA references, minor legal text); OCF-23 and its EOB being redeveloped with no functional change. VERIFIED (excerpt) https://www.hcaiinfo.ca/insurers/what-s-new/news/hcai-update-release-3-35-june-29-2026 and https://www.hcaiinfo.ca/insurers/what-s-new/news/hcai-2026-the-year-ahead. Conflict: a vendor says new printed forms apply by policy renewal after July 1. SECONDARY https://practiceperfectemr.com/blog/hcai-update-july-1-2026/. Unresolved.
- HCAI invoicing frequency: a 2011 rule (invoice on plan completion or every 30 days) appears superseded; HCAI guidance now allows one invoice per plan per calendar month. Not confirmed in the current Guideline. SECONDARY/UNVERIFIED https://www.ontario.ca/document/ontario-gazette-volume-148-issue-14-april-4-2015/health-claims-auto-insurance-may-2015-guideline

EHB
- Claim windows are plan-specific. Examples from other payers: Green Shield: claims received by June 30 of the year after the expense; Alberta Blue Cross: within 12 months. Neither is an Ontario group plan rule. SECONDARY https://www.ab.bluecross.ca/plan-members/ip-submitting-your-claims.php. No Canada Life / Sun Life / Manulife limit found. UNVERIFIED.

WSIB
- Submit within 6 months of service date; penalties for late: 25 percent reduction at 6 to 9 months (per search summary), 50 percent at 10 to 12 months, 100 percent beyond 12 months; penalties are administrative and not appealable internally or to WSIAT. VERIFIED (excerpt) https://www.wsib.ca/node/2191 . Note: the 6 to 9 and 10 to 12 month bands leave 9 to 10 months unaddressed in the summary; check exact wording.
- Payment timing: 2019 billing instructions say weekly payment cycle, allow 10 calendar days for electronic bills and six weeks for paper. SECONDARY/dated https://www.wsib.ca/sites/default/files/2019-03/billinginstructions_1.pdf . Current figure UNVERIFIED.
- MSK program of care: electronic billing required for treatment blocks and reports; payment withheld until WSIB receives the corresponding reports. VERIFIED (excerpt) https://www.wsib.ca/en/fee-schedule-musculoskeletal-program-care
- WSIB does not pay for missed or cancelled appointments. VERIFIED (excerpt) https://www.wsib.ca/node/2191

### Q4. Reasons for unpaid or short-paid invoices

Sourced:
- MIG cap and its pre-existing-condition exception (above). VERIFIED (excerpt).
- Denial letters lacking medical reasons, and late responses, are litigated issues. VERIFIED (excerpt) tribunal decisions above; also https://www.insurancebusinessmag.com/ca/news/legal-insights/cooperators-wins-mig-defense-but-pays-out-after-botched-denial-letter-576788.aspx (SECONDARY).
- Unlicensed facility cannot be paid directly. VERIFIED (excerpt).
- WSIB: payment held until MSK reports received; late billing penalties; missed appointments unpaid. VERIFIED (excerpt).
- Other listed reasons (rate guideline reductions, IME pending, benefit exhausted, represented claimant, coverage dispute, missing documents): not individually sourced in this pass. See inference table in section 2.

### Q5. Contact patterns and disclosure

- No source found for adjuster direct-line behaviour, voicemail patterns, or hold times in this domain. UNVERIFIED.
- Consent: a custodian disclosing PHI to a non-custodian such as an insurer generally needs express consent. SECONDARY https://www.ipc.on.ca/en/media/1980/download (listed, summarized by search). OCF-1 consent language is standardized across Ontario auto insurers; OCF-5 is a separate permission to disclose health information, limited to accident-related information reasonably required for treatment and eligibility, valid until the claim concludes or consent is withdrawn; it does not cover provider consultation with the insurer's examining professional (needs separate written consent). SECONDARY https://trlaw.com/wp-content/uploads/2015/11/OCF-5-Permission-to-Disclose-Health-Information.pdf (2010 form copy, may be outdated). Billing agent letters: nothing found.

### Q6. Identifiers
- HCAI documents carry a document number; insurer requires paper copy with a valid document number when applicable (unlicensed path). VERIFIED (excerpt) HCAI links above.
- Everything else (claim number, policy, loss date, DOB, invoice number, provider registration/billing number, WSIB claim number) is inference from form structure, not sourced. UNVERIFIED.

### Q7. Reconciliation
- EHB: payments and statements come directly from insurers even when claims are submitted via software; timelines per TELUS Insurer Payment Guide. SECONDARY https://support.clinicsense.com/hc/en-us/articles/41596491205523-TELUS-Health-eClaims-FAQ
- WSIB: online remittance statements show how each bill was processed, amount allowed and explanation; direct deposit available via TELUS provider portal. SECONDARY/VERIFIED mix https://go.telushealth.com/hubfs/wsib/THS2684_WSIB_Start_Up_Guide_EN.pdf
- MVA: payment format (cheque/EFT, batching, remittance) NOT found. UNVERIFIED. A vendor says staff record payment manually.

### Q8. Privacy and call regulation
- CRTC: business-to-business calls are exempt from the National DNCL rules; calls to business numbers are regulated only by the Telemarketing Rules and ADAD Rules; ADAD rules are broader than solicitation. VERIFIED (excerpt) https://crtc.gc.ca/eng/phone/telemarketing/biz.htm and https://crtc.gc.ca/eng/phone/telemarketing/reg.htm (listed; summary via search).
- CRTC Notice 2026-132 is reviewing the Unsolicited Telecommunications Rules; interveners (M3AAWG, MEF) argue the ADAD definition should explicitly cover AI voices; interventions closed July 27, 2026, replies August 11, 2026. VERIFIED (excerpt) https://crtc.gc.ca/eng/archive/2026/2026-132.htm ; SECONDARY https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-crtc-2026-132-comments-july-24-2026.pdf . Outcome not found.
- COULD NOT CONFIRM: whether a non-solicitation, AI-voiced call to an insurer/adjuster/WSIB falls inside the ADAD rules; whether a clinic's billing call is "telemarketing"; PHIPA vs PIPEDA applicability to a vendor acting for a clinic (PHIPA agent rules); whether an adjuster or insurer may disclose claim status to a provider without the claimant's consent. PIPEDA analogy: an OPC finding held an insurer stayed within OCF-1 consent purposes. SECONDARY https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2015/pipeda-2015-003
- PHIPA s.49(1) limits recipients' use/disclosure of PHI received. SECONDARY (search summary of IPC material).

## 2. What I inferred (not directly sourced)

- Phone is likely the real path for: MVA payment trace ("issued? cheque/EFT date, to whom, which invoices"), because HCAI evidence found shows decisions, not payment; reissue of lost/returned cheques; confirming a payee under the licence rules; EHB payment trace after EOB; WSIB when portal status is "pending" without reason or when held for missing reports.
- Phone is rare or unnecessary for: WSIB bills with online status and remittance; EHB real-time adjudicated claims; MVA when HCAI shows an adjudicated decision with reasons.
- Call-resolvable vs needing judgment:
  | Reason | Phone can resolve | Needs staff/legal judgment |
  |---|---|---|
  | Invoice not yet received/logged by insurer | Yes (confirm receipt date, request re-send) | No |
  | Payment issued, not received (trace, reissue) | Yes | No |
  | Missing document request (e.g. OCF-21 attachment, report) | Mostly (learn what is missing) | Obtaining it |
  | Payee/licence mismatch | Confirm status only | Fix licence/payee, claimant routing |
  | Partial approval of OCF-18 | Learn reason and deadline | Decide dispute, resubmit, tribunal |
  | MIG cap reached or contested | Confirm cap status | Pre-existing condition evidence, dispute |
  | IME/assessment pending | Get date/status | Clinical response |
  | Benefit exhausted | Confirm exhaustion and date | Next payer, patient billing |
  | Represented claimant | Learn who to contact | Often must go through counsel |
  | Coverage dispute / denial of claim | Capture position | Legal |
  | Rate guideline reduction | Learn rate applied | Whether to contest |
  | WSIB late-billing penalty | Confirm applied | Not appealable per policy; no call fix |
- Identifiers likely needed: claim/file number, claimant name and DOB, date of loss, insurer and adjuster name, HCAI document number, invoice number and date, amount, provider/facility name and licence or billing number; for WSIB the WSIB claim number and provider billing ID; for EHB the carrier, plan/policy or group number, member ID, date of service, claim reference. Standard industry fields, unsourced.

## 3. Conclusion

### Distinct call objectives
1. Confirm invoice/plan received and its receipt date.
2. Obtain adjudication status and reasons (approved, partial, declined) for an OCF-18 or invoice.
3. Payment trace: issued or not, method, date, payee, which invoices covered.
4. Request reissue or replacement of a lost or stale payment.
5. Identify missing documents and the submission channel/deadline.
6. Confirm payee correctness (facility vs claimant) and licence-related blocks.
7. Learn assessment/IME status and dates.
8. Learn benefit exhaustion/MIG status and next payer.
9. Confirm representation (who to deal with) and escalate.
10. Obtain EHB claim status and payment trace, WSIB bill status and held-payment reason.
11. Capture outcome and deadlines for staff follow-up (including interest-eligible overdue facts).

### Separate or shared workflows?
Recommendation (inference): one shared call engine (identify caller, locate file, ask status/payment/missing-docs/deadline, capture structured outcome) with per-payer parameters. Keep MVA as a distinct parameter pack: it has the strongest phone need, adjuster-level contact, 30-day clock, interest, consent constraints. EHB and WSIB are largely electronic and likely lower call volume, so they can be thin packs (IVR/help-desk navigation plus payment-trace script). Do not build three engines until volume evidence exists.

### Five most important unknowns
1. Whether HCAI or insurers expose payment status to providers, and how often adjusters are the only source of "paid or not." Needs provider interviews.
2. Whether automated/AI-voiced outbound calls to insurers and WSIB fall under CRTC ADAD rules, and the outcome of Notice 2026-132. Needs legal opinion.
3. What an adjuster may disclose to a provider or billing agent without fresh consent (OCF-1/OCF-5 scope, PHIPA agent status of the vendor, billing-agent letters). Needs privacy counsel and insurer practice.
4. Current exact SABS text: deemed approval on missed 10-business-day deadline, current s.51 interest rate, any change effective July 1, 2026 affecting providers, and whether the HCAI form-version rule is by submission date or policy renewal.
5. Current WSIB payment timing and the working provider phone path (help desk number validity), plus real EHB payment timelines per carrier from the TELUS Insurer Payment Guide.

## 4. Source list (all URLs cited above)
- https://fsrao.ca/media/6796/download
- https://collections.ola.org/ser/261677/2015/A03-15.pdf
- https://www.ontario.ca/laws/regulation/100034/v7
- https://virtualassociates.ca/?p=142
- https://www.hcaiinfo.ca/insurers/adjuster-support/form-overview
- https://www.hcaiinfo.ca/insurers/adjuster-support/service-provider-licensing
- https://www.hcaiinfo.ca/health-care-facilities/provider-support/ocf-21b
- https://hcaiinfo.ca/Insurers/News/Bulletins/Invoicing-on-HCAI-Its-not-just-for-licensed-facilities.asp
- https://www.hcaiinfo.ca/insurers/what-s-new/news/hcai-update-release-3-35-june-29-2026
- https://www.hcaiinfo.ca/insurers/what-s-new/news/hcai-2026-the-year-ahead
- https://www.fsrao.ca/industry/auto-insurance/changes-statutory-accident-benefits-coverage-ontario-july-1-2026
- https://www.fsrao.ca/licensing/health-service-provider/about-service-provider-licence-ontario
- https://www.ribo.com/licensee-resources/sabs-changes/
- https://www.belairdirect.com/blog/changes-statutory-accident-benefits-coverage-ontario-july-1-2026
- https://practiceperfectemr.com/blog/hcai-update-july-1-2026/
- https://www.ontario.ca/document/ontario-gazette-volume-148-issue-14-april-4-2015/health-claims-auto-insurance-may-2015-guideline
- https://ztgh.com/wp-content/uploads/2024/04/He-v-Co-operators-General-Insurance-Company-2023-CanLII-50591.pdf
- https://ztgh.com/wp-content/uploads/2022/07/Kyrylenko_v._Aviva_Insurance_Canada_-_Reasons_for_Decision_-_Final_July_14signed.pdf
- https://ztgh.com/wp-content/uploads/2024/04/22-002955-Decision.pdf
- https://neinstein.com/news-blog/legal-news/what-to-do-if-auto-insurance-denies-your-treatment-plan-in-ontario
- https://www.insurancebusinessmag.com/ca/news/legal-insights/cooperators-wins-mig-defense-but-pays-out-after-botched-denial-letter-576788.aspx
- https://www.wsib.ca/node/2191
- https://www.wsib.ca/en/operational-policy-manual/health-care-fees-archived-december-5-2024
- https://www.wsib.ca/en/fee-schedule-musculoskeletal-program-care
- https://www.wsib.ca/sites/default/files/2019-03/billinginstructions_1.pdf
- https://go.telushealth.com/hubfs/wsib/THS2684_WSIB_Start_Up_Guide_EN.pdf
- https://embodiaapp.com/guides/1169-practice-management-on-embodia-part-3-billing-embodia-team/guide/16177-submitting-a-claim
- https://support.clinicsense.com/hc/en-us/articles/41596491205523-TELUS-Health-eClaims-FAQ
- https://blog.embodiaapp.com/guides/1169-practice-management-on-embodia-part-3-billing-embodia-team/guide/20921-connecting-hcai-plans-and-invoices-to-invoices-on-embodia
- https://www.ab.bluecross.ca/plan-members/ip-submitting-your-claims.php
- https://www.ipc.on.ca/en/media/1980/download
- https://trlaw.com/wp-content/uploads/2015/11/OCF-5-Permission-to-Disclose-Health-Information.pdf
- https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2015/pipeda-2015-003
- https://crtc.gc.ca/eng/phone/telemarketing/biz.htm
- https://crtc.gc.ca/eng/phone/telemarketing/reg.htm
- https://crtc.gc.ca/eng/archive/2026/2026-132.htm
- https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-crtc-2026-132-comments-july-24-2026.pdf
