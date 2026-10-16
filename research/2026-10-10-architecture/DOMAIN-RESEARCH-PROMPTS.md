# Domain research prompts: how insurance AR actually works, by industry

Date: 2026-10-16. Purpose: build a grounded understanding of the insurance process and of how each target industry collects what insurers owe it, so the scope of the ledger, registry, policy packs and objective packs is set by evidence and not by assumption.

Three prompts, run in order. Prompt 0 runs once. Prompt 1 runs once per industry (six runs, in parallel if possible), changing only the INDUSTRY block. Prompt 2 runs after all Prompt 1 outputs exist. Use the strongest model with browsing. If browsing is blocked, the researcher must say so and produce a reading list for a person to read (see Cowork prompt style in COWORK-VERIFICATION-PROMPT.md).

Prior work exists in domain-research/ and feature-research/ in this folder. It was done from search excerpts because page fetches failed. Treat it as hypotheses to test, never as findings.

---

## Prompt 0: the insurance and insurance AR primer (run once)

```text
ROLE
You are a research analyst building a factual primer on how insurance claims become cash for the businesses that provide goods and services to insured people. You are not selling or building anything. Your output will set the scope of a software product, so wrong or invented detail is costly; "I could not find this" is a good answer.

JURISDICTION
Ontario, Canada first. Note where federal rules or other provinces differ, but do not research other provinces in depth.

EVIDENCE RULES
1. Prefer primary sources: statutes and regulations, regulator guidance and forms, payer provider manuals and billing guides, tribunal and court decisions, official statistics. Then professional associations and standards bodies. Then vendor documentation for billing software. Then practitioner commentary and forums.
2. Tag every factual claim: PRIMARY (you read the primary document and can quote it), SECONDARY (a reputable summary of a primary source), ANECDOTE (a practitioner or forum statement; say who, where, when, and how many people said it), or UNVERIFIED (inference or recollection).
3. Quote exact words for any rule, deadline, number or definition, with the source URL and the date you accessed it. Never invent a section number, form number, figure or quotation.
4. For any statistic (days to pay, denial rate, share of claims), give the definition, the population, the year and the source. If no source exists, write NO DATA.
5. Record contrary evidence when you find it. Do not hide findings that undercut the obvious story.
6. If a page is blocked or needs a login, say so and move on. Do not guess its contents.
7. Do not use em dashes or en dashes.

WHAT TO PRODUCE
Part A. The generic claim-to-cash chain. For a covered person receiving goods or services from a provider, trace every step: coverage and eligibility, preauthorization or predetermination, service, claim submission (who submits: provider or patient), adjudication, explanation of benefits or remittance, payment (to whom, by what method, how often), reconciliation, short-pay and denial handling, appeals and disputes, recovery and write-off. For each step give the actors, documents, identifiers, systems and channels, typical timing, and the rule or contract that governs it.
Part B. The variants that change the money flow, each explained with an Ontario example: first-party versus third-party claims; insured plans versus administrative-services-only plans run by third-party administrators; direct billing versus patient reimbursement; assignment and direction to pay; coordination of benefits and dual coverage; government programs as payers; liability insurers and subrogation; cheques made payable to several parties; holdbacks and deductibles.
Part C. How a provider collects when payment is late or wrong: the escalation ladder from internal follow-up to payer escalation to regulator or tribunal to collection agency or lawyer, with the actual mechanisms and the rules on each (for example complaint routes, interest, limitation periods).
Part D. The channels. For each channel (electronic claim transmission, payer portal, EDI clearinghouse, API, fax, mail, phone) say what it is used for, what it cannot do, and who controls it. Be specific about why a person still has to phone, with evidence.
Part E. Who does AR work in a provider business today: roles, tools (practice management and billing software), hours spent, outsourcing options (billing agents, revenue cycle vendors, factoring), and typical costs, with sources.
Part F. A glossary of terms, identifiers and document types (for example claim number, policy and certificate numbers, authorization number, remittance advice) with what each one identifies and who issues it.
Part G. What you could not find, and the five questions whose answers would change how a software product should be scoped.

OUTPUT
One markdown document with parts A to G, then a table of every claim with its tag and source, then a list of pages you could not access.
```

---

## Prompt 1: industry deep dive (run once per industry)

