# Evidence-backed feature list (merged from six research reports, 2026-10-13)

Rule set by the founder: a feature is scheduled only if research supports it. Everything else is a hypothesis and stays off the plan until evidence arrives.

Evidence quality limit, stated once: every WebFetch in all six research runs failed (DNS or proxy), so every quote below is from a search-result excerpt, some of them paraphrased by the search tool. No quote was verified on its source page. "STRONG" here means several independent excerpts agree or a primary document is directly on point. Nothing is verified enough to cite externally. Reports: `feature-research/*.md`.

Three kinds of evidence are kept apart:
- MARKET: the job exists, the pain is real, buyers or competitors show it.
- BUYER GATE: something a buyer or regulator expects before buying.
- INTERNAL: a defect or gap in our own code (a fact about our system, not a market claim).

## 1. What the research does and does not establish

| Question | Result |
|---|---|
| Is phone follow-up with payers a real job in these domains? | **Yes, documented in all four.** Evidence is mostly job postings: billing coordinators "connecting with insurance adjusters directly for payments" (Ontario rehab), restoration AR roles making "outbound collection calls ... to insurance adjusters" (US), CSN Collision staff who "check on supplements" and "update insurance companies" (Ontario), a hearing clinic role "resolving partial payments, rejections, and unpaid claims" (Ontario). |
| Is it a large, costly, paid-for pain? | **Not established anywhere.** No hours, days-to-pay, write-off or short-pay figure for Ontario in any domain. One pharmacy survey (CPhA, September 2025, advocacy-linked, seen once): 75 percent of pharmacists spend 5+ hours a week on third-party claims, nearly 20 percent over 15; it does not isolate phone time. |
| Does software already solve it? | **No evidence it does.** Practice and shop software (Jane, Embodia, Juvonno, Towbook, Mitchell, Xactimate and others) requires manual payment posting or has no payer follow-up features, as far as excerpts show. This is absence of evidence from excerpts, not a feature review. |
| Do competitors do voice payer calls? | **Yes, in the US healthcare revenue cycle**: SuperDial, Infinitus, Prosper, LunaBill, HoldFree, Stratus and others. **None found serving Canadian carriers, WSIB, auto insurers, restoration, collision, tow or DME.** The report names this a possible gap or a trap (portals and CDAnet may already cover Canadian carriers). |
| Do payers accept AI callers? | **Unknown.** Pushback evidence is only competing vendors' blogs. |
| Is public pricing known? | AI voice platforms about $0.05 to $0.31 per minute; collection agencies about 20 to 50 percent of recoveries; US outsourced billing 3 to 10 percent of collections. No public AI claim-follow-up pricing. |

Bottom line: the job is real; the size of the prize in Ontario, and in these four domains, is unproven by public sources. The demand question needs data from your own product (human-assisted call logs, customer AR exports), not more web research.

## 2. Features by evidence

### Tier A: supported (several independent excerpts, or a primary document directly on point)

| Feature | Kind | Evidence | Status in our product |
|---|---|---|---|
| Outbound payer calls with IVR navigation and hold waiting | MARKET | 5 competitors | Built (squad) |
| Structured outcome capture (status, denial reason, reference number) | MARKET | 5 competitors | Built, regex based for autonomous; typed outcomes proposed |
| Human fallback or escalation | MARKET | 5 competitors | Built (staff handoff) |
| Write-back of results into the customer's system | MARKET | 6 competitors | Partly: AbelDent outbox exists; no Canadian rehab, collision or restoration system integrations were evidenced to exist or be accessible |
| HIPAA and SOC 2 style security attestations | BUYER GATE (US) | 3 vendors claim; Canadian equivalent unproven | Not assessed |
| Signed service provider / privacy agreement with permitted use, breach notice, return or destruction of data, subcontractor terms | BUYER GATE | 5 sources including two primary (regulator guidance), Alberta HIA explicit | BAAL exists for carriers; a customer-facing agreement set is a work item for counsel |

### Tier B: weak evidence (one or two sources, or vendor marketing); schedule only with a stated test

