# Council report: product strategy and go-to-market skeptic

Date: 2026-10-13. Seat: PRODUCT STRATEGY AND GO-TO-MARKET SKEPTIC. No code changed, no one contacted, no calls made. No em or en dashes used.

Evidence labels: CODE (file read), SOURCE (a file in this repo that quotes an outside source; every outside quote in the research is an unverified search excerpt, per EVIDENCE-BACKED-FEATURES.md), REASONING (premise stated), OPINION.

## 0. Bottom line

The proposition is a good answer to "how do we build a multi-industry product without a mess". It is not an answer to "should we build a multi-industry product". The research files say plainly that the job exists but its size and cost are unproven in every domain, that payer acceptance of AI callers is unknown, and that the first product has no measured result. The architecture proposal is 127 KB and ten-plus work packages. The demand evidence is job postings and search excerpts.

My advice: stay dental for twelve months as the default, with one cheap, bounded, non-engineering probe into one adjacent vertical (Ontario MVA rehab) that runs on the existing human-assisted squad and costs weeks, not quarters. Do the defect fixes in P10 because they protect dental regardless. Do not build the shared-core refactor (P1, P4, P6, WP-3 to WP-8) until a probe passes its gate.

The single most important fact in the files: there is a stated count of zero active practices (CODE/docs: `docs/operations/BUILD-HANDOFF.md` line 59, "there are currently **zero active practices**", written 2026-07-18; it may be stale, confirm with the founder) and the pilot of 50 to 100 supervised calls is a checklist item, not a result. Dental, the one vertical the team has built for, has no measured recovery rate, no measured hold time (hold duration is not persisted, ARCHITECTURE-PROPOSAL 3.5/16.2), and no measured payer acceptance. Expanding to four verticals before measuring one is the central strategic risk.

## 1. Does the proposition invest engineering ahead of demand evidence?

Yes, in two distinct ways, and one is worse than the other.

1. Direct: WP-3 (ledger and import identity), WP-4 (payer and contact registry, authorization), WP-5 (objectives, typed outcomes, capability grants), WP-6, WP-7, WP-8, WP-9 form a chain that WP-8 "needs" (ARCHITECTURE-PROPOSAL section 10: "WP-8 ... needs WP-1 to WP-7"). So the first non-dental call is gated behind seven work packages. That is a build-first sequence. SOURCE: ARCHITECTURE-PROPOSAL.md lines 824 to 828.
2. Indirect: the brief's P10 says "expand only on call-log evidence", but P1 to P6 and P13 are decided now, before any non-dental call log exists. Designing the shared core "right" requires knowing what a second module needs; P9 itself admits "if it forces changes to the core, the core is shaped wrong", which means the core cannot be judged right until a module has been run against it. REASONING: you cannot shape a core to fit a module that does not yet exist; the evidence that would shape it is the thing the plan says to get later.

The council's own evidence file agrees. EVIDENCE-BACKED-FEATURES.md section 4: "Do not build the heavier case model until a vertical's Tier B calls are shown to need it." and "The next evidence must come from the product itself". Yet the proposal's section 1 item 2 names the case/receivable/payment-allocation split as the "single biggest structural blocker" for expansion. Both can be true: it is a blocker for expansion, and expansion is unproven. The honest sequencing is to prove expansion first and pay for the blocker only if it passes.

What is justified now (INTERNAL, benefits dental whether or not we expand): manual trigger parity (WP-0), single dispatch path (WP-1), honest recovery attribution, disclosure proof, squad in repo, hold time persisted, Claims_Scribe first message, buyer-gate privacy documents. These are about 8 to 10 items, small, and they are prerequisites for a trustworthy dental pilot. Keep them. Cut or defer the rest.

## 2. What the evidence does and does not say (my reading)

| Question | Evidence state | Label |
|---|---|---|
| Phone follow-up exists as a job in Ontario non-dental domains | Yes, job postings in rehab, collision, hearing; US postings in restoration | SOURCE (EVIDENCE-BACKED-FEATURES section 1) |
| It is costly or frequent | Not established anywhere. One pharmacy survey, advocacy-linked, seen once, does not isolate phone time | SOURCE |
| Software already does it | No evidence; practice software requires manual payment posting | SOURCE |
| Payers accept AI callers | Unknown. Only competitor blogs mention pushback (Infinitus, SuperDial, both say they are not blocked) | SOURCE (competitive-landscape section 4) |
| Customers will pay | Zero price discovery. No public AI claim-follow-up pricing | SOURCE |
| Canadian carrier phone dependence | Unknown; CDAnet and carrier portals are the stated electronic substitutes | SOURCE (competitive-landscape section 5) |

