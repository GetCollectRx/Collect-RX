# Master prompt: one engagement, all industries, one combined report

Date: 2026-10-16. Paste everything inside the fence into ONE session. This replaces running the primer, six deep dives and the synthesis as separate chats. Everything lands in one place: a single combined report with a resume ledger, so nothing is lost between parts.

Best run in a session that can browse and can write files. If it can write files it saves each part as it goes. If it cannot, it prints each part in full and you type "continue" between parts; the ledger at the top of every message lets a new session resume where the last stopped.

```text
MISSION
You are producing ONE combined research report on how insurance and insurance accounts receivable work in Ontario, and how six industries actually collect what insurers and insurer-funded programs owe them. The report sets the scope of a software product that phones insurers to check on and chase unpaid claims and invoices. There are FIVE defined industries plus one optional sixth that you identify. They share one engine, so the value of this work is in what they have in common, how they differ, and where a person still has to phone. You must also look for evidence that this product is NOT needed. Find the truth; do not support the product.

THE INDUSTRY LIST (five defined, one optional). You will cover every defined industry, and the optional one if you can justify it, in this order, using the same template for each:
1. Dental
2. Auto rehabilitation and allied health
3. Property restoration and emergency housing
4. Collision repair, towing and storage
5. Equipment, pharmacy, hearing and disability programs
6. Optional: one missing industry you identify and justify

INDUSTRY 1 DEFINITION
INDUSTRY: Dental practices in Ontario (solo practices, group practices and dental service organizations, specialty practices). Payers: private group benefit insurers and administrators (Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare as a clearinghouse for several plans), the federal Canadian Dental Care Plan, Healthy Smiles Ontario, ODSP and Ontario Works dental benefits, and the Non-Insured Health Benefits program. Cover direct billing, patient reimbursement, assignment, dual coverage, pretreatment estimates and predeterminations.

INDUSTRY 2 DEFINITION
INDUSTRY: Auto rehabilitation and allied health clinics in Ontario (physiotherapy, chiropractic, massage therapy, occupational therapy, psychology, other regulated and non-regulated providers; multidisciplinary clinics and sole practitioners). Payers: auto insurers under Ontario's Statutory Accident Benefits Schedule (treatment plans and invoices submitted through the health claims system), WSIB for workplace injuries, private extended health and group plans, and any other payer you find. Cover insured-person versus provider billing, direct payment rules, who is paid directly, and licensing conditions for provider payment.

INDUSTRY 3 DEFINITION
INDUSTRY: Property restoration and emergency housing businesses in Ontario (water, fire and mold mitigation contractors, reconstruction contractors, contents handling, and emergency or temporary accommodation providers for displaced insureds). Payers: home and commercial property insurers, adjusting firms and third-party administrators, insurer-managed contractor networks, and insureds paying deductibles. Cover adjuster-led files, estimates and supplements, progress and final invoices, holdbacks, joint-payee cheques, direction to pay versus assignment, and how construction payment rules interact with insurer funding.

INDUSTRY 4 DEFINITION
INDUSTRY: Collision repair shops, towing operators and vehicle storage yards in Ontario. Payers: auto insurers (collision, comprehensive and third-party liability claims), insurer direct-repair programs, police-directed tow programs, vehicle owners for deductibles and uninsured amounts. Cover multiple businesses working on one claim, repairs plus supplements plus towing plus accruing storage, lien and consent rules for repair, towing and storage, published towing rates, total losses, and who is paid when the insurer and the owner both have rights.

INDUSTRY 5 DEFINITION
INDUSTRY: Providers of medical and assistive equipment, hearing care (audiologists and hearing instrument practitioners), orthotics and prosthetics, pharmacies, and disability-related goods and services in Ontario. Payers: the Assistive Devices Program, ODSP, WSIB, Veterans Affairs Canada, the Non-Insured Health Benefits program, Ontario Drug Benefit and related drug programs, and private group and disability plans. Cover preauthorization and prior approval as a distinct process, vendor registration and electronic claims requirements, patient share rules, and audit and recovery.

INDUSTRY 6 DEFINITION
INDUSTRY: Identify one insurance-facing industry in Ontario that is missing from this list: one where businesses regularly wait on insurers or insurer-funded programs to be paid for goods or services. Name it, justify the choice with sources, then complete the template for it.

WORKING METHOD (follow in order; do not skip a step)
Step 0. Create the RESUME LEDGER (format below). Confirm the plan in two lines, then start. Do not ask me questions. If you need a decision, choose the stated default and log it in the ledger.
Step 1. Write PART 1, the primer, using the PRIMER SPEC.
Step 2. For each industry in the INDUSTRY LIST, write one report using the INDUSTRY TEMPLATE. Treat each industry as an independent investigation: do not copy findings from an earlier industry into a later one, and test every hypothesis afresh. Cross-industry comparison happens only in Step 3.
Step 3. After all industries are done (Part 7 may be marked SKIPPED), write the SYNTHESIS using the SYNTHESIS SPEC, working only from the industry reports.
Step 4. Assemble the combined report in the order given under FINAL OUTPUT.

PERSISTENCE RULES (nothing lives only in the chat)
 - If you can write files: create a folder insurance-ar-research/ and save after EVERY part: 00-ledger.md, 01-primer.md, 02-dental.md, 03-auto-rehab-allied-health.md, 04-property-restoration.md, 05-collision-tow-storage.md, 06-equipment-pharmacy-hearing-disability.md, 07-optional.md, 08-synthesis.md, and finally 99-combined-report.md. Update 00-ledger.md after every part.
 - If you cannot write files: end every message with the full RESUME LEDGER and the complete text of the part you just wrote, labelled "PART n of 9". Stop after each part and wait for me to type "continue". A later session must be able to resume from the ledger plus the saved parts alone.
 - Keep a running claims log in the ledger (claim, tag, source URL, access date). Build the final claims table from it; do not rebuild it from memory.

RESUME LEDGER (keep this current at the top of every message and in 00-ledger.md)
 - Plan: parts 1 to 9 with status NOT STARTED, IN PROGRESS, DONE.
 - Decisions taken (with the default used).
 - Sources that could not be opened (URL and reason).
 - Open contradictions between sources.
 - The claims log.
 - Next action.

EVIDENCE RULES (apply to every part)
1. Prefer primary sources: statutes and regulations, regulator guidance and forms, payer provider manuals and billing guides, tribunal and court decisions, official statistics. Then professional associations and standards bodies. Then vendor documentation for billing software. Then practitioner commentary and forums.
2. Tag every factual claim: PRIMARY (you read the primary document and can quote it), SECONDARY (a reputable summary of a primary source), ANECDOTE (say who, where, when, and how many independent sources), or UNVERIFIED (inference or recollection).
3. Quote exact words for any rule, deadline, number or definition, with the URL and the date you accessed it. Never invent a section number, form number, figure or quotation.
4. Statistics need a definition, population, year and source; otherwise write NO DATA.
5. Record contrary evidence. Do not hide findings that undercut the obvious story.
6. If a page is blocked or needs a login, say so and move on. Do not guess its contents.
7. Do not size a market. Counts of businesses are allowed if sourced.
8. Do not use em dashes or en dashes anywhere.

PRIMER SPEC (PART 1)
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

INDUSTRY TEMPLATE (PARTS 2 to 7; apply to each industry in the INDUSTRY LIST; keep the lettering A to O so industries compare)
ROLE
You are a research analyst producing a grounded, source-tagged picture of how one industry gets paid by insurers today. The output sets the scope of a software product that phones insurers to check on and chase unpaid claims and invoices. You must also look for evidence that this product is NOT needed. Your job is to find the truth, not to support the product.

INDUSTRY
(The industry currently being worked, taken from the INDUSTRY LIST below, including its typical business, payers and sub-segments.)

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

SYNTHESIS SPEC (PART 8)
ROLE
You are the synthesis analyst. You receive the industry reports (five, or six if the optional one was done) written to the same template (sections A to O). Do not research anything new unless a gap blocks a conclusion; if so, say what you looked up and tag it.

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

FINAL OUTPUT (PART 9: the combined report, in this order)
1. Executive summary (one page): the common spine, the three biggest differences between industries, where phone matters most, the strongest evidence against building, and the five questions that would most change scope.
2. The primer (Part 1).
3. The industry reports (Parts 2 to 7; mark Part 7 SKIPPED if no sixth industry was added), each complete with sections A to O.
4. The synthesis (Part 8).
5. The master claims table (claim, tag, source, date), from the ledger.
6. Pages that could not be accessed, with reasons.
7. A one-page index showing which section of which part answers each question in the SYNTHESIS SPEC.
```

Optional sources if available: Statistics Canada business counts; FSRA statistics and published reports; Licence Appeal Tribunal published caseload data; Ontario Ministry of Health ADP and ODB provider manuals; WSIB provider policies; insurer provider manuals; trade association guides; billing software vendor documentation; published complaint and ombudsman data.

## Use of the output

Bring the combined report back (or commit it to the repo). It is checked against ARCHITECTURE-PROPOSAL.md sections 5, 17 and 18 and CORE-ARCHITECTURE-AND-BUILD-SPEC.md before any scope decision.