| Feature | Kind | Evidence | Note |
|---|---|---|---|
| Worklist with owner and next-action date | MARKET | 4 vendor marketing pages | Exists in part (work queue); owner and next-action fields to check |
| Per-call summary, transcript, outcome tag | MARKET | 5 vendor claims | Exists (transcript persisted, scrubbed) |
| "Requested human" flag | MARKET | 3 | Partial |
| Role-based access with location isolation; audit log | BUYER GATE | 3 vendor sources each | Partly built (roles, audit log, org structure); gaps unassessed |
| CSV import with column mapping and row errors | MARKET | 3 generic sources | Built for dental exports; mapping for other verticals unevidenced |
| Claim-age trigger for calls (for example day 30) | MARKET | 1 competitor (Prosper), plus SABS 30 day payment rule in a secondary excerpt | Built (30 to 90 day window) |
| Retry or scheduled next call; callback scheduling | MARKET | 2 | Built (recall rules) |
| Promise-to-pay tracking; dispute workflow; bulk actions and templates | MARKET | 2 to 3 each, marketing only | Not built |
| Adjuster payment-status call (rehab MVA) | MARKET | 2 job postings; HCAI shows decisions and the manual shows payment as a provider-entered field, so the call is plausible | Needs objective pack |
| Short-pay reason capture | MARKET | HCAI shows partial decisions per line (primary); no frequency data | Partial (shortfall fields exist) |
| Payer confirmation of receipt, payee name and cheque destination (restoration) | MARKET | R&R trade advice (secondary), 1 job post | New objective |
| Supplement status and payment trace calls (collision) | MARKET | job postings only | New objective |
| Storage and tow invoice follow-up | MARKET | job posting plus court cases showing disputes end in litigation | Legal stop points required |
| Hearing/ADP rejection and unpaid-claim calls | MARKET | 1 job posting; portals reduce need | Narrow |
| Canadian data residency; SOC 2 or ISO 27001 evidence; breach notification timeline; subprocessor list and deletion on exit | BUYER GATE | 2 to 3 secondary or opinion sources each; PHIPA has no explicit residency ban per one source | Compliance workstream |
| Clinician-reviewable billing records | BUYER GATE | College of Physiotherapists of Ontario says the clinician stays accountable for billing under their name | Reports and call records exist; reviewable format to assess |
| Configurable disclosure language per client | MARKET | 1 competitor | Disclosure fixed in prompt |
| Free pilot; success-fee pricing | MARKET | 1 to 2; legal status of success fees unverified (collection agency licensing question) | Pricing decision |

### Tier C: no evidence found. These stay hypotheses and are NOT scheduled

Accrual schedules for storage and accommodation; multi-invoice case model for collision and tow; supplement tracking; accommodation authorization tracking; authorization letter tracking and expiry; patient or claimant consent capture; multi-invoice remittance reconciliation as a phone-product feature; document request tracking; SSO or SCIM for Canada; QA scoring editable by customers (WEAK at best); hearing preauthorization calls (VAC and WSIB require it, but the payer says its portal is the easiest route); pharmacy preauthorization and audit disputes (only pockets); employer HR and disability administration (no evidence of a true receivable); staff alerts and consent handling as differentiators (nobody offers them, demand unknown).

Important: Tier C items are not wrong. Their evidence is simply absent from public sources. The architecture work that supports them (case, invoice and payment records, authorization grants) is justified separately if and only if Tier B objectives for those domains are first proven with real calls.

## 3. INTERNAL items (code facts; not market driven; evidence is in the proposal sections 3.5 and 16.2)

Manual trigger skips mode selection and TELUS resolution; dispatch intent ledger unused in production; recovered-dollars counts any insurer-paid balance drop; import closure is practice-scoped; shared carrier knowledge is global; hold duration not persisted; Scribe first message "Hello."; human-assisted squad not in the repository; knowledge sharing may affect PHIPA agent status; disclosure not verifiable per call; human-assisted mode gives no recording notice. These are correctness and compliance work regardless of vertical.

## 4. What this means for the plan

1. Build order justified today: INTERNAL defects, Tier A gaps (customer agreements and privacy documents, compliance evidence), and Tier B items that are already mostly built (queue, outcomes, transcripts).
2. Do not build Tier C. Do not build the heavier case model until a vertical's Tier B calls are shown to need it.
3. The next evidence must come from the product itself: human-assisted call logs and sample AR exports. The research reports each end with specific unknowns and the page that would answer them.
4. The "gap or trap" question for Canada (no competitor serving Canadian carriers or these verticals) cannot be resolved by more desk research. A small sample of real calls would show whether carriers and adjusters accept automated or human-assisted callers.
