# Property restoration and ALE: feature research (2026-10-13)

## Method limits (read first)
- WebFetch failed on every attempt (getaddrinfo ENOTFOUND for randrmagonline.com, careerplug.com, fsrao.ca). No page was read directly.
- WebSearch returned summarized answers, not raw page text. Quoted strings below are the exact text from those search summaries, which themselves paraphrase or quote the source page. Treat every quote as UNVERIFIED AGAINST THE PAGE. Re-verify before any build decision.
- 10 searches total. Coverage is thin. Most restoration sources found are US. Ontario evidence is minimal.

## 1. What I verified (as far as search excerpts allow)

**1.1 Restoration AR staff chase adjusters by phone, text, email (OPINION, job posts)**
- Restoration 1 (Niles, IL) AR posting, https://restoration-1-careers.careerplug.com/jobs/3494805 (undated). Summary text: "outbound collection calls, texts, and emails to customers, property managers, and insurance adjusters" and "chase claim payments, settlement checks, and mortgage-endorsed drafts through to receipt". US, not Canada.
- ServiceMaster Restore Edmonton, https://servicemaster-restore-canada-careers.careerplug.com/jobs/2915953 (undated). Summary text: "scheduling calendar follow-ups pertaining to outstanding invoices" and "aiding the project manager(s) and accounts receivable department in collections as required". Canadian (Alberta), role is Project Coordinator, so follow-up is a side duty there.
- Another posting (unnamed in summary) per search: "you don't mind making the third or fourth follow-up call". Exact source URL not identified; do not rely on it.
- Paul Davis posting, https://pauldaviscareers.careerplug.com/jobs/3087408: receivables collected "while maintaining positive relationships with clients and insurance adjusters".