Replace the INDUSTRY block. Run for each of: (1) Dental, group insurers and government dental plans; (2) Auto rehabilitation and allied health, including Ontario accident benefits, WSIB and extended health; (3) Property restoration and emergency housing; (4) Collision repair, towing and storage; (5) Medical equipment, pharmacy, hearing and disability-related programs; (6) Any industry you judge to have been missed, with the reason (optional).

```text
ROLE
You are a research analyst producing a grounded, source-tagged picture of how one industry gets paid by insurers today. The output sets the scope of a software product that phones insurers to check on and chase unpaid claims and invoices. You must also look for evidence that this product is NOT needed. Your job is to find the truth, not to support the product.

INDUSTRY
[Name the industry, the typical business (for example a physiotherapy clinic, a restoration contractor), the insurers and programs it bills in Ontario, and any sub-segments.]

EVIDENCE RULES
Same as the primer (primary first; tag every claim PRIMARY, SECONDARY, ANECDOTE or UNVERIFIED; quote exact words with URL and access date; statistics need definition, population, year and source, else NO DATA; record contrary evidence; blocked pages are reported, not guessed; no em or en dashes).
Additional rules for this prompt:
 - Anecdotes: for each pain point from forums, trade publications or reviews, record the source, date, and a verbatim excerpt. Count independent sources; one post is a single anecdote, not a pattern.
 - Do not describe a workflow step you cannot source. Mark it UNVERIFIED or leave it out.
 - Do not size a market. Counts of businesses are allowed if sourced (name the dataset and year); revenue and willingness to pay are not asked for.

HYPOTHESES TO TEST (from earlier, weak research; try to refute each, say CONFIRMED, REFUTED, or INSUFFICIENT EVIDENCE)
 H1 Most claims in this industry are submitted and tracked electronically, so phone is the residual channel (exceptions, adjuster-led files, payment trace, preauthorization).
 H2 Payers rarely show payment status to providers electronically; providers learn of payment from remittance or deposit.
 H3 The commonest cause of late payment is [industry-specific; state what the sources say instead].
 H4 Statutory or contractual payment clocks exist and providers rarely enforce them.
 H5 Providers already have a person or vendor doing follow-up; the cost of that person is material to the business.
 H6 Insurers or adjusters will speak to a provider's agent by phone and will disclose payment status.
 H7 Insurers would object to or block AI callers.
 (Add industry-specific hypotheses at the end.)

PRODUCE, IN THIS ORDER (keep the lettering so outputs can be compared across industries)
A. Money flow map. Who delivers the service, who owes (the legal debtor), who pays, who is paid, and what instrument carries payment (EFT, cheque, joint cheque, program deposit). Show each variant that exists (for example insured pays and is reimbursed; direct billing; assignment). One diagram in text.
B. Document and identifier chain. Every document and identifier from first contact to final payment (claim number, invoice number, authorization, policy and certificate, vehicle or property identifiers, program client numbers), who issues each, and how they relate (one claim to many invoices, one payment to many invoices, supplements, reissued cheques).
C. Clocks. Every statutory, regulatory, program or contractual deadline that affects when money is due, when it is late, when it is lost, or when a dispute must be filed. Quote each. Give the consequence of missing it. Flag any whose application is unclear.
D. Channels and systems. For each interaction with the payer (submit, status, remittance, dispute, preauthorize), which channel is used, what systems each side runs (billing software, payer portals, clearinghouses, adjuster platforms), and what each channel cannot do.
E. Failure modes. The reasons claims and invoices are late, short-paid, denied or lost, ranked by evidence, with frequency data where it exists. For each, who has to do what to resolve it and by what channel.
F. Who does the work. The roles that chase payment today, their tools, time spent, outsourcing options and cost, with sources. Include what happens when no one chases.
G. Escalation ladder. The real steps a business takes when an insurer does not pay: internal, payer escalation, regulator or ombudsman complaint, tribunal or court, collection agency or lawyer, write-off. The rules and typical timing at each step. Include the cheapest and most common step actually used.
H. Counterpart behavior. For each payer cluster the industry deals with, how reachable and cooperative it is by phone, what it will and will not disclose to a provider or its agent, its authentication requirements, hours, and any stated policy on third-party or automated callers. Evidence only.
I. Quantitative anchors. Days to pay, share of claims needing follow-up, denial and short-pay rates, DSO, number of businesses in Ontario. Each with definition, year and source, or NO DATA.
J. Where a person still has to phone. A list of specific situations, each with evidence, and the share of cases if known. Also list situations where phone is NOT needed because a portal or electronic channel covers it.
K. Existing alternatives. Software, billing agents, revenue cycle vendors, factoring, collection agencies, association services, and what each costs and covers. Note anything that already automates payer follow-up (calls, portals, status checks).
L. Disconfirming evidence. Everything found that suggests a phone-based AR follow-up product is unnecessary, unwanted, unlawful or unsafe in this industry.
M. Hypothesis scorecard. H1 to H7 and the industry-specific ones, each CONFIRMED, REFUTED or INSUFFICIENT EVIDENCE with the evidence.
N. Scope implications. Do not recommend features. State, as plain facts derived from sections A to M: what entities the data model would have to represent (cases, invoices, parties, instruments); what rules would have to be encoded as data; what must always go to a person; what counterpart types and routes exist; what identifiers the caller must hold; what is unknown. Mark each implication with the section it comes from.
O. Unknowns and the next five things to read. Sources a person should open and read in full.

OUTPUT
A single markdown file named after the industry. Then a claims table (claim, tag, source, date) and a list of pages you could not access.
```