One more point the proposal under-weights. ARCHITECTURE-PROPOSAL 17.1 item 1 says in its own words "Phone is the residual path, not the main path" in these domains (HCAI, WSIB e-billing, ADP electronic-only since January 2022, real-time ODB/TDP adjudication, VAC portal). So the addressable phone work is what portals leave over: payment trace, exceptions, adjuster-led files, preauthorization. That residue is not sized anywhere.

## 3. Cheapest ways to get demand evidence without founder interviews

Constraint: founder interviews are not a prerequisite. These options respect that. Ranked by cost per unit of evidence. Several are things the team must do anyway to sell, so they are not extra work.

| # | Method | What it proves | Cost (REASONING, my estimates) | Kill signal |
|---|---|---|---|---|
| 1 | Instrumented dental human-assisted calls (the existing V1). Make sure hold seconds, answer rate, voicemail rate, rep disclosure acceptance, outcome and reference number are persisted per call. | Unit economics, payer acceptance, call duration, outcome mix, in the vertical we already sell. Every other estimate depends on this | Mostly WP-0/WP-1 plus hold-time persistence; weeks | Carrier blocks or refuses; median hold plus talk time makes COGS exceed price |
| 2 | Free "AR export audit" offer: a clinic uploads its aged-AR export (CSV), we return a one-page analysis of invoices past the 30-day mark and past 90 days, by payer. | Real AR size, age and payer mix per vertical, from the customer's own data. Also a sales lead. This is the "sample AR export analysis" the research asks for | Analysis script plus a sample report; days. Uses existing CSV import and aging code | Fewer than N invoices past 30 days per clinic per month; or customers decline to share an export |
| 3 | Priced offer test: a one-page offer with a price ($ per month or per recovered invoice) sent through channels the team already uses for outreach (the marketing engine in `Collect-RX-main/src/server/marketing/` exists per CLAUDE.md). Measure replies, demo requests, signed LOI. | Willingness to engage at a price. A sales motion, not an interview | Copy plus list; days to a couple of weeks | Under a set reply and booked-demo rate over a fixed count of sends |
| 4 | Concierge pilot: one paying or free-with-commitment clinic per candidate vertical, calls run in human-assisted mode, staff time and minutes logged. | Actual minutes per invoice, outcomes, adjuster behavior | The existing squad plus manual setup; no new schema (use the `attributes` JSON idea in P4 or even a spreadsheet) | Adjuster hostility, near-zero connect rate, no money moved |
| 5 | Job-posting census: count Ontario postings per domain on Job Bank/Indeed for roles whose duties include insurer follow-up, with stated salary. | A rough count of employers who pay staff for this; a floor on market size | Hours, desk research only | Very few postings |
| 6 | Existing-customer telemetry: ratio of calls that reach a live person versus end at IVR/portal/voicemail across the six dental carriers. | Whether the phone is even the path for Canadian carriers (the gap or trap question) | Free once logged | Most claims resolvable by CDAnet/portal; reps refuse automated callers |

Method 2 and method 1 together are my strongest recommendation: cheap, they produce numbers the files say are missing (hours, days-to-pay, short-pay share), and they double as lead generation.

Method 3 caveat (OPINION): a landing-page offer test measures interest, not pain. It is a weak signal alone. Pair it with method 2 so interest comes with data.

## 4. Which single non-dental vertical looks most attractive

My pick: Ontario MVA rehab (module W2 in the brief), tested first as a concierge human-assisted payment trace, with W1 for rehab as a zero-engineering side probe. Confidence: low. Everything below rests on search excerpts.