**1.2 Invoice format and adjuster reconciliation (SECONDARY, trade press)**
- Restoration & Remediation magazine, https://www.randrmagonline.com/articles/86223-ask-annissa-how-can-i-get-paid-in-full-faster . Summary: invoices built in Xactimate are easier for the adjuster to import "along with pictures and notes". Another R&R piece (2015) says Xactimate is "the most commonly used program by insurance adjusters when scoping out a loss".
- Same R&R source (https://www.randrmagonline.com/articles/85996-...) advises confirming receipt because an invoice may "just sit on someone's desk with a red flag on it", and asking the adjuster about timeline, payee names on the cheque, and where it will be sent. This is the closest evidence for a phone job: confirm receipt, timeline, payees, destination.
- Work started without adjuster agreement can get put "in review" or "pushback" (same series).

**1.3 Payment mechanics (OPINION and SECONDARY)**
- CatAdjuster forum 2007, https://www.catadjuster.org/Forums/tabid/60/aft/1868/Default.aspx : "although many carriers pay restoration firms directly, the policy language generally pays only the insured and mortgagee" (summary wording). OPINION, 2007, likely US.
- R&R, https://www.randrmagonline.com/articles/85700-making-mortgage-companies-work-with-you-and-beating-the-money-out-of-them-if-they-dont : distinguishes assignment of proceeds from a direction to pay; mortgage lenders may hold proceeds. US-focused.
- Generic claims guide (BrokerLink, https://www.brokerlink.ca/amp/blog/can-i-keep-my-homeowners-insurance-claim-cheque-and-make-the-repairs-myself-in-canada , SECONDARY, Canadian): insured "may be asked to sign an assignment of claim that will allow the insurer to pay the contractor directly, but you have no obligation to sign". Establishes direct pay is optional in Canada.
- Depreciation holdback: beancount.io bookkeeping guide, https://beancount.io/blog/2026/07/09/water-damage-restoration-xactimate-insurance-reconciliation-bookkeeping-guide (SECONDARY, 2026-07-09, US): gap between invoiced and paid "may reflect a depreciation holdback you'll collect later, a line item the adjuster cut, or a mistake in your own invoice".

**1.4 Ontario process (SECONDARY)**
- R&R, https://www.randrmagonline.com/articles/91157-an-examination-of-property-claims-settlement-process-in-ontario : contractors "usually engaged through insurer arrangements" and "Most insurance companies establish service level agreements with restoration contractors". Only abstract seen. Contractor works for the insured, not the insurer.
- Crawford Canada managed repair, https://www.crawco.ca/services/managed-repair (PRIMARY vendor page): "With over 550 rigorously vetted contractors across Canada". Shows TPA-managed contractor networks exist in Canada.

**1.5 Software (PRIMARY vendor, brochure and help docs)**
- Verisk XactLink for contractors, https://www.verisk.com/4a23f7/siteassets/media/downloads/property-estimating/xactlink-for-contractors.pdf : native in Xactimate; "shorten the time from estimate to payment by one to two weeks on typical non program jobs" (vendor claim, not independent). Carriers "can request changes but cannot edit your estimate directly".
- XactAnalysis help, https://xactanalysis.helpdocs.io/l/enUS/article/klioir12y9-statuses : "Statuses can be used as filters in Search and the various queues (such as the Estimate Review Queue, Assignment Queue, and Payment Queue)." This is an insurer-side queue. No contractor-facing invoice or payment status confirmed.
- Albi blog, https://albiware.com/blog/streamlined-software-for-enhanced-efficiency-and-improved-communication/ : software helps send documents "so there's no delay in payment". Marketing only; no invoice-status feature quoted.
- JobNimbus, https://support.jobnimbus.com/what-is-xactimate : claim flows from Xactimate through XactAnalysis into JobNimbus.
- What they do NOT do: NO EVIDENCE FOUND either way. I found no vendor page claiming outbound phone follow-up with adjusters. That absence is only weak evidence of a gap, since I read no feature pages in full.

**1.6 Delay data (PRIMARY-derived, via trade press)**
- FSRA 2024 Home Insurance Thematic Review as summarized by Canadian Underwriter, https://canadianunderwriter.ca/2024/07/05/whys-it-taking-longer-to-settle-home-insurance-claims/ : "In 2019, it was 127 days, peaking at 138 days in 2021 and then improving to 123 days in 2022". Self-reported by 20 insurers. This is claim settlement time, not contractor invoice payment time.
- FSRA/Canadian Underwriter, https://canadianunderwriter.ca/2024/06/26/are-home-insurers-properly-overseeing-independent-adjusters-fsra-report/ : about 26% of surveyed insurers had no SLAs with independent adjusters; proof of loss form not used or tracked consistently.
- FSRA: "a catastrophic weather event that impacts many homes in one area can put a strain on available adjusters and contractors" (via newswire summary, https://newswire.ca/news-releases/supporting-the-fair-treatment-of-consumers-in-ontario-823676975.html).

**1.7 Quantified pain (SECONDARY, vendor)**
- Levelset case study, https://www.levelset.com/?p=69463 : Dry Patrol (Ohio) "average DSO was around 90 days" falling to 17 days after using lien-rights tooling. Vendor marketing, US, and the fix was liens, not calls.

**1.8 Outsourced billing exists (OPINION, listings)**
- Upwork listing, https://www.upwork.com/services/product/admin-customer-support-accurate-invoice-tracking-insurance-follow-ups-faster-payments-1887162743625102043 : advertises invoice tracking and insurance follow-ups; Freelancer and OnlineJobs.ph listings similar. Shows the job is outsourced; no price or volume data seen.

**1.9 ALE**
- Square One, https://www.squareone.ca/resource-centres/insurance-basics/additional-living-expenses (SECONDARY): ALE covers costs "over and above" normal; limited to the "period of restoration".
- Canadian Underwriter BC CRT case, https://www.canadianunderwriter.ca/insurance/why-this-insurer-does-not-have-to-pay-additional-living-expenses-for-campground-fees-1004161373/ : insurer can refuse costs it did not approve; "Verify with the adjuster in advance" (summary wording). Shows pre-approval matters.

## 2. What I could not verify
- Any Ontario-specific step-by-step invoicing flow (who submits, how adjuster approves, cheque issue). NO EVIDENCE FOUND beyond 1.4.
- Joint-payee cheque practice in Ontario; Ontario Insurance Act mortgage clause effect on contractor payment. NO EVIDENCE FOUND.
- Contractor-facing invoice or payment status in XactAnalysis, Encircle, DASH, Albi, Xcelerate, DocuSketch. No feature pages read.
- Franchise operator materials (ServiceMaster, Paul Davis, Servpro Canada) on AR process. NO EVIDENCE FOUND.
- Days-to-payment for Ontario contractors. NO EVIDENCE FOUND.
- FSRA or OmbudService (GIO) complaint data specific to contractor payment. NO EVIDENCE FOUND.
- ALE: how hotels or accommodation providers are authorized or paid in Canada (letter of authority, direct bill, TPA), how nights are tracked. NO EVIDENCE FOUND. Only general ALE rules.
- Buyer objections (section 7 of brief): privacy (PIPEDA, call recording consent), insurer relationship, AI disclosure. NO EVIDENCE FOUND in restoration sources; nothing searched specifically.
- Hours spent on phone follow-up, write-off percentages. NO EVIDENCE FOUND.

## 3. Feature candidates

| Feature | Job | Evidence (quote, URL) | Pain evidence | Confidence |
|---|---|---|---|---|
| Invoice receipt confirmation call to adjuster | Confirm adjuster got invoice and has it in review | R&R: invoice may "just sit on someone's desk with a red flag on it", https://www.randrmagonline.com/articles/85996-ask-annissa-what-can-i-do-if-im-having-trouble-getting-paid-by-the-adjuster | Trade advice only | WEAK |
| Payment timeline and payee capture | Get expected pay date, payee names, cheque destination | Same R&R source: ask about "payment timeline, the payee names on the check, and where it will be sent" | Advice, no cost data | WEAK |
| Repeated chase calls on overdue invoices | Third or fourth follow-up call until paid | Restoration 1 posting: "chase claim payments, settlement checks, and mortgage-endorsed drafts through to receipt", https://restoration-1-careers.careerplug.com/jobs/3494805 | Dedicated headcount exists (US); ServiceMaster Edmonton lists follow-ups as one duty | WEAK to STRONG for existence in US, WEAK for Ontario |
| Calendar of follow-ups per invoice | Schedule next touch | ServiceMaster Edmonton: "scheduling calendar follow-ups pertaining to outstanding invoices" | Job exists in Canada | WEAK |
| Joint payee / mortgagee cheque tracking | Track who is on cheque and endorsement status | "mortgage-endorsed drafts" (Restoration 1); R&R mortgage article | US-only; no Ontario | WEAK |
| Holdback / depreciation reconciliation | Ask adjuster why paid less than invoiced | beancount.io: gap "may reflect a depreciation holdback" | Bookkeeping guide only | WEAK |
| Supplement status follow-up | Chase approval of supplement | NO EVIDENCE FOUND (only "in review" / "pushback" mention) | None | NONE |
| Voicemail and callback loop handling | Persist until human answers | Only "third or fourth follow-up call" job post phrase; Restor-AI-tion blog says adjuster "stopped replying" | Anecdote | WEAK |
| Authorization capture for ALE nights | Get adjuster approval for extra nights | CRT case: insurer refused costs not approved | One tribunal case, BC | WEAK |
| ALE invoice/night tracking and chase | Track approved nights, chase payment | NO EVIDENCE FOUND | None | NONE |
| Outsourced AR service model | Sell follow-up as a service | Upwork / Freelancer listings | Demand price unknown | WEAK |

No feature reached STRONG for Ontario.

## 4. Conflicting evidence
- Verisk claims XactLink saves "one to two weeks"; Levelset claims DSO 90 to 17 days via liens. Both vendor claims, different mechanisms, neither independent, and they imply payment speed is driven by documentation and legal leverage as much as by calls.
- Trade press says insurers pay restorers directly in many cases (CatAdjuster, 2007); BrokerLink says assignment is optional and policy pays insured/mortgagee. Direct pay is therefore not a given.
- FSRA settlement time (123 to 138 days) is claim-level, and says nothing on contractor invoice payment, so it cannot be used as proof of contractor AR delay.

## 5. Eight most important remaining unknowns
1. Do Ontario restorers actually get paid by cheque to insured, joint, or direct? Source: Ontario insurer contractor guides (Intact, Aviva, TD, Co-operators vendor pages); R&R article 91157 full text.
2. Do Canadian TPA/managed-repair programs (Crawford Contractor Connection, Cotman, Cunningham Lindsey/Sedgwick) pay by portal with status visible? Source: Crawford Canada contractor onboarding pages, vendor payment terms in contractor agreements.
3. Does XactAnalysis or XactLink show contractor-visible payment status? Source: xactanalysis.helpdocs.io Payment Queue articles and XactLink contractor docs.
4. What do Encircle, Albi, DASH, Xcelerate help centres say on invoice/payment follow-up tasks? Source: their own help-centre pages.
5. Measured days-to-pay and write-off rates for Ontario restorers. Source: CRA (Canadian Restoration Association) or RIA surveys, franchise operator interviews.
6. Hours per week staff spend on adjuster calls. Source: job posts with stated duties split, operator interviews (not allowed in this task; needs founder-led research).
7. ALE: how hotels and accommodation providers are authorized and paid in Ontario (letter of authority, direct bill, TPA such as Crawford/ALE-specialist providers). Source: insurer ALE claim guides, accommodation provider (e.g. corporate housing) billing terms pages.
8. Buyer objections: insurer/adjuster reaction to AI callers, PIPEDA and call-recording consent, restorer reluctance to risk adjuster relationships. Source: CRTC rules, OPC PIPEDA guidance, restorer trade forums/R&R "adjuster relations" pieces (Encircle webinar https://getencircle.com/webinars/navigating-restorer-adjuster-relations).
