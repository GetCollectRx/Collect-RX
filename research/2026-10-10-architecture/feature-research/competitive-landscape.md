# Competitive and Analog Landscape: AI Payer Follow-Up Calling

Date of research: 2026-10-13. Method: WebSearch only.

## READ THIS FIRST: method limits

- **WebFetch failed on every attempt** (`getaddrinfo ENOTFOUND` for www.infinitus.ai, www.superdial.com, superdial.com, www.getprosper.ai, www.ycombinator.com). No vendor page was opened directly.
- Everything below comes from WebSearch result summaries. Text in double quotes is copied from those search-result excerpts. Where I could not obtain an exact excerpt I paraphrase and say so.
- Tags: PRIMARY means the excerpt came from a vendor's own page. SECONDARY means press, aggregator, or analyst. OPINION means forum or social. Because I never opened pages, many "PRIMARY" tags rest on a search engine's description of a vendor page and should be re-verified by a person.
- All vendor performance numbers are UNVERIFIED VENDOR CLAIMS.
- No one was contacted, no demos requested, no sign-ups.
- Existing files in this folder (collision-tow-storage.md, property-restoration.md) were not read or changed.

---

## 1. Vendor table

Legend: Out = makes outbound calls to payers. IVR/Hold = claims IVR navigation and hold waiting. HO = human handoff or fallback.

| Vendor | Target customer | Payer interactions automated | Out | IVR/Hold | HO | Integrations (own claim) | Public pricing | Compliance claims | Geography | Funding or customer evidence | Source and tag |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SuperDial | RCM teams, health systems, dental | Benefits verification, claim status, prior auth | Yes | Yes (voice performance "built to handle both IVR menu navigation and live representative conversations", SECONDARY) | Yes ("trained staff take over when a call needs judgment") | API and webhooks, JSON events, CSV/PDF, EHR/PM write-back | None found. Usage based per completed call; "no public numeric pricing" (SECONDARY directory) | HIPAA, SOC 2 Type II, HITRUST e1, BAA, AES-256, SSO, MFA | US; no Canada evidence | $15M raise (superdial.com blog title "SuperDial raised $15 million"); case study "83% overall success rate in retrieving required claim information across 5,900+ payer calls" (vendor-written); "160,000+ hours saved for customers in 2025" (unverified vendor claim) | https://www.superdial.com/voice-agents (PRIMARY via search); https://sacra.com/c/superdial (SECONDARY) |
| Infinitus | Large health systems, pharma, payors | Claims, prior auth, benefit verification, pharmacy benefit data | Yes | Yes ("can navigate IVR systems and wait on hold until a live payor agent answers the phone", SECONDARY) | Yes ("flag a human for questions outside of its scope") | Not captured | None found | "HIPAA and SOC 2 Type 2 compliant and run on a HITRUST Certified Cloud"; BAA | US | $51.5M Series C led by Andreessen Horowitz, total $102.9M; Memorial Hermann investor (SECONDARY: healthcareittoday.com 2024-11-25, mobihealthnews.com) | https://infinitus.ai/security (PRIMARY via search) |
| Prosper AI | Dental, medical billing, health systems, pharma | Insurance verification, claim status (claims "not adjudicated after 30 days"), denial follow-up, prior auth | Yes | Yes ("navigating phone trees, waiting on hold, and speaking to reps") | Flags "failed or ambiguous calls with a full transcript" | Claims "over 80 EHR and PM systems" (vendor claim) | None found | HIPAA, SOC 2 Type II, BAA (vendor claims) | US | No funding or named customers captured. "<2-hour SLA, 99% accuracy, 50% cost reduction", "15% higher collections" (unverified vendor claims) | https://www.getprosper.ai/who-we-serve/dental (PRIMARY via search) |
| Toothy AI (YC W25) | Dental clinics | Verification (calls and portals), claim creation and submission, denial correction, payment posting | Yes | Not stated | Not stated | Writes into the practice's PMS (no list captured) | None found | None found | US | YC W25, about 15 employees. "early customers cutting their back office teams by 50-75%"; one customer "collection ratio from 50.8% to 97.2%" (unverified vendor claims) | https://www.ycombinator.com/companies/toothy-ai (PRIMARY via search) |
| LunaBill (YC F25, also "Ooq" slug) | Healthcare billing teams | Claim status, appeals follow-up, A/R recovery | Yes | Yes ("Auto IVR navigation") | Not stated | Excel/CSV upload; aggregator claims EHR integration | None found | "HIPAA-certified" appears only on an aggregator; not verified | US | Seed from YC and Pioneer Fund (Preqin, 2025-11-18). Call counts conflict: "60,000+" (YC launch) vs "50,000+" (YC profile) | https://www.ycombinator.com/launches/Ooq-lunabill-ai-voice-callers-for-healthcare-billing-teams |
| HoldFree AI | Small and mid-sized dental and medical practices | Stuck claims, denials | Yes | Yes (dials Delta Dental, MetLife, BCBS, Aetna; works through phone trees and hold queues) | Yes (escalates complex clinical denials to a lead biller) | Not captured | None found | Not captured | US payers named | None found | https://www.holdfree.health/ (excerpt via search; page not opened) |
| InsideDial (InsideDesk) | Dental service organizations | Payer AR follow-up: claim status, denial reasons, payment details | Yes | Via SuperDial | Via SuperDial | Payer portals and practice management systems | None found | HIPAA and SOC 2 belong to SuperDial; InsideDesk's own statement not found | Toronto or Mississauga, Ontario HQ (sources disagree); customers described are US | $12.6M USD growth round led by Pender Ventures (BetaKit); "a large DSO servicing 450 practices across 18 states"; InsideDial "powered by SuperDial" (EIN Presswire, 2024) | https://www.einpresswire.com/article/719415999/insidedesk-introduces-insidedial-revolutionizing-payor-call-automation-in-revenue-cycle-management |
| Stratus AI | Dental practices, solo to DSO | Eligibility and benefit breakdowns by calling payers; claim follow-up on one listing | Yes | Not stated | Human reviews each report (SECONDARY) | PMS integration discussed, no list | None found | None found | US | G2: six reviews averaging 5.0 (SECONDARY, small sample) | https://dentalemr.com/integrations/stratus-ai |
| DentalRobot | Dental practices | Verification plus payer calls | Reported | Not stated | Not stated | "more than 12 dental PMS platforms" (search description) | Third party estimate "$150-$250 per location per month" (SECONDARY, unconfirmed) | None found | US | None found | https://www.dentalrobot.ai/ (not opened) |
| Parakeet Health | Provider call centers | Insurance verification, claims, prior auth (older coverage); now mostly patient facing | Reported | Not stated | Not stated | EHR and PM | None found | None found | US | $10M Series A (hlth.com, 2026-10-05), $13M total | https://hlth.com/insights/news/parakeet-health-raises-10m-to-expand-ai-powered-patient-engagement |
| Ventus AI (analog, portal not phone) | Dental DSOs | Claim status via browser agent | No | n/a | Staff handle exceptions | Payer portals | None found | None found | US | "Smilist ... over 3,000 claim status checks per day" (vendor-written) | https://www.ventus.ai/blog/dental-claims-review-automation-2026-guide/ |
| Keragon (workflow, not caller) | Dental | Insurance agent routes claim and remittance status | No | n/a | Staff confirm | Where tools support it | None found | "HIPAA-compliant" in page title | US | None found | https://www.keragon.com/dental |

