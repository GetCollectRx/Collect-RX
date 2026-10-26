# Buyer requirements and staff workflow patterns (research date 2026-10-13)

## Method limits (read first)

- WebFetch failed on every attempt (ontario.ca, priv.gc.ca, ipc.on.ca, thedentalapp.com, planetdds.com). Error: `getaddrinfo ENOTFOUND <host>`. An attempt to check proxy status from the shell was denied by the permission classifier, so I did not work around it.
- All evidence below therefore comes from WebSearch result text only. The search tool returns a paraphrased summary with a few embedded excerpts. Where I put quotation marks, the words appeared in that returned text as an excerpt. I did not read any page in full, so every URL is "seen in search results, page not opened".
- Source tags: PRIMARY / SECONDARY / OPINION. Dates are given only where the search text showed one.
- Quoted source text that contained en dashes has been rewritten with "to" in ranges (only change made).

## 1. What I verified (with quotes)

### Q1 Vendor due diligence and privacy

V1. PHIPA s.10(4) and O. Reg. 329/04 s.6 govern electronic service providers (ESPs). [SECONDARY, summary of IPC 2007 review, URL: https://ipc.on.ca/en/media/2654/download, publisher IPC Ontario, date not shown]. Excerpt: "Under Ontario Reg. 329/04, s. 6(1) the electronic service provider must not use any PHI to which it has access in the course of providing the services for the HIC except as necessary." The excerpt is from a compliance vendor page (https://compliancy-group.com/what-is-an-electronic-service-provider-phipa/, OPINION/SECONDARY).

V2. Written agreement and breach notice duties are described inconsistently. HINP-only per one source: "notify the custodian at the first reasonable opportunity of any breaches and enter into a written agreement with the custodian that describes the services that the HINP is required to provide." Another says "a custodian must have a written agreement with any ESP that handles PHI." Sources: https://www.ipc.on.ca/media/3454/download (IPC, PRIMARY, not opened) and compliancy-group.com (SECONDARY). Unresolved, see Conflicts.

V3. OPC draft guidance on assessing third-party service providers, open for comment until December 4, 2026. URL: https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_third-party_202609/ [PRIMARY, Office of the Privacy Commissioner of Canada]. Only the search summary was seen, no exact quote beyond the title and date. It treats vendor privacy assessment as a due diligence step.

V4. Ontario AI scribe procurement requirements (reported, unconfirmed). Source: https://opsmed.ca/resources/phipa-compliance-guide/ and related opsmed.ca pages [SECONDARY/OPINION]. Excerpt: "Established April 27, 2025 through Supply Ontario (Tender-20123), it pre-qualified 18 vendors." Same source says qualification needed SOC 2 Type II, ISO 27001, or HITRUST r2 and Canadian data storage. Not confirmed against the tender.

V5. Data residency: "PHIPA does not contain an explicit prohibition on storing PHI outside Canada, but the practical compliance landscape creates strong de facto data residency requirements." [OPINION/SECONDARY, opsmed.ca]. Same source: Ontario Health Virtual Visit Standard requires virtual visit data on systems located in Canada.

V6. Contract terms commonly requested: "scope of permitted PHI use, security requirements, breach notification procedures with timelines, Canadian data residency guarantees, audit rights, data return and destruction upon termination, subcontractor restrictions." [OPINION, opsmed.ca]. Red flag named: self-attested "ISO-aligned" claim with no accredited certificate.

V7. Vendor example of a Canadian privacy addendum: Curve Dental Canada Privacy Addendum, https://www.curvedental.com/canadian-privacy-addendum [vendor doc, PRIMARY as to what that vendor offers]. Only the title was seen. Clause text NOT read.

V8. Regulator and association guidance on billing agents. Canadian Dental Association: it "becomes the responsibility of the dentist and other dental health care providers to protect the confidentiality and privacy of their patients." URL: https://www.cda-adc.ca/_files/position_statements/personalDataInformation.pdf [PRIMARY, CDA, date not shown]. Alberta guidance: "a written agreement that is compliant with the Health Information Act must be completed" (information manager), https://www.acdh.ca/public/download/files/237141 [PRIMARY, Alberta College of Dental Hygienists].

V9. College of Physiotherapists of Ontario (CPO) Fees and Billing standard: registrants must "periodically monitor invoices and billing practices to ensure accuracy" and have a "written process of routinely reviewing the accuracy of their fees, billings, and accounts" (search text, paraphrase mixed with quotes). URL: https://collegept.org/standard/funding-fees-and-billing-standard/resources/ [PRIMARY]. Also a CPO blog: a physiotherapist is responsible for any fee, billing, or account that uses their name and registration number. Case: Spirou v. College of Physiotherapists of Ontario, 2024 ONSC 964 (https://www.lawtimesnews.com/practice-areas/medical-malpractice/ontario-superior-court-upholds-the-college-of-physiotherapistss-authority-over-billing-inaccuracies/383982 [SECONDARY]). Implication: delegating to a vendor does not remove the clinician's oversight duty. This is my inference, the sources do not say "vendor".

### Q2 Automated caller

V10. CRTC: calls to business numbers. Excerpt: "calls to business numbers are only covered under the Telemarketing Rules and ADAD rules as these calls are exempt from the National DNCL Rules." URL: https://crtc.gc.ca/eng/phone/telemarketing/biz.htm [PRIMARY, CRTC]. Another excerpt: "the use of an ADAD in initiating telemarketing telecommunications is prohibited, unless express consent has been obtained from the consumer." Note this is about telemarketing calls. Calls from a practice to an insurer about an existing claim are not clearly telemarketing. Whether ADAD rules apply to AR follow-up calls: NOT VERIFIED.

V11. ADAD definition covers synthesized voice: "convey a prerecorded or synthesized voice message" [PRIMARY, https://crtc.gc.ca/eng/archive/1985/DT85-2.htm, archived 1985 decision]. Whether it reaches modern conversational AI: NO EVIDENCE FOUND.

V12. CRTC rules under review: a 2026 intervention says the framework "has not undergone substantive revision since 2014" (paraphrased by search tool). URL: https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-crtc-2026-132-comments-july-24-2026.pdf [SECONDARY, intervenor M3AAWG, 2026-07-24]. Exact CRTC notice number "2026-132" is inferred from the filename only.

V13. IPC Ontario, January 2026, "AI Scribes: Key Considerations for the Health Sector". Seen only via secondary summaries (https://canada-insights.bakermckenzie.com/2026/03/20/ontario-ai-scribe-guidance-signals-emerging-regulatory-baseline/, https://www.blg.com/en/insights/2026/02/what-health-organizations-need-to-know-about-the-new-ai-scribe-guidelines, both SECONDARY law firm). Reported content: patients must be told the encounter is recorded using AI, what information is collected, vendor involvement, risks and benefits; express consent recorded in the health record is best practice; delete recordings after a human-validated summary is stored. This concerns clinical encounters, NOT calls to insurers. Applicability to AR calls: NO EVIDENCE FOUND.

V14. Call recording in Canada: "Canada is a one-party-consent jurisdiction ... callers told at the start that they're speaking with a recorded system." [OPINION, https://agentiavocal.ca/en/blog/agent-vocal-ia-protection-donnees-loi-25-quebec-2026, vendor blog summarizing OPC]. Not verified against OPC.

### Q3 Multi-location

V15. Denticon materials (vendor claim, via search summary): detailed audit trail "of all user activity, which covers who accessed what, when, and from where". Another vendor review: "Granular permissions that isolate corporate, provider, and front-desk data visibility by individual location." URL set: https://www.dentrixenterprise.com/products/multi-location/features, https://www.thedentalapp.com/stories/dso-software [vendor, PRIMARY as vendor claim].

V16. SSO: only mention is a US HIPAA checklist "centralizing identity with SSO where possible", with MFA and same-day deprovisioning. https://www.accountablehq.com/post/hipaa-audit-readiness-checklist-for-your-dental-dso-network [OPINION, US HIPAA, not Canadian]. No source on SAML, OIDC, SCIM, log retention. Centralized authorization letters: NO EVIDENCE FOUND.

V17. Canadian collision: Nexsyis expanded to Canada, first Canadian go-live Lift Auto Group, a Vancouver MSO (2017). https://www.fenderbender.com/news/article/55047943/nexsyis-collision-management-systems-expands-to-canadian-market [SECONDARY, trade press]. Nothing on collision AR follow-up requirements: NO EVIDENCE FOUND.

### Q4 Staff workflow patterns (independent product counts are limited to products named in the search results; none of these are exhaustive)

- Work queues / prioritized worklists: Datarovers (https://datarovers.com/providers/), Encoda (https://encoda.com/denial-management-solutions-control-center/), OSP Labs (https://www.osplabs.com/medical-billing-solutions/denial-appeal-management-software/). Excerpt: "Configurable work queues; Exception-based prioritization; Role-based task assignment". Count: 3 vendor pages (SECONDARY, vendor marketing). Same excerpt covers assignment.
- Owner and next-action date: avenuebillingservices.com, "every item has an owner, a next action date, and a measurable status" (paraphrase). Count: 1 (OPINION).
- Notes, escalation, deadline alerts: described as "core case-management features" in vendor summaries. Count: about 2 pages, no help centre docs seen.
- Aging buckets: one vendor dashboard "31 to 60, 61 to 90, and 90+ days" tiers by 837 submission date. Count: 1.
- Promise-to-pay tracking: HighRadius ("Promise-to-Pay Tracking: Tracks customer commitments and promised payment dates"), Salesforce ("customizable promise-to-pay widgets which facilitate tracking, reminders, alerts, and escalations"), G2 roundup ("posting promises to pay"). Count: 2 products plus 1 review roundup.
- Dispute workflow: HighRadius ("Trigger dispute workflows or log promises to pay"), Upflow ("Finance can tag sales when a customer raises a billing dispute."). Count: 2.
- Callback scheduling: ProspectBoss (dialer), AR Workflow ("set call reminders, and keep call history tied to the account"). Count: 2.
- Templates and bulk actions: AR Workflow ("email templates, scheduled outbound emails, bulk emailing"), G2 ("sending statements in bulk or individually"). Count: 2. Document request tracking: NO EVIDENCE FOUND.
All Q4 sources are vendor marketing or roundups (SECONDARY/OPINION). No help-centre pages were located.

### Q5 Call review

V18. QA / summaries vendors: Hamming (https://hamming.ai/resources/7-non-negotiables-voice-agent-quality-assurance-software), Coval (https://www.coval.ai/blog/call-center-qa-software/), Fini (https://www.usefini.com/guides/ai-voice-agents-call-qa-coaching-insights), Bland (https://www.bland.ai/blog/voice-ai-platform-with-conversation-analytics-and-qa-scoring), JustCall, Vonage. Excerpts: "Confirm the platform can auto-score 100% of calls against custom rubrics ... and explain each score with the exact transcript moment that triggered it."; "A summary that hallucinates a commitment the agent never made will poison your QA data."; Coval describes "Configurable dashboards" with "Multiple views for different stakeholders (supervisors, directors, compliance teams)" (dash between the two phrases in the source omitted). Count: 5 vendors for summary/transcript/QA scoring, 2 for outcome tagging ("requested human agent", "successful resolution"). All OPINION/vendor claims.

### Q6 Onboarding

V19. Generic CSV import pattern (not RCM specific): file, map, validate, submit; "allow saved mappings"; retry or skip bad rows. Sources: CSVBox, Dromo blogs (https://dromo.io/blog/5-best-practices-to-streamline-your-csv-import-process). Vendor claim: in-house import development "4 to 6 months of engineering work" (vendor claim, unverified). RCM-specific go-live benchmarks, sandbox expectations: NO EVIDENCE FOUND.

### Q7 Pricing

V20. AI voice platforms (vendor claims, third-party comparisons): Retell "starts at $0.07 per minute with no platform fee" (https://www.retellai.com/blog/vapi-vs-bland, vendor); Vapi $0.05 per minute hosting plus STT/LLM/TTS billed separately, real cost reported $0.13 to $0.31 (justcall.io, techsy.io comparisons, OPINION); Bland $0.14/min Start, $0.12 Build ($299/mo), $0.11 Scale ($499/mo).
V21. Dental AI follow-up vendors: HoldFree AI "free 10-claim pilot" (https://www.holdfree.health/); Lassie "$3,000 per-location setup fee"; eAssist "$1,400/mo base, tiered 3.5% to 2.5%, $399 one-time setup"; market guide "~$225 to $825/mo, or a percentage of collections" and "most pricing is quote-only" (https://www.lassie.ai/blog/best-ai-tools-reducing-dental-claim-denials, https://www.themolarreport.com/learn/best-ai-dental-insurance-claims, https://toothy.ai/). All SECONDARY/vendor, mostly US. No public per-claim or per-minute rates for AI insurance follow-up found.
V22. Canadian collection fees: "Collection agencies typically charge between 25% and 50% of the amount of the debt they recover." https://wiki.clicklaw.bc.ca/index.php/Collecting_on_a_Debt [SECONDARY, BC legal wiki]. The Credit People (agency) 20 to 40%; NB legal guide 20% to 35% for commercial debt contingency.
V23. Legal limits: Ontario Collection and Debt Settlement Services Act, https://www.ontario.ca/laws/statute/90c14 [PRIMARY, page not opened]. Law Times (SECONDARY, https://digital.lawtimesnews.com/i/572956/6): "A debt settlement firm cannot charge a debt settlement client a penny in fees until a settlement is actually paid out. Furthermore, the maximum fee with respect to a single debt is 10 per cent". That is debt SETTLEMENT (consumer debtors), not collections on behalf of creditors. Act applies if "either the debtor or the agency is located in Ontario"; third-party agencies must register, in-house creditor departments do not (hoyes.com, OPINION). Whether a software vendor taking a success fee on recovered insurer payments is a "collection agency": NO EVIDENCE FOUND, needs legal advice.

## 2. What I could not verify

- Any full-text clause: O. Reg. 329/04 s.6, IPC ESP/HINP guidance text, any template vendor agreement, Curve Dental addendum, OPC third-party draft body. Fetch failed.
- Dental college (RCDSO, other provinces) guidance specifically on third-party billing services or agents: NO EVIDENCE FOUND (searched twice). Pharmacy regulator guidance: NO EVIDENCE FOUND. Audiology, chiropractic: NOT SEARCHED to a useful depth.
- Regulator statements on AI voice agents making calls to insurers: NO EVIDENCE FOUND.
- Patient consent expectations for an automated caller to an insurer on the practice's behalf: NO EVIDENCE FOUND (only AI scribe guidance).
- Centralized authorization letters for multi-location groups: NO EVIDENCE FOUND.
- Collision shop, restoration operator, pharmacy buyer requirements: NO EVIDENCE FOUND.
- Vendor help-centre documentation for queue/assignment features (only marketing pages seen).
- Pricing pages read directly: none; all via search summaries.

## 3. Feature candidates

Counts are independent sources seen in this session (search results), not exhaustive. Confidence: STRONG needs 3 or more independent sources including one PRIMARY directly on point. None met that bar cleanly, so the ratings are conservative.

REQUIRED TO BE SOLD AT ALL

| Feature | Evidence | Sources | Confidence |
|---|---|---|---|
| Signed service provider / privacy agreement (permitted use, breach notice, return/destruction, subcontractors) | V1, V2, V6, V7, V8 (Alberta HIA) | 5 (2 PRIMARY, 3 SECONDARY/OPINION) | STRONG for needing a written agreement; WEAK for exact clauses |
| Breach notification process with defined timeline | V2, V6 | 2 | WEAK |
| Canadian data residency option | V4, V5, V6 | 3, all SECONDARY/OPINION; V5 says PHIPA has no explicit ban | WEAK |
| SOC 2 Type II or ISO 27001 (accredited) evidence | V4, V6 | 2, unverified against tender | WEAK |
| Clinician oversight of delegated billing (records the practice can review) | V9 | 1 regulator (CPO) plus 1 BC college notice | WEAK |

EXPECTED

| Feature | Evidence | Sources | Confidence |
|---|---|---|---|
| Worklist / prioritized queue with owner and next-action date | Q4 | 4 | WEAK (marketing only) |
| Per-call summary, transcript, outcome tag, link from score to transcript moment | V18 | 5 | WEAK (vendor claims) |
| Human escalation / "requested human" flag | V18, Q4 | 3 | WEAK |
| Role-based access with location isolation | V15 | 3 (vendor) | WEAK |
| Audit log of user activity | V15, V6 | 3 | WEAK |
| CSV import with column mapping and row-level errors | V19 | 3 (generic, not RCM) | WEAK |
| Subprocessor list and data deletion on exit | V6 | 1 | WEAK |

NICE TO HAVE

| Feature | Evidence | Sources | Confidence |
|---|---|---|---|
| Promise-to-pay tracking | Q4 | 3 | WEAK |
| Callback / reminder scheduling | Q4 | 2 | WEAK |
| Dispute workflow | Q4 | 2 | WEAK |
| Bulk actions and templates | Q4 | 2 | WEAK |
| SSO / SCIM | V16 | 1 (US HIPAA) | NONE for Canada |
| Centralized authorization letters | none | 0 | NONE |
| Document request tracking | none | 0 | NONE |
| QA scoring rubric editable by customer | V18 | 2 | WEAK |
| Success-fee pricing option | V21, V22 | 2 (eAssist, collection agencies) | WEAK; legal status unverified |
| Free pilot of 10 claims | V21 | 1 (HoldFree) | WEAK |

## 4. Conflicting evidence

- Whether the written-agreement and breach-notice duties in O. Reg. 329/04 apply to all ESPs or only HINPs: compliancy-group.com says any ESP; another source ties it to HINP duties in s.6(3). One compliance guide cites "s. 6.3", mismatching the others. Resolve against e-Laws.
- Data residency: one vendor page says PHIPA requires Canadian residency; opsmed.ca says PHIPA has no explicit ban but de facto expectations exist.
- Canadian collection fee ranges: The Credit People gives 20 to 40% and, on the same page, 20 to 50%; Clicklaw 25 to 50%; NB guide 20 to 35%.
- Cold-call B2B exemption: CRTC says business calls are exempt from the DNCL but still subject to ADAD rules; the insurance-sector bulletin 2009-282 exemption concerns insurers and MGAs promoting products, not AR follow-up.

## 5. Eight remaining unknowns and the page that answers each

1. Exact ESP vs HINP duties: https://www.ontario.ca/laws/regulation/040329 (O. Reg. 329/04 s.6).
2. IPC position on vendors that are agents of custodians: IPC "Annual Report" or fact sheet on agents, via https://www.ipc.on.ca/en/health-organizations (PHIPA agents page).
3. Whether ADAD rules apply to non-telemarketing AR calls to insurers: CRTC Unsolicited Telecommunications Rules, https://crtc.gc.ca/eng/archive/2014/2014-155.htm, plus the current 2026 review notice on crtc.gc.ca.
4. Dental regulator guidance on third-party billing: RCDSO practice advisories, https://www.rcdso.org/ (Standards of Practice, Record Keeping and Privacy).
5. Fee legality for a software vendor taking a share of recovery: Collection and Debt Settlement Services Act s.1 definition of "collection agency", https://www.ontario.ca/laws/statute/90c14.
6. AI consent/notice for non-clinical calls: OPC final third-party guidance and PIPEDA Fair Information Principles, https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_third-party_202609/.
7. Public prices of AI claim follow-up competitors: https://www.holdfree.health/ pricing page and https://toothy.ai/ pricing page.
8. Multi-location SSO, audit log, roles in Canadian DSO software: https://www.dentrixenterprise.com/products/multi-location/features and Denticon help centre security docs.