Reasons (evidence labeled):
- A statutory trigger exists. SOURCE (rehab-allied.md, FSCO bulletin via search): "The SABS requires all invoices to be paid within 30 days of receipt." and interest of 1 percent per month compounded. A clock plus a late-payment remedy is a concrete reason to call and a reason a clinic would care. The primary-source pass confirmed s. 38(15) and s. 51(3) (ARCHITECTURE-PROPOSAL 17.6).
- The data gap is documented in a primary source. ARCHITECTURE-PROPOSAL 17.6 item 4: "HCAI does not show payment (manual excerpt). MVA payment trace stays a phone objective. Payment received is a provider-entered field." So the tool the clinic already uses does not answer "was this paid and where did the cheque go".
- Software does not close the loop. SOURCE (rehab-allied.md section on Jane, Embodia, Juvonno, Practice Perfect): payment is posted by hand and no vendor claims it phones insurers.
- Job exists. SOURCE: Job Bank concussion-care billing coordinator, "Connecting with insurance adjusters directly for payments."
- Buyer profile is close to dental: small independent practices on practice-management software that takes CSV exports (REASONING: reuses the import and the dental sales motion).
- Minimal call-engine change in human-assisted mode (REASONING: the call is a payment trace to an adjuster line; the squad is IVR then hold then a human; staff talk).

Reasons I do not rate it higher:
- No data on how many OCF-21 invoices are paid late, short, or lost. "NO EVIDENCE FOUND: any published statistic on days-to-payment of OCF-21s, share short-paid" (rehab-allied.md line 56).
- Adjusters are human, named, and the clinic's referral relationship runs through them. SOURCE: no buyer or insurer view on AI callers exists (rehab-allied.md line 69/70). A bot that annoys an adjuster costs a clinic more than a bot that annoys a carrier IVR (REASONING/OPINION).
- Adjuster lines may have little hold time. Our cost model is per minute (section 6); if the call is short and the answer is a voicemail, labor savings are small and the value must come from speed of cash. REASONING.