Optional parallel sources the researcher may use if available: Statistics Canada business counts; FSRA statistics and published reports; Licence Appeal Tribunal published caseload data; Ontario Ministry of Health ADP and ODB provider manuals; WSIB provider policies; insurer provider manuals; trade association guides; billing software vendor documentation; published complaint and ombudsman data.

---

## Prompt 2: cross-industry synthesis (run after the six deep dives)

```text
ROLE
You are the synthesis analyst. You receive six industry reports written to the same template (sections A to O). Do not research anything new unless a gap blocks a conclusion; if so, say what you looked up and tag it.

RULES
Use only claims in the reports. Preserve their tags. If two reports conflict, show both and do not resolve silently. Distinguish what is common to all industries from what differs. Do not use em or en dashes.

PRODUCE
1. Common spine. The money-flow steps, identifiers, documents and clocks that appear in every industry. State them as a normalized chain.
2. Divergence table. For each of the six industries, how it differs from the spine on: who owes, who pays, instrument, identifier structure (claim to invoice to payment cardinality), clocks, dominant failure modes, dominant channel, counterpart reachability, who does the work.
3. Where phone matters. A ranked list of situations across industries where a person must phone, with the evidence and the share where known; and a list of situations where phone is not the bottleneck.
4. Hypothesis scorecard across industries (H1 to H7).
5. Scope implications. For each, cite the sections it comes from:
   a. Entities and cardinalities the shared data model must represent (cases, invoices, payments, parties, instruments), and which are industry-specific.
   b. Rules that must be data (clocks, thresholds, stop points), by industry.
   c. Counterpart types and the contact routes each has.
   d. Identifiers a caller must hold, per industry.
   e. Always-human situations.
   f. Channel facts that decide whether a phone workflow has any role at all.
6. Disconfirming evidence summary: what the research says against building, by industry.
7. Open questions that only primary reading or a conversation with an operator can answer, ranked by how much each would change scope.
8. A consistency check: list any place where this synthesis, if adopted, would contradict ARCHITECTURE-PROPOSAL.md sections 5, 17 or 18, or CORE-ARCHITECTURE-AND-BUILD-SPEC.md, quoting the conflicting statement.

OUTPUT
One markdown document with sections 1 to 8, then a claims table with tags carried over from the reports.
```

---

## How the outputs feed the build

| Output | Feeds |
|---|---|
| Prompt 1 sections A and B | Ledger kernel fields and cardinalities (B4a), extension tables (B4b), identity bundles (B8) |
| Section C | Policy pack parameters and their evidence tags (B3), forced handoff triggers (B6) |
| Section D, H, J | Contact routes and call profiles (B5), the decision whether a module has a phone role at all |
| Section E, G | Objective packs and typed outcome schemas (B6), escalation and handoff rules |
| Section F, K, L | Demand model, pitch boundary, kill criteria |
| Prompt 2 items 5 and 8 | Confirm or correct the core inclusions in CORE-ARCHITECTURE-AND-BUILD-SPEC.md before Stage 1 builds start |

Decision rule proposed: no module is added to the build plan until its Prompt 1 report exists, its Section M scorecard shows H1 and H6 are not REFUTED, and its Section L contains no evidence that the activity is unlawful or unsafe without a licence the business does not hold.