### Adjacent verticals (auto body, restoration, towing, pharmacy, DME)

- **Auto body / collision:** NO EVIDENCE FOUND of any product that phones insurers or adjusters on behalf of a repair shop. Found only an inbound "AI Receptionist for Body Shops" blog (https://ainora.lt/blog/ai-receptionist-for-body-shops-collision-repair, vendor blog) and carrier-side deployments: Travelers "fully agentic intelligent voice service uses advanced language and speech recognition technologies to handle customer claim calls" (SECONDARY, clickclaims.com 2026-02-18), and Quálitas on SoundHound (Mexico). These face policyholders, not shops.
- **Property restoration:** NO EVIDENCE FOUND of a voice agent calling adjusters for contractors. Closest is a restoration newsletter on AI-drafted follow-up emails (https://restoraition.beehiiv.com/p/this-ai-draft-got-us-paid-faster-110c, OPINION).
- **Towing:** NO EVIDENCE FOUND.
- **Pharmacy:** Infinitus ("collect detailed benefits data from medical payors and pharmacy benefit managers", vendor claim, https://infinitus.ai/solutions/payors) and Prosper pharma page ("check if Auth is requited, initiate it and check the status") cover pharmacy and pharma. No pharmacy-to-PBM claim-rejection caller found.
- **DME:** NO EVIDENCE FOUND.

---

## 2. Feature matrix

"Y" means a search excerpt tied the feature to that vendor. Blank means not found in what I could see (not proof of absence). Because pages were not opened, blanks are weak negatives.

| Feature | SuperDial | Infinitus | Prosper | Toothy | LunaBill | HoldFree | InsideDial | Stratus | DentalRobot |
|---|---|---|---|---|---|---|---|---|---|
| Outbound payer calls | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| IVR navigation and hold waiting | Y | Y | Y | | Y | Y | Y (SuperDial) | | |
| Human handoff or review | Y | Y | Y (flags) | | | Y | Y (SuperDial) | Y | |
| Call recording | Y | | | | | | | | |
| Transcripts | Y | | Y | | | | | | |
| Outcome tagging / structured results | Y | Y | Y | Y | Y | | Y | Y | |
| Queue / worklist / batch upload | Y (CSV) | | | | Y (CSV) | | | | |
| Retry logic | Y | | | | Y (schedules next call) | | | | |
| Payer-specific playbooks | Y ("client-specific policies") | | | | | | | | |
| Staff alerts | | | | | | | | | |
| Reporting / dashboards | Y | | | | | | Y (AR reporting) | | |
| Analytics | Y (QA views) | | | | | | | | |
| White-label | | | | | | | Y (reseller of SuperDial, weak) | | |
| API / webhooks | Y | | | | | | | | |
| PMS / EHR integration | Y | | Y | Y | Y (agg.) | | Y | Y | Y |
| Audit trails | Y (blog: "call audit trails") | Y (guardrails) | | | | | | | |
| Consent handling | | | | | | | | | |
| AI-disclosure configuration | Y ("disclosure language") | | | | | | | | |
| HIPAA / BAA | Y | Y | Y | | agg. only | | via SuperDial | | |
| SOC 2 Type II | Y | Y | Y | | | | via SuperDial | | |

Key matrix excerpts:
- SuperDial voice agents page (PRIMARY via search): "teams can define question blocks, call flows, escalation rules, disclosure language, voice options, retry logic, and client-specific policies"; "record, transcribe, and summarize every interaction"; "searchable UI with call recordings, transcripts, results, dashboards, and QA views".
- LunaBill (SECONDARY): "can schedule the next call".

---

## 3. Disclosure of AI nature, recording, consent, privacy

| Vendor | What I found | Status |
|---|---|---|
| SuperDial | Disclosure wording is customer configurable ("disclosure language"). Default not found. Recordings and transcripts are retained and viewable. | No policy text found |
| Infinitus | No disclosure or recording-consent policy found. Case study says a payer "had been receiving calls from something called Eva ... Not a bot, but instead a voice AI agent" (vendor-written). A 2019 feature article described the agent introducing itself as Eva calling on behalf of a client (SECONDARY). | NO EVIDENCE FOUND of a stated per-call disclosure policy |
| Prosper | "zero-day retention agreement with its AI partners"; recordings and transcripts "can be deleted after extraction"; backups kept 30 days. The two statements were flagged as not obviously consistent. Security links point to an integrations page, not a dedicated trust page. | Retention policy unclear |
| Toothy, LunaBill, HoldFree, Stratus, DentalRobot | NO EVIDENCE FOUND. | None |
| InsideDesk | HIPAA and SOC 2 shown only for SuperDial. | None for InsideDesk |

Vendor-curated payer reaction: one testimonial page quotes an Aetna rep calling the AI "very intuitive" even though it is artificial (vendor-curated, unverified).

### Legal context (SECONDARY, law-firm and advocacy sources; primary statutes not read)

- US: FCC Declaratory Ruling, 2024-02-08, treats AI-generated voices as "artificial" under the TCPA. Mayer Brown: "does not present new rules" but clarifies the existing TCPA applies. Callers "must obtain prior express consent ... unless an applicable exemption applies." (https://www.mayerbrown.com/en/insights/publications/2024/02/fcc-declares-authority-and-intent-to-regulate-ai-generated-calls-under-the-tcpa). Whether the TCPA reaches B2B payer calls was not established.
- Canada, CRTC: Notice of Consultation 2026-132 is reviewing the Unsolicited Telecommunications Rules. M3AAWG (industry group) filed comments 2026-07-24 recommending a technology neutral ADAD definition covering AI voice and "disclosure at the start of automated calls" (paraphrase of search summary; https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-crtc-2026-132-comments-july-24-2026.pdf). In 2014 the CRTC refused to let ADAD calls reach people with an existing business relationship (https://crtc.gc.ca/eng/archive/2014/2014-155.htm). Whether the rules apply to B2B payer calls: NO EVIDENCE FOUND.
- Canada, recording: summaries of Criminal Code s.184 describe one-party consent (a participant may record) (kruselaw.ca, plaud.ai, law-firm blogs, SECONDARY). PIPEDA and Quebec Law 25 add notice and meaningful-consent duties for businesses (lethub.co, SECONDARY). No OPC guidance on AI call transcription found. Primary texts not read.

---

## 4. Buyer and payer reactions

- **Independent reviews:** NO EVIDENCE FOUND for SuperDial on G2, Capterra, Trustpilot (G2 page was a discussion page with a description only). Only independent-style rating: Stratus on G2, six reviews averaging 5.0 (https://www.g2.com/products/stratus-ai/reviews, small sample).
- **Reddit / forums:** search found NO EVIDENCE FOUND of dentist forum threads about AI payer calls.
- **Case studies (all vendor-written):** SuperDial "83% overall success rate ... across 5,900+ payer calls" (https://www.superdial.com/case-studies/united-medical-monitoring-case-study); Ventus/Smilist 3,000 checks per day; Toothy 50.8% to 97.2% collection ratio.
- **Payer pushback, vendor sources only:**
  - Infinitus (https://www.infinitus.ai/blog/payors-are-blocking-ai-agent-calls-what-does-that-mean-for-infinitus/, PRIMARY, date not shown in excerpt): "some AI agent calls to payors can drag on … and on .. and on. And when dozens of ill-equipped AI agents are calling payor call centers, their phone lines get clogged." Infinitus states payors are not blocking its calls.
  - SuperDial blog "Why are insurance payors starting to reject AI agent calls" (https://www.superdial.com/blog/why-are-insurance-payors-starting-to-reject-ai-agent-calls, PRIMARY): search summary says "a number of plans have started pushing back on certain AI-generated calls, mainly when agents can't handle benefit rules, get lost in phone menus, or drag out calls" (paraphrase, not verbatim). SuperDial says payors continue to accept its calls.
  - No named payer, payer policy statement, or independent reporting on blocking found: NO EVIDENCE FOUND.
- **Regulator or association statements about AI calling payers:** NO EVIDENCE FOUND (US or Canada). CDA, Ontario Dental Association, provincial regulators not located.
- **Insurer-side AI risk (Canada, anecdotal):** Oral Health Group article says dentists face more insurer audits, partly linked to AI analytics (https://www.oralhealthgroup.com/dental-governance-regulations/dentist-insurance-audits-canada-1003997010/, SECONDARY).

---

## 5. Canadian coverage

- **Any product serving Sun Life, Manulife, Canada Life, Green Shield, TELUS Health, RBC, auto insurers, or WSIB by phone:** NO EVIDENCE FOUND. Searches on each returned no AI payer-caller.
- **InsideDesk** is Ontario headquartered (BetaKit: "InsideDesk closes $12.6 million USD", https://betakit.com/insidedesk-closes-12-6-million-usd-to-grow-its-dental-payments-platform/). Its customers and payers in coverage are US. NO EVIDENCE FOUND of Canadian insurer coverage. This is the only Canadian-HQ analog found, and it is the one to study.
- **Sun Life** offers Alexa-based claim status for members: "check the status of a recently submitted medical or dental claim" (https://www.sunlife.com/en/newsroom/news-releases/announcement/alexa-ask-sun-life-what-my-physiotherapist-coverage-is/123324/, PRIMARY). This is an insurer channel for members, not a provider-side caller.
- **Manulife** (https://www.manulife.ca/personal/insurance/our-products/health-insurance/health-and-dental/guaranteed-issue-enhanced-insurance.html): "Log in to SecureServe ... Status of submitted claims" and "If your form is complete and accurate, you will generally receive payment within six business days" (PRIMARY, member side).
- **CDAnet / TELUS eClaims:** electronic claim submission and, per Jane's listing, eligibility checks (https://integrations.jane.app/integrations/telus-eclaims). CDAnet "has become an indispensable part of the everyday workflow" (CDA, SECONDARY). These are the electronic substitutes for phone work in Canada.
- **Green Shield:** Trustpilot reviews describe slow claim handling (OPINION, not read in detail).

---

## 6. Substitutes

| Substitute | What it does | Price (as found) | Source and tag |
|---|---|---|---|
| Outsourced dental billing (US) | Claim submission, AR follow-up, denials, posting. Often excludes eligibility checks and patient collections | "percentage of collections (4% to 10%), per-claim pricing ($4 to $12 per claim), or a flat monthly fee"; dentalbilling.com "$1,400 per month for offices collecting under $40,000 a month", then 3.5% and 3.0% tiers (USD) | https://dentalbilling.com/pricing-dental-insurance-billing/ (PRIMARY via search); https://www.lassie.ai/blog/outsourcing-dental-billing-mistakes (SECONDARY, software vendor) |
| Offshore (Philippines) dental insurance VAs | Verification, claim follow-up, appeals | Posted wages "$5 to $6 per hour" (verification) and "$6 to $7 per hour" (AR); not agency bill rates | Winning Assistants job postings, e.g. https://apply.workable.com/winning-assistants/jobs/view/F8F05457E9.md (PRIMARY, wage not price) |
| In-house biller, Ontario | Staff time | Roughly $19 to $25 per hour in listings (one outlier listing at $4 CAD) | https://ca.indeed.com/Medical-Billing-jobs-in-Ontario (SECONDARY) |
| Canadian outsourced billing price list | | NO EVIDENCE FOUND | |
| Electronic eligibility (270/271 and CDAnet) | Real-time eligibility, predeterminations | Included in PMS; "miss details like remaining maximums and frequency limits" (SECONDARY, foji.io) | https://www.foji.io/blog/ai-insurance-verification-for-dental-offices----how-it-works-and-what-to-look-for-fojiai |
| AI vendors' price | Per completed call (SuperDial); DentalRobot "$150-$250 per location per month" (third party) | See vendor table | |

---

## 7. Feature candidates

Confidence: STRONG = three or more independent vendors or a primary requirement. WEAK = one or two. NONE = no vendor.
"Independent vendors" excludes InsideDial (reseller of SuperDial). Counts come from search excerpts only.

### Table stakes (STRONG)

| Feature | Vendors offering | Evidence | Confidence |
|---|---|---|---|
| Outbound calls to payers with IVR navigation and hold waiting | SuperDial, Infinitus, Prosper, LunaBill, HoldFree (5) | Infinitus: "navigate IVR systems and wait on hold"; Prosper: "waiting on hold, and speaking to reps" | STRONG |
| Structured outcome capture (claim status, denial reason, claim number) | SuperDial, Infinitus, Prosper, LunaBill, Stratus (5) | LunaBill: "claim numbers and denial reasons" | STRONG |
| Human fallback or escalation for edge cases | SuperDial, Infinitus, Prosper, HoldFree, Stratus (5) | HoldFree: "escalates complex clinical denials to a lead biller" | STRONG |
| Write-back to PMS or EHR | SuperDial, Prosper, Toothy, Stratus, DentalRobot, LunaBill (6, some aggregator-sourced) | Prosper: "writes that information directly back into your ... Practice Management (PM) system" | STRONG |
| HIPAA BAA and SOC 2 Type II | SuperDial, Infinitus, Prosper (3, all vendor claims) | Infinitus: "HIPAA and SOC 2 Type 2 compliant" | STRONG (buyer expectation in US; Canadian equivalent unproven) |

### Differentiators (WEAK)

| Feature | Vendors | Evidence | Confidence |
|---|---|---|---|
| Recordings and transcripts viewable by customer | SuperDial, Prosper (2) | SuperDial: "call recordings, transcripts, results, dashboards, and QA views" | WEAK |
| Retry or scheduled next call | SuperDial, LunaBill (2) | "can schedule the next call" | WEAK |
| Batch upload of claims (CSV) | SuperDial, LunaBill (2) | "Excel or CSV format" | WEAK |
| Claim-age trigger for calls | Prosper (1) | "claims not adjudicated after 30 days" | WEAK |
| Configurable disclosure language and escalation rules per client | SuperDial (1) | "disclosure language ... escalation rules ... client-specific policies" | WEAK |
| Call audit trail | SuperDial (blog), Infinitus guardrails (2) | "call audit trails" (summary wording) | WEAK |
| Dashboards and QA views | SuperDial (1) | quote above | WEAK |
| Per-minute or per-call public pricing | SuperDial usage based but no numbers (1) | directory: "no public numeric pricing" | WEAK |
| Reseller or white-label | InsideDesk uses SuperDial (1 relationship) | EIN Presswire: "powered by SuperDial" | WEAK |
| Pharmacy and prior auth calling | Infinitus, Prosper (2) | see section 1 | WEAK |

### Features no one was found offering (gap or trap)

| Feature | Evidence status | Why it might be a gap | Why it might be a trap |
|---|---|---|---|
| Canadian carrier coverage (Sun Life, Manulife, Canada Life, Green Shield, TELUS, RBC) by phone | NONE: no vendor found | Open market in Canada | May be absent because Canadian carriers handle claim status through portals and CDAnet, so demand is unproven; also no evidence carriers accept automated calls |
| Payer-specific playbooks as a customer-visible feature | Only "client-specific policies" (SuperDial) | Could compound with call data | Not evidenced as a purchase driver |
| Staff alerts on handoff or outcome | NONE | Operational need | Unknown whether buyers ask for it |
| Consent handling for recording, with Canadian notice | NONE | Compliance differentiator in Canada | No buyer demand evidence |
| Published payer-acceptance data (block rate) | NONE independent | Trust signal given pushback narrative | Hard to measure; vendors only offer assertions |
| Auto body, restoration, towing payer calling | NONE | Unserved verticals | No evidence of demand or of adjuster acceptance of AI callers |
| Public per-claim pricing | NONE with numbers | Easy to beat opaque quotes | Price anchors from outsourcing (percent of collections) may undercut |
| Reviews from independent buyers | NONE for the leader | Everyone relies on vendor case studies | Market may be too young for reviews |

---

## 8. What I could not verify

- Every vendor page: WebFetch failed for all hosts. Product, pricing, compliance, and integration claims are from search summaries.
- Whether any vendor discloses AI nature on payer calls by default. Only SuperDial's configurable "disclosure language" was seen.
- Existence of payer blocking beyond two vendor blog posts. SuperDial's blog text was paraphrased by the search tool, not copied verbatim.
- HoldFree AI details beyond a search description. Its pricing and compliance searches returned nothing about it.
- DentalRobot capabilities, which were seen only via third-party blogs; DentalRobot pricing is a third-party estimate.
- LunaBill HIPAA claim (aggregator only), and its funding amount (sources conflict).
- InsideDesk HQ city (Mississauga vs Toronto, sources disagree).
- Primary texts of the TCPA ruling, CRTC rules, Criminal Code s.184, PIPEDA. Legal points are from secondary summaries and are not legal advice.
- Adjacent verticals (auto, restoration, towing, DME): search found nothing relevant, not proof none exist.
- Reddit and forum sentiment: searches returned none.

---

## 9. Eight remaining unknowns and the page that would answer each

1. Does SuperDial's agent state it is an AI by default, and can disclosure be turned off? Page: https://www.superdial.com/voice-agents and SuperDial's security or trust page, plus a sample call recording on the HBMA listing (https://www.hbma.org/product-detail.php?id=975).
2. Do payers have written policies against automated calls? Page: Infinitus post full text at https://www.infinitus.ai/blog/payors-are-blocking-ai-agent-calls-what-does-that-mean-for-infinitus/ and SuperDial's full post at https://www.superdial.com/blog/why-are-insurance-payors-starting-to-reject-ai-agent-calls (both to read in full, with dates). Canadian carriers' provider-facing terms would be on each carrier's provider portal.
3. Do the CRTC UTRs cover a business calling an insurer's provider line with an AI voice? Page: CRTC Notice of Consultation 2026-132 on https://crtc.gc.ca and Telecom Regulatory Policy 2014-155 (https://crtc.gc.ca/eng/archive/2014/2014-155.htm).
4. Does PIPEDA "meaningful consent" require disclosing AI processing or recording on outbound B2B calls? Page: Office of the Privacy Commissioner guidance on consent and on AI (priv.gc.ca), plus Criminal Code s.184 text on laws-lois.justice.gc.ca.
5. Is InsideDesk offering InsideDial to Canadian dental practices, and for which Canadian carriers? Page: https://www.insidedesk.com/insidedial and its product FAQ.
6. What does SuperDial charge per call? Page: https://www.superdial.com/platform (pricing section) or a published rate card, if any.
7. Do Sun Life, Manulife, Canada Life, Green Shield, and TELUS Health route provider claim-status calls to IVR, portal, or CDAnet only? Page: each carrier's provider or dentist resource page (for Manulife, the SecureServe provider documentation; for Sun Life, its provider portal) and the CDA CDAnet specification pages at https://www.cda-adc.ca.
8. How do real buyers rate AI payer callers? Page: G2 listings https://www.g2.com/products/stratus-ai/reviews and https://www.g2.com/products/superdial/discuss, plus HBMA product detail https://www.hbma.org/product-detail.php?id=975 for member reviews.