Why not the others (OPINION on the evidence):
- Collision/tow/storage: pain shows up as litigation over storage rates ($483K Intact v. Vaughan dispute, 108 s. 24 applications; collision-tow-storage.md). That is a legal edge product, not a phone product. The proposal forces multi-invoice and accrual modeling, the heaviest build, for a domain whose features "NONE" reach STRONG as a paid problem.
- Restoration: "No feature reached STRONG for Ontario" (property-restoration.md line 80). Contractor DSO claims are US vendor marketing and the fix cited was liens, not calls. Heaviest party model.
- Hearing/equipment/pharmacy: portals are the stated best route (WSIB, ADP, VAC); phone is a fallback. Pharmacy survey is advocacy and does not isolate calls.
- W1 for rehab and hearing (P9's choice): reuses the most plumbing, but I found no evidence anywhere that rehab or hearing clinics phone extended-health carriers for claim status at a rate that justifies a product. The only hearing evidence is one job posting. It is the cheapest to run, so I keep it as a probe. It is not strong enough to be the first investment. P9 optimizes for engineering reuse, which the proposal itself says is "a build ordering, not a market judgment" (section 10 WP-8).

## 5. "No Canadian competitor": gap or trap

Both are consistent with the evidence. My lean: more likely a trap than the files suggest, until call data says otherwise. Reasoning:

Evidence for TRAP:
- US healthcare AR is a venture-funded category (Infinitus raised a $51.5M Series C, total $102.9M; SuperDial $15M; LunaBill, Toothy, Prosper in YC; SOURCE competitive-landscape table). The only Canadian-headquartered analog, InsideDesk (Ontario), took $12.6M USD and serves US dental service organizations (450 practices across 18 states) powered by SuperDial. If Canadian carrier phone work were an easy large prize, an Ontario company with SuperDial's engine and a Canadian address would plausibly have taken it. REASONING. They went to the US. That is a revealed preference worth a lot of weight.
- Canada's electronic substitute is established: CDAnet "has become an indispensable part of the everyday workflow" (CDA, SECONDARY), eligibility included. Sun Life and Manulife have member portals and claim-status channels (SOURCE competitive-landscape section 5).
- Market size: Canada has roughly one tenth the population of the US (OPINION/common knowledge; no figure in the files). Six carriers hold about 78 percent (CLAUDE.md). Concentration means fewer buyers per payer and, critically, a single carrier saying no ends the product for a large slice. CARRIER_BLOCK is already the "most critical operational safety rule" in CLAUDE.md for exactly this reason.
- No independent buyer reviews exist for AI payer callers at all, anywhere (competitive-landscape section 4). The category is young even in the US.

Evidence for GAP:
- Search found none for Sun Life, Manulife, Canada Life, Green Shield, TELUS, RBC, WSIB, auto insurers (SOURCE, with the caveat that search excerpts are weak negatives).
- Practice-side software does not phone payers (rehab-allied.md).
- US vendors face privacy and data-residency friction in Canada (REASONING; PHIPA residency evidence is mixed per the files).

How to settle it cheaply: method 6 in section 3 plus 50 to 100 supervised dental calls. If carrier reps accept the calls and a meaningful share of claims actually require the phone, it is a gap. If most claims close through CDAnet/portal or reps refuse automated callers, it is a trap, and a multi-vertical shared core is polish on a product with no market. This is also why payer acceptance, not architecture, is the first thing to measure in any vertical.

## 6. Pricing and unit economics from the files

Inputs in the repo:
- COGS: about $0.135 per minute delivered (CODE: `Collect-RX-main/src/billing/tiers.ts` line 4). The research gives a market range of $0.05 to $0.31 per minute for AI voice platforms (SOURCE EVIDENCE-BACKED-FEATURES section 1), so $0.135 is mid-range.
- Current price: Hold Sentinel $399 CAD per month for 1,000 minutes, $0.25 per minute overage, about 63 percent gross margin at full use (ADR 0004). Recovery $799 / $1,999 / $2,499. There is a 45-minute call ceiling (CODE: billingCatalog test noted in PATH-TO-DELIVERY).
- Substitutes (SOURCE competitive-landscape section 6): Ontario in-house biller about $19 to $25 per hour; Philippines VAs about $5 to $7 per hour (wage, not agency price); US outsourced billing 3 to 10 percent of collections; collection agencies about 20 to 50 percent of recoveries (buyer-requirements V22); DentalRobot third-party estimate $150 to $250 per location per month.

Arithmetic (REASONING, pure calculation from the inputs above):
1. 1,000 minutes is about 16.7 hours. At $22 per hour that is about $367 of Ontario staff time. The $399 plan costs slightly more than the staff time it fully replaces at full use. Value must therefore come from recovered or accelerated dollars, from staff not being on hold (interrupt cost), or from capacity, not from raw labor arbitrage.
2. Against an offshore VA ($5 to $7 per hour, about $0.08 to $0.12 per minute), our COGS of $0.135 per minute is not cheaper on a pure minutes basis. The Hold Sentinel minutes are mostly hold time, so we are paying voice-platform rates to wait. This is why price must be anchored to outcomes, not minutes.
3. Overage at $0.25 per minute is below an Ontario staff minute ($0.32 to $0.42) but above an offshore VA. It is competitive against local staff only.
4. A 30-minute call (an assumption; actual hold is not persisted today) costs about $4.05. A rehab adjuster call of 8 minutes costs about $1.08. Neither is the constraint; payer acceptance and recovered cash are.
5. Success-fee anchors: 20 to 50 percent agency fees (V22) exceed anything we can justify as software. At 10 percent of money actually moved, a clinic with $20,000 of aged invoices that recovers half pays $1,000, versus $399 per month flat. But "recovered" is not honestly measured today (ARCHITECTURE-PROPOSAL 3.5D: any insurer-paid balance drop counts) and whether a software vendor taking a share is a regulated "collection agency" under Ontario's Collection and Debt Settlement Services Act is unverified (buyer-requirements line 144). Do not price on success fees until both are fixed.

What cannot be computed from the files and should be (this is the real gap): average hold plus talk minutes per call per carrier; calls needed per recovered claim; dollars moved per call; staff minutes saved. Every one needs the call-log instrumentation in section 3 method 1. Until then any price for a new vertical is a guess. A rehab pricing model needs invoices per clinic per month, share past 30 days, and share short-paid; none are in any file.

Model risk for non-dental: the expansion adds modules (policy packs, golden transcript suites per pack, human review of money states, P12) that raise per-module fixed cost for a small team. A module with a handful of customers carries that fixed cost per customer. REASONING: at the Sentinel gross margin of about $264 per customer per month, a module needs on the order of several dozen customers just to cover one engineer-month of upkeep per quarter (assumed team cost, not in the files). That is the commercial test behind P7.

## 7. Verdicts on P1 to P13

| P | Verdict | Strongest objection | Evidence | What would change my mind |
|---|---|---|---|---|
| P1 shared call engine | SUPPORT WITH CHANGES | The engine is already shared in practice (one squad grammar); formalizing it now is refactoring ahead of a second consumer | REASONING; ARCHITECTURE-PROPOSAL 17.2 itself says the roles are the same. CODE: dispatch divergence is a real bug (3.5A), so unify dispatch now but call it a defect fix, not a platform | A probe module that cannot run on the current squad without engine edits |
| P2 one prompt per objective, freeze dental_v1 | SUPPORT WITH CHANGES | Splitting the dental prompt (17.5k chars) has no commercial driver until a second module runs; freeze dental_v1 yes, write a second prompt only when a probe needs it | REASONING; SOURCE 15.3 | A measured dental failure from the large prompt |
| P3 placement test | SUPPORT | This is a good rule and cheap. Strong because it is also the anti-bloat rule the founder asked for | REASONING | n/a |
| P4 typed JSON attributes per module | OPPOSE for now | It builds a schema-validation system for modules that do not exist; the probe can use free-text notes or a spreadsheet | REASONING; Tier C list shows no evidence for the entity shapes it supports | Two live modules both needing structured fields the dental model lacks |
| P5 module contract (six items) | SUPPORT WITH CHANGES | A six-item contract is heavy for a first probe; require only objective pack, stop triggers, and tests at first | REASONING | n/a |
| P6 cap of about eight shared entities | SUPPORT as a guard, OPINION | A number is arbitrary, but a stated cap forces writing the reason; fine | OPINION | n/a |
| P7 retirement rule | SUPPORT, and make it stricter | The brief says "too few calls after a set time" but gives no numbers. Without numbers it never fires. Section 8 supplies them | REASONING | n/a |
| P8 cut list | SUPPORT | Matches Tier C. Add to the cut list: multi-vertical `practice_verticals` config, authorization grants, party model, W3, W4, W5 | SOURCE EVIDENCE-BACKED Tier C | A Tier B result that upgrades one of them |
| P9 first module W1 | OPPOSE as the commercial choice | It is chosen for engineering reuse; no evidence anyone in rehab or hearing phones extended-health carriers at volume. Keep as zero-engineering probe, lead with W2 | SOURCE rehab-allied.md; ARCHITECTURE-PROPOSAL WP-8 says its order is "not a market judgment" | A rehab clinic that shows 20 plus stuck extended-health claims in an export |
| P10 build order | SUPPORT WITH CHANGES | Right ordering of defect fixes; but "buyer-gate compliance" before any demand test can expand without end (counsel work). Time-box it and run the AR export audit in parallel | REASONING; Tier A is large | n/a |
| P11 human-assisted launch, graduation on measured criteria | SUPPORT | It is the core of the instrument. The criteria for graduation are not defined by number; define them (section 8) | SOURCE ADR 0003 | n/a |
| P12 hallucination controls | SUPPORT WITH CHANGES | Correct for autonomous mode, which is on no plan today (CODE: ADR 0004, `autonomous_calls` in no tier). In human-assisted mode the Scribe never speaks, so a per-pack golden suite and post-call fact checks are over-built for the evidence | CODE ADR 0004 | Autonomous mode offered on a plan |
| P13 scoped knowledge, tenant-only for health custodians | SUPPORT | The current global slot per carrier is a real leak (3.5E). Do it now; it is a defect fix | CODE schema.prisma 2248 per proposal | n/a |

## 8. Ranked recommendation with kill criteria

Ranking (highest priority first):

1. Fix the dental defects in P10 and persist hold time and per-call outcomes, so the first pilot yields numbers. Kill criterion: none; this is a precondition. Time-box to weeks.
2. Run the dental pilot of 50 to 100 supervised human-assisted calls with one or two practices (the pilot kit exists). Gates to continue investing in anything: answer-to-staff-handoff rate, no CARRIER_BLOCK event, median call cost under the price-per-call implied by the plan, and at least one practice willing to pay after the free period.
   - KILL or PAUSE EXPANSION if: any carrier blocks or formally refuses automated calls; or fewer than half of attempted calls reach a live human; or median billed minutes per call times $0.135 exceeds roughly 25 percent of the revenue per call implied by the plan; or no pilot practice converts to paid within 60 days of the pilot ending.
3. Run the free AR export audit across dental and rehab prospects (method 2) and the priced offer test (method 3), in parallel with step 2. Gate: at least 5 distinct rehab clinics share an export and at least 2 show 20 or more invoices past 30 days in a month, or total stuck AR large enough that 10 percent of recovered value exceeds the plan price.
   - KILL rehab as a candidate if: fewer than 3 of 10 contacted clinics agree to share an export, or fewer than 2 show material aged invoices, or the typical clinic's aged AR is under what one month of the plan costs.
4. Concierge MVA payment-trace probe with one or two rehab clinics, human-assisted, using the current squad and a spreadsheet or JSON attributes (no new tables). Run 30 to 50 calls.
   - KILL if: adjusters or insurers complain or request that the clinic stop; or connect rate to a live adjuster is below a third; or fewer than a quarter of traced invoices produce money moved or a usable reference within 30 days; or the clinic does not pay.
5. Only if both 2 and 4 pass: build the shared-core work (WP-3 to WP-8 in a trimmed form) for that one module. Not before.
6. Retirement rule numbers for P7 (suggested): a new module must reach at least 150 calls and 3 paying tenants within 6 months of its first call, or it is frozen; a second 6 months with no growth removes it.

What to hold back: W3, W4, W5, W6, pharmacy, equipment. Zero non-dental module beyond one probe until the dental pilot returns data.

## 9. What would make me advise "stay dental for twelve months"

Advise it (and not even run the rehab probe) if any of these hold:
- Any Canadian carrier signals a block, rejects automated or human-assisted-recorded calls, or asks for formal notice.
- Counsel returns an unfavorable view on CRTC automatic-dialing-announcing rules for AI-voiced B2B calls, PHIPA agent status, or the disclosure that adjusters may share (all flagged as unresolved in 17.1 item 6).
- Dental pilot shows connect rate or gross margin below the gates in section 8.
- The team is two or fewer engineers: the proposal's own list of 15-plus items and the three-tree agent prompt drift in CLAUDE.md already show maintenance load (CODE/docs: CLAUDE.md warns the shipped and root agent trees drift with no sync check).
- No dental customer pays in 90 days. Adding verticals to a product nobody is paying for is dilution, not expansion.

Reasons staying dental is also a positive strategy (OPINION): the V1 wedge (Hold Sentinel, staff talk, Scribe learns playbooks) generates exactly the carrier-behavior data that every later vertical needs; the 78 percent carrier concentration means a handful of playbooks cover most of a vertical; the trial and tier machinery already exists (ADR 0004). The data moat in the proposal (shared knowledge, P13) comes from volume in one place, not breadth.

## 10. Five or more things the author missed (ranked by severity)

1. The whole plan has no demand gate for the payer side. Payer acceptance of AI callers is "Unknown" (EVIDENCE-BACKED table) and carrier concentration makes it binary: six carriers are 78 percent of dental. A shared core that scales to five verticals does not reduce this risk. It can multiply it, because one detected automation pattern in one vertical could trigger CARRIER_BLOCK across tenants (the proposal's own concurrency design in section 15.2 aggregates per payer across tenants, which makes one tenant's behavior another's risk). Severity: critical. REASONING plus CODE (CLAUDE.md CARRIER_BLOCK rule).
2. The unit economics cannot be computed today because hold time is not persisted and "recovered dollars" is not attributable (ARCHITECTURE-PROPOSAL 3.5D, 16.2). Pricing decisions for any vertical, and the P7 retirement rule, depend on figures the system does not record. Severity: high.
3. Pricing parity with labor: a full-use $399 plan costs about what 1,000 minutes of Ontario staff time costs ($367 at $22/hour) and exceeds an offshore VA. The business case rests entirely on outcome value, which is unmeasured. Severity: high. REASONING (section 6).
4. Opportunity cost and bus factor: the plan adds roughly seven work packages ahead of the first non-dental call while the first product has zero active practices (docs claim, may be stale) and a compliance checklist (Group D to G in PATH-TO-DELIVERY) not done. Selling is not on the work-package list at all. Severity: high. Nothing in P1 to P13 assigns anyone to sales or to getting the first paying practice.
5. Regulatory and relationship risk is concentrated in the adjacent verticals but is treated as engineering. Success-fee legality (Collection and Debt Settlement Services Act), CRTC rules, PHIPA agent status, and what adjusters may disclose are all "counsel decides" (17.1 item 6). Until counsel answers, a product hole may exist in every non-dental vertical. Severity: high.
6. Competitor entry risk is understated. SuperDial and Infinitus are funded and already powering an Ontario company (InsideDial is "powered by SuperDial" and Ontario-headquartered). If the Canadian dental or rehab market proves out, an incumbent with US scale and a Canadian office could enter in a quarter. Being first in Canada is a weaker moat than the proposal implies. Severity: medium. SOURCE competitive-landscape.
7. The pitch boundary. CLAUDE.md states the product boundary: "Practice to Insurance AR recovery + practice SaaS Billing only." Moving into tow/storage disputes and contractor liens drifts toward collections and legal-edge work that the files show end in litigation. This changes the risk profile (and potentially licensing) beyond a new module. Severity: medium. SOURCE collision-tow-storage.md.
8. Evidence provenance: every outside number in the research is a search excerpt, none verified on the source page (EVIDENCE-BACKED header). Several design decisions (30-day clock, 1 percent interest, HCAI no-payment status) were upgraded by a later primary read; others (the competitive and pricing numbers) have not been. Any investor, customer or counsel-facing statement must be re-verified. Severity: medium.

## 11. Over- and under-engineered

Over-engineered for the evidence: the case/receivable/payment-allocation model, authorization grants, party model, per-payer budgets, typed attribute schemas (P4), per-pack golden transcript suites for modules that do not exist, the module contract's six-item requirement, the 29-prompt agent tree discussion that is unrelated to the question. The proposal is complete as an architecture and incomplete as a business decision.

Under-engineered: measurement (hold time, call cost, attributable recovery), payer-acceptance monitoring and CARRIER_BLOCK for non-IVR adjuster lines, a basic funnel from prospect to paid practice, and the pricing/packaging test for any non-dental vertical. Also the human-assisted path itself: Claims_Scribe audio after transfer is "unverified and central to the V1 product" (16.2 item 2), and that is the demand-evidence instrument for everything else. If the Scribe cannot hear the staff call, the plan's evidence source fails.

## 12. Concrete alternative for the weakest proposition (P9 and the WP-8 chain)

Replace "build W1 on a re-shaped core, then expand on logs" with a three-step evidence ladder that needs no schema change:

1. Step A (2 weeks): finish the dental defects, persist hold seconds and outcomes, verify Scribe audio after transfer on the founder's own phones (WP-0b).
2. Step B (4 to 8 weeks, parallel): AR export audit offer to rehab and dental prospects (method 2) plus a priced offer test (method 3). Output: a one-page table of invoices past 30 days, per payer, per clinic, with a counted number of clinics.
3. Step C (6 to 10 weeks): one concierge MVA payment-trace pilot on the existing human-assisted squad with the objective carried as call metadata and a spreadsheet, 30 to 50 calls, a written adjuster-reaction log. A "module" is just a prompt file plus a one-page runbook.

Gate to the shared core: pass the section 8 criteria. If it passes, build only what the pilot showed it needed, which is P3's placement test applied to evidence instead of imagination. If it fails, the team has spent about three months and little engineering, and keeps the dental product.

## 13. Limits of this review

I read the council brief, EVIDENCE-BACKED-FEATURES.md, competitive-landscape.md, the grep-targeted parts of the four feature-research reports and the architecture proposal (sections 1, 10, 16, 17), ADR 0004, BUILD-HANDOFF, and `tiers.ts` cost constants. I did not read every section of the 127 KB proposal, the other domain reports in full, or the code files listed in the brief beyond the facts cited. All market claims inherit the unverified search-excerpt status of the research. The "zero active practices" statement is from a July 2026 handoff file and may be out of date.
