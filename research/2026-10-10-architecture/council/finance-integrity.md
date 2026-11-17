# Council review: finance and data-integrity lens (2026-10-13)

Reviewer: FINANCE AND DATA-INTEGRITY seat (accounts receivable, reconciliation, audit).
Scope read: council brief; ARCHITECTURE-PROPOSAL.md sections 3.5, 5.4 to 5.9, 8, 10 (WP-2, WP-3), 11, 12; EVIDENCE-BACKED-FEATURES.md; feature-research/buyer-requirements-and-workflow.md (pricing and legal lines); domain-research/primary-source-read-2026-10-11.md; and the code listed below.
Evidence labels: CODE (file, line read), SOURCE (research file quote, excerpt-grade only, nothing verified on source pages), REASONING, OPINION. No code was changed and nothing was run.

Code read: Collect-RX-main/src/server/recovery/paymentVerification.ts, partialPaymentHandler.ts, transitionClaimRecovery.ts, recoveryMetrics.ts; src/services/insurance-analytics.ts; src/routes/analytics.ts; src/server/reports/weeklyPilotReport.ts; src/server/pms/prismaClaimImporter.ts, absentClaimHandler.ts, claimRowMerge.ts, pmsImportPipeline.ts, importValidation.ts; src/pages/LandingPage.tsx; src/website/pricingContent.ts; prisma/schema.prisma (ClaimRecoveryEvent, InsuranceClaim, PmsImportRun).

---

## 1. Headline findings

1. The proposal is right that "recovered" is not attribution, but it understates the problem. There are **three different "recovered" numbers in the shipped product**, and the worst one is emailed to customers and is not mentioned in the proposal (finding A3 below).
2. The proposed attribution classifier has a structural flaw: it treats "the payer promised to pay" as evidence that the call caused the payment. A promise is evidence the payer was already going to pay. See section 3.
3. The organic/assisted split depends on a "program's normal expected-pay window" that does not exist as data, and the research file says no days-to-pay figure was found for any Ontario domain. The classes would be built on an invented baseline.
4. P8's cut of the remittance table is defensible for now, but "no party table" and "no remittance table" together leave a real hole for the exact scenario the proposal uses as its showcase (section 8.1, one cheque over four invoices). The hole is smaller than it looks if one thin row is kept (section 4).
5. Success-fee pricing should not be offered until attribution has survived a customer audit, and the legal question is open (section 8).
6. The fixed 18 minute baseline should be dropped, not relabeled. And the product already contradicts itself: the landing page prices savings at **50** minutes per call, the dashboard computes **18**, the pain stats say "6 hrs" per week with no source.

---

## 2. Is the current "dollars recovered" defensible? What exactly does it overstate?

Short answer: the dental gate in `paymentVerification.ts` is a real improvement over "any balance drop" and is honest as "balance fell to zero while something said insurance was involved". It is **not** defensible as "dollars CollectRx recovered". It overstates in six specific ways, and understates in two.

### A. Overstatements

**A1. Evidence is a status or a cumulative field, not evidence about the dollars that moved. (CODE)**
- `paymentEvidenceFor` (paymentVerification.ts:37-44) returns `carrier_confirmed` if `claim.status` is RESOLVED or APPROVED_PENDING_PAYMENT (line 22), else `insurance_payment_in_export` if the row's `insurancePaidAmount > 0` (importer line 244).
- `insurancePaidAmount` is the cumulative insurer-paid amount on the claim row (claimRowMerge.ts:81 sums it across lines). Any claim that was part-paid by the insurer long before CollectRx touched it carries `insurancePaidAmount > 0` forever. If the remaining balance is later zeroed by a patient payment, write-off, or contractual adjustment, the evidence test still passes and the **entire final delta is credited as recovered** (line 63-66 computes delta as previous minus new outstanding, line 93 gate, line 97-101 event).
- The status route has the same flaw: APPROVED_PENDING_PAYMENT means a carrier said "approved". Later the balance goes to zero for any reason, and it is credited. The comment at lines 14-21 says a drop counts only when "something independent says insurance paid". The code checks that insurance was involved on the claim, not that insurance paid **this** amount.

**A2. No requirement that CollectRx did anything. (CODE)**
- `PAYMENT_VERIFY_STATUSES` (lines 5-12) includes IN_QUEUE, CALLING, ON_HOLD and ESCALATED. A claim that was imported, queued, never called, and then paid on the insurer's normal schedule is credited in full. The proposal already notes this (3.5 D). Adding to it: PENDING and DENIED are **not** in the list, so a PENDING claim that is fully paid with real insurer evidence falls through to `handlePartialPaymentSync` (line 113), is not credited (fine) but is also not closed: `partialPaymentHandler.ts:180-185` computes route from `newOutstanding > previousOutstanding * 0.5`, which is false at zero, so route becomes WAIT_SYNC with `outstandingAmount: 0`, and an "Partial payment, verify remaining balance" action is opened (line 206-228) for a claim with nothing remaining. That is a bookkeeping defect, not an overstatement, but it will produce confusing staff tasks and an event with a misleading name.

**A3. The emailed weekly report uses a different, much weaker definition. (CODE) Not in the proposal.**
- `weeklyPilotReport.ts:63-67`: `revenueRecovered` = sum of `claim.billedAmount` for every **call attempt** whose outcome is RESOLVED in the window.
  - Billed amount, not outstanding amount or any payment amount.
  - Per attempt, not per claim: a claim with two RESOLVED attempts is counted twice.
  - RESOLVED is a call outcome ("carrier says it is handled", which includes "already paid last month"). No payment evidence is required at all.
  - It is rendered as "Revenue recovered" in an email to the customer (line 98).
- This is the single most dangerous number in the product from a defensibility standpoint, because it goes out unprompted and it is the easiest to contradict with the customer's own bank deposits.
- "Staff phone time saved" in the same email (line 99) is the sum of bot call duration, including time practice staff were themselves on the line in Hold Sentinel mode.

**A4. Two dashboard figures, one of them mislabeled. (CODE)**
- `routes/analytics.ts:69-70` returns `callOutcomeRecovery: dollarsRecovered` and `dollarsRecovered`: the **same variable** under a field name and comment ("Call-outcome based, may differ from PMS sync verification") that describe something else. `pages/Analytics.tsx:201` prefers `callOutcomeRecovery`. The header comment of `getDollarsRecovered` (insurance-analytics.ts:7-8) still says "Sum of outstandingAmount for claims resolved in the window", which the code does not do. Three descriptions, one implementation.
- Separately `recoveryMetrics.ts` computes a lifetime verified sum and divides by (verified + open AR) as "recovery rate"; it is flagged deprecated in a comment, but still computed.

**A5. No idempotency, no reversal, so double credit is possible. (CODE + REASONING)**
- `ClaimRecoveryEvent` has no unique key and no import run id (schema.prisma:868-884).
- `upsertInsuranceClaim` (importer) updates `outstandingAmount` on every import but never touches `status` (update block, line 79 onward) and the "existing balance was zero" case returns `previousOutstanding = 0`, which makes `verifyPaymentFromSyncUpdate` return null at line 58. So: claim paid and credited (status RESOLVED, outstanding 0); staff later re-upload an **older** file (or the PMS reverses a payment, which is how recoupments and NSF cheques show up) and the balance goes back up with no event; the next normal import shows zero; `previousOutstanding > 0`, status is RESOLVED (in the gate), evidence is `carrier_confirmed` by status alone, and a **second** PAYMENT_VERIFIED_SYNC is written for the same money.
- Reversals are never netted: there is no negative event. REASONING: premise is that payers do recoup overpayments, and the proposal's own `refund_or_reversal` allocation kind concedes it. Today's sum can only go up.

**A6. Time of event is import time. (CODE)**
- `getDollarsRecovered` windows on `createdAt` of the event (insurance-analytics.ts, the `createdAt: { gte, lte }` filter), which is when the file was imported, not when money moved. A quarterly import can put three months of receipts in one week. Month-over-month comparisons and any fee base derived from windows are unreliable.

### B. Understatements (so "overstated" is not the whole story)
- **B1.** Partial payments are never credited: `PARTIAL_PAYMENT_SYNC` is not in any sum. When the last chunk finally zeroes the claim, only that last delta (previous outstanding at the last import) is credited. A claim paid 70/30 in two steps credits 30.
- **B2.** Fully-paid claims that arrive with an `outstanding <= 0` row and no insurer-paid column, and are not in a RESOLVED status, are filed as `BALANCE_CLEARED_UNVERIFIED` (lines 70-91), including genuine insurer payments from exports that simply do not carry an insurer-paid column. For practices whose export lacks that column, the dollar figure will be near zero. That is honest but means the metric is export-schema dependent and is not comparable across customers.

### C. What it can be called today
- Defensible: "Balance cleared on claims that had insurer involvement; verified by your own import", labelled as **receipts**, with the evidence level shown per claim (`carrier_confirmed` vs `insurance_payment_in_export`), and with the three named defects above fixed. Not defensible: "dollars recovered", "revenue recovered", anything with "by CollectRx".

---

## 3. Are the proposed attribution classes and payment-allocation design sound?

Proposal 5.7 and 5.9: `payment_allocations` (kind, evidence_kind, reconciled) and `recovery_attributions` (attributed / assisted / organic / unclassified, windowed, rule-versioned).

### What is right (keep)
- Splitting **verified receipts** from **attributed recovery** and never showing them as one number. Right instinct, and the single most valuable change.
- Allocation kinds that separate payment from adjustment, write-off, reversal. Right, and A1 above shows why it matters.
- `balance_delta_only` as an evidence tier that can never count. Right.
- Historic events relabelled `legacy_unclassified` and left immutable. Right.

### What is wrong or fragile

**S1. "Payment promised" cannot prove causation (REASONING).** Rule for `attributed`: "A CollectRx call produced a documented payment commitment or a corrected-status action ... payment issue date is after that call and inside the window". A rep saying "that one is in this Friday's payment run" is the payer describing a payment that was already scheduled. The call changed nothing. Only a **payer-side corrective action prompted by the call** is plausible evidence of an effect: claim found not received and resubmission requested; missing document identified and later supplied; wrong payee corrected; adjuster assigned and acknowledged. Even those have counterfactual doubt (the practice might also have noticed). Recommendation: `attributed` requires a typed `corrective_action` fact; a bare `payment_promised` or `payment_issued` is `assisted` at best.

**S2. "Amount matches within tolerance" is a weak link (REASONING).** Many invoices share round amounts (a periodic therapy invoice, a repeated tow fee). Amount-only matching will credit coincidences. Require payment reference or a cheque/EFT number match for `attributed`; amount-only goes to `assisted`.

**S3. The organic rule needs a baseline that does not exist (SOURCE + REASONING).** `organic` = "within the program's normal expected-pay window of the invoice date with no intervening commitment". SOURCE: EVIDENCE-BACKED-FEATURES.md section 1, "No hours, days-to-pay, write-off or short-pay figure for Ontario in any domain." The only candidate windows are statutory: SABS 30 days after invoice (O. Reg. 34/10 s. 38(15), SOURCE primary-source-read), Construction Act 28 days for a proper invoice. Those are legal deadlines, not observed behaviour. The first honest baseline is the customer's **own history** per payer (median days-to-pay on invoices paid before CollectRx started), which needs a pre-period export. Without it, `organic` vs `assisted` is a guess presented with a rule version.

**S4. The classifier cannot see the practice's own follow-up (REASONING).** Practice staff also phone payers, resubmit, and send statements during the same window. None of that is in the data. Every attribution therefore overstates by the share that would have happened anyway. This is the main reason no classifier can honestly produce a causal dollar figure, whatever the rules.

**S5. Over-engineered for a product that never touches the money (OPINION, reasoning below).** Reasoning: CollectRx does not receive, hold or disburse funds (CLAUDE.md product boundary; patient payment collection retired). Its ledger is therefore a **shadow ledger of the customer's own books**, learned from exports, staff confirmation and rep statements. Its only legitimate jobs are: stop calling invoices that are paid; show the customer what was paid after engagement; and keep a defensible record of what CollectRx did and said. Rule-versioned four-class attribution with window parameters implies a precision that the data cannot support, and it will be read by customers (and, under a success fee, by their accountants) as an accounting statement. A single causal-sounding number is more dangerous than two plainly labelled counts.

**S6. Under-engineered in three places (REASONING).**
- No `interest_or_late_fee` or `tax` allocation kind. SABS interest is 1 percent per month compounded on overdue amounts (SOURCE: primary-source-read, O. Reg. 34/10 s. 51(3)); payers sometimes pay principal plus interest in one cheque. Counting interest as "recovered invoice dollars" overstates. Add `interest_or_fee`.
- Holdback (10 percent, Construction Act s. 22(1), SOURCE) and later holdback release for restoration: the proposal has `holdback_release` as an allocation kind but no holdback concept on the receivable, so a progress invoice paid at 90 percent will look like a short-pay or like "paid" depending on the exporter. Pure outstanding-vs-paid cannot distinguish.
- Allocation rows carry a mutable `reconciled` boolean and the receivable carries a stored `outstanding_cents` described as "a computed projection". A ledger that may later underpin a fee must be **append-only with corrections as reversing entries**. Mutable flags will not survive an audit. State this now in the design, not after launch.

### Verdict on 5.7/5.9
SUPPORT WITH CHANGES. Keep two reported numbers and the allocation-kind separation. Replace the four-class classifier with evidence-tiered receipts plus a typed, staff-confirmable list of "invoices where the payer took a corrective action after our call and was then paid". See the alternative design in section 10.

---

## 4. Minimum ledger a non-dental module needs; does P8 leave a hole?

### Minimum set of facts (not tables) a non-dental module needs
1. **Invoice identity that is not the claim number.** `(tenant, source, invoice_number)` plus an optional case/claim reference. CODE: today `mergeClaimRows` (claimRowMerge.ts:231-255) sums every row sharing a claim number into one claim. Correct for dental lines; wrong for a collision claim with repair, supplement, tow and storage invoices. Also `InsuranceClaim` has a unique `(practiceId, claimNumber)` (importer upsert key), so a second invoice under the same claim number **overwrites** the first. This is the hardest blocker for W5 and arguably W4, and is not needed for W1.
2. **Balance as-of snapshots, not only the current balance.** One row per invoice per import run: billed, outstanding, as-of date, run id. This is what lets a later audit say what changed between files, and it makes A5 (replayed older file) detectable. Today only `previousOutstanding` is kept on events.
3. **A payment fact.** Amount, payer, payment reference (cheque or EFT number), payment date, evidence tier. One payment can cover many invoices; one invoice can be paid by many payments (partials, supplements).
4. **An allocation of a payment to an invoice**, with a kind: insurer payment, patient or customer payment, adjustment, write-off, reversal, interest or fee, holdback release.
5. **Adjustment is not payment.** Contractual write-down, short-pay, rejection must never be summable into receipts. This is the lesson of A1.
6. **Who owes versus who was called.** Legal debtor and payer-contacted can differ (restoration: policyholder owes, adjuster is called). Needed to decide who may be called and who the dollars belong to.

### Does P8 leave a hole?
- **Remittance table (cut).** Hole is conditional. The proposal's showcase (8.1) is one cheque `CHQ-55120` for $4,310 over four invoices. Without a header row you cannot check "sum of allocations equals the cheque total", cannot detect an unallocated remainder, and cannot say "this $4,310 was one event" in a fee statement. But the proposal itself lists as unresolved (item 8, section 13) whether tenants can even export remittance advice. REASONING: build nothing until one real customer export shows what arrives. Compromise: put `payment_ref`, `payer`, `payment_date`, `payment_total` as **columns on the allocation row** (repeated per invoice), which is a denormalised header. If remittance data appears, normalise then. Cost of being wrong is low because allocations are append-only.
- **Party table (cut).** Fields suffice for the ledger if two columns exist on the invoice: `legal_debtor_text` and `payment_recipient_text` (both free text plus an optional token). A table is justified only when the same party must be reused across invoices with consent or authorization attached; evidence for that is Tier C. The compliance side (who may be spoken to) belongs to the capability/authorization design, not the ledger. SUPPORT the cut.
- **Accrual schedules (cut).** Fine. An accrual is a derived number that changes daily; any dollar figure shown from it will be disputed. Treat storage/accommodation as invoices with a stated amount as-of date.
- Net: P8 is acceptable **if** the allocation row carries the payment header columns and the append-only rule is adopted. It leaves a hole only if you also drop allocation rows entirely and keep the dental one-claim-one-balance model for W2/W5.

### Does P6 (about eight shared entities) hold?
OPINION with CODE: M1 in the proposal (section 9) creates **23 tables** in one step (payers, payer_programs, policy_packs, contact_routes, authorization_grants, import_sources, import_coverage, insurance_cases, receivables, receivable_lines, accrual_schedules, parties, case_party_roles, remittances, payment_allocations, recovery_attributions, recovery_tasks, call_facts, capability_grants, case_evidence, preauthorizations, callback_expectations, practice_verticals). That contradicts P6, P8 and the Tier C list. The money-bearing subset I would accept before first non-dental money report: receivable (or reuse InsuranceClaim for W1), balance snapshot, payment_allocation (with header columns), import_source. Four, of which one is only needed for W2/W5.

---

## 5. Can imports be reconciled safely without a source-coverage concept?

Short answer: **no, not for any second source**, but the full `(source, entity kinds, date window, location ids, complete)` coverage concept is more than the evidence requires.

CODE facts:
- `closeClaimsMissingFromFullExport` (absentClaimHandler.ts:41-92) selects open claims by `practiceId` only (line 46-55) and compares with the claim numbers in the file. With a second feed, every open item owned by the other feed is "missing" and set to `recoveryRoute = STOP`.
- The mass-absence guard (lines 21-22, 60-69) only trips at 10+ missing **and** more than 50 percent. A customer with 8 open items per feed, or a feed that legitimately holds 30 percent of items, will be silently stopped. Small tenants are the typical customers in W1 to W5.
- `exportScope === 'full'` is a per-run caller flag (pmsImportPipeline.ts:~185). Nothing records who asserted it or against what.
- The reopen path `reopenIfReappeared` reads only the single latest event (absentClaimHandler.ts:104-109) and restores a route from metadata; any event written after the absence event (e.g. a note) makes the reappearance undetected.
- Absence is not credited as recovered (good, CODE: only `STOP`, no payment event).

What is the minimum safe design (OPINION with reasoning)? Three rules, not a coverage model:
1. **Every receivable carries `import_source_id`; absence logic is scoped to that source.** That alone removes the cross-feed closure hazard.
2. **A per-source "this feed is the complete open-item list" setting made once at source setup**, not a per-run flag; recorded with user and time.
3. **Absence never stops calls on its own for money above a threshold; it opens a staff confirmation** (proposal's `suspected_settled`, which is right). Add the proposal's per-source baseline check (rows now vs median of last runs).

Date windows, location ids and entity-kind coverage can wait until a customer actually exports partial windows. EVIDENCE-BACKED-FEATURES lists CSV mapping for non-dental verticals as unevidenced, so this is speculative until a real export exists. The proposal's section 5.8 is therefore right in direction and over-built in detail.

Related correctness check (CODE): `validateImportTotals` compares record count and balance total drift, 1 percent default (importValidation.ts:16, 18-49). `sourceBalanceTotal` defaults to the imported total when the caller does not supply a control total (pmsImportPipeline.ts, `options.sourceBalanceTotal ?? importResult.importedBalanceTotal`), so the check is **vacuous unless the customer or connector supplies a control total**. Say so in any reconciliation claim.

---

## 6. What may and may not the marketing claim about savings?

The legal frame is OPINION from general knowledge, not verified in this session: Canada's Competition Act requires performance claims to be based on adequate and proper testing. Treat that as a question for counsel. The factual frame is from CODE.

### May say (today, if worded as stated)
- "CollectRx logs the phone time it spends on IVR menus and hold queues on your behalf." Only once hold seconds are persisted (proposal 3.4 says they are not reliably stored). Until then, say nothing numeric.
- "Your dashboard shows payments that arrived on claims CollectRx was following, as reflected in your own imports." (Receipts, evidence level shown.)
- "Calls placed", "claims reached a resolution on the call", counts. These are counts of events, not dollars.
- Tier A statements in proposal 12.1 about tokenization and isolation, subject to their own verification.

### May not say
| Claim | Why (evidence) |
|---|---|
| "CollectRx recovered $X for you" | No attribution exists; today's figure counts payments on claims never called (A2), non-insurer drops (A1), and can double count (A5). |
| "Revenue recovered" in the weekly email | It sums billed amount per RESOLVED call attempt (weeklyPilotReport.ts:63-67). |
| "When a claim balance drops on re-import ... verified recovery" (LandingPage.tsx:1620) | This does not match the code either way: a drop alone is explicitly not credited when it clears to zero without evidence (paymentVerification.ts:70-91). The copy describes the old rule. |
| "$47K average outstanding", "6 hrs per week", "18% of claims past 90 days are written off" (LandingPage.tsx:1141-1145) | No source anywhere in the repo or the research files. A specific percentage presented as a fact. Remove or footnote with a real source. |
| "Staff time freed ~$X (calls x 50 minutes)" (pricingContent.ts:5, LandingPage.tsx) | 50 minutes per call, versus 18 in analytics. Neither measured. |
| "Saves 18 minutes per call" | Counts every attempt with a non-null outcome, including no-answer and hang-ups (insurance-analytics.ts:85). |
| Any ROI or payback figure | Needs both a defensible benefit and a defensible baseline; neither exists. |
| "Works across rehab, auto, restoration..." | Section 12.2 of the proposal; agreed. |
| Any statement that payers accept automated callers | SOURCE: EVIDENCE-BACKED-FEATURES: unknown. |

The illustrative-calculator ("Run your numbers") is acceptable as a clearly labelled **user-input calculator** (the customer enters their own hourly cost and call count) and not as a default-filled claim.

---

## 7. Time-saved measurement: the fixed 18 minute baseline

### What is wrong (CODE)
- `AVG_MANUAL_CALL_MINUTES = 18` (insurance-analytics.ts:26) times every attempt with `outcome != null` (line 85). Counts no-answer, hung-up, voicemail and calls staff took over.
- Hold Sentinel is the product sold first (CLAUDE.md, ADR 0003): when a rep answers the staff member talks. Hold-wait is the saving; the conversation is not. 18 minutes charged to the call for a conversation staff then had anyway overstates.
- The number does not vary by carrier, claim type or whether the payer line queue was 4 minutes or 55.
- Three inconsistent baselines coexist: 18 (dashboard), 50 (`STAFF_EQUIV_MINUTES_PER_CALL`, landing page and pricing), 6 hours per week (landing pain stat). A reviewer comparing the page to the dashboard will see it.

### The proposal's replacement (section 11) and my view
It is good on structure (machine time, staff participation, review work, estimated baseline, net). Two problems:
- The "manual-equivalent baseline ... configured per objective and payer program" is another assumption with a nicer name. It sits inside "net staff time saved", so the net inherits it.
- "Review work, a fixed per-type allowance" is an invented number if no task timer exists.

### A defensible alternative
1. **Report only measured quantities as the headline:** "phone time absorbed" = IVR seconds + hold seconds + bot talk seconds, summed over attempts, reported in hours with the number of attempts. Failed attempts included and shown separately as cost, consistent with the proposal.
2. **Report "staff time on the line" next to it** (handoff to call end, already partly stored as `takenOverByStaffAt`). Subtract nothing from the first number; show both.
3. **Offer the customer a calibration, not a constant:** during onboarding ask staff to time ten manual payer calls (start to rep answers) with a simple form, or pull it from their last two weeks. Store the practice's own median hold. The saved-time estimate then becomes `measured hold absorbed` (observed), and the "what a person would have spent" comparison uses **their** median wait per payer, shown as a range (p25 to p75) and labelled estimate.
4. **Never convert to dollars by default.** If a dollar view is shown, it uses the customer-entered loaded hourly cost and says so.
5. **Prerequisite:** persist hold seconds. The proposal says the data is not reliably there (3.4, WP-9 flagged [X] to verify Vapi events). Until it is, the dashboard should show "calls placed" and nothing derived.

---

## 8. Do success-fee prices create incentive or legal problems?

Evidence in hand is thin. SOURCE (feature-research/buyer-requirements-and-workflow.md V21 to V23, excerpt-grade): eAssist "tiered 3.5% to 2.5%" for dental AR; collection agencies charge 20 to 50 percent; US outsourced billing 3 to 10 percent; Ontario Collection and Debt Settlement Services Act, and the research states "Whether a software vendor taking a success fee on recovered insurer payments is a collection agency: NO EVIDENCE FOUND, needs legal advice". EVIDENCE-BACKED-FEATURES rates success-fee pricing WEAK, legal status unverified. I did not find any code that implements a success fee (searched for success-fee, contingency, percent-of-recovered terms in src, docs, schema).

### Incentive problems (REASONING)
1. **The vendor controls the attribution rule and the customer controls the data.** Both sides can move the number: the vendor by choosing windows and tolerances (S1 to S3), the customer by omitting payments from exports or re-labelling them. A fee computed on a classifier with a tunable rule version is a dispute waiting to happen.
2. **Cherry-picking.** Paid-by-percentage pushes calls toward invoices likely to pay anyway (young, undisputed) and away from stuck ones (disputed scope, represented claimants), the opposite of the value a customer wants.
3. **Call volume.** If fee is only on payment, nothing pays for a no-answer; if mixed with minutes, the vendor pays for calls and the customer pays for outcomes; mismatched expectations on attempt caps.
4. **Pressure to over-commit the agent.** A fee-incentivised prompt may push the agent to get a "payment promised" statement; S1 shows that statement is the evidence that triggers `attributed`. P12's controls (closed enums, "unclear") are partly aimed at this; a success fee makes the incentive to bias outcomes real.
5. **Invoice-level privacy.** A fee statement that lists invoices attributed to CollectRx is a document that reveals payer and amount data; fine for the customer, but it increases PHI-adjacent data in a billing artifact.

### Legal exposure (OPINION; needs counsel, not decided here)
- **Collection agency characterisation.** The Ontario Act regulates persons who collect debts for others and, per the research excerpt, applies where debtor or agency is in Ontario. The debtors here are insurers (business payers) and the vendor calls them to ask for payment, paid per recovery. Whether that falls in the licensing definition is exactly the question the research could not answer. The conservative position: do not charge percent-of-recovered until an opinion is in hand.
- **Health-profession fee rules (OPINION).** Some regulated-health colleges restrict fee splitting or percentage arrangements involving a practitioner's billing; the Ontario physiotherapy source in the research stresses the clinician stays accountable for billing under their name. I did not verify any fee rule. Add to the counsel list.
- **Consumer protection / competition law on performance claims** (above): a "we recovered $X" invoice line is also a performance claim.
- **Audit and retention.** A fee relationship means the vendor must be able to reproduce, years later, why an invoice was attributed. That requires append-only evidence plus pack/rule version recorded (the proposal records pack version; good) and call recording or transcript retention long enough, which collides with the privacy goal of deleting call data. State the retention period for fee evidence and for call recordings separately.

### Recommendation
Do not offer success fees in the first non-dental modules. If a performance element is later wanted, the most defensible shape is: flat subscription plus an optional **capped bonus on invoices the customer individually confirms** in a monthly list ("these payments followed a payer correction prompted by a CollectRx call"). Customer confirmation removes the attribution dispute; the cap reduces cherry-picking and the licensing risk surface; and the list is built from the same evidence as the dashboard.

---

## 9. Verdicts on P1 to P13 (my lens; non-financial items flagged)

| P | Verdict | Strongest objection | Evidence | What would change my mind |
|---|---|---|---|---|
| P1 shared engine | CANNOT JUDGE (outside lens); SUPPORT on money grounds | Money-state logic must be shared once, not per module; today three places compute "recovered" | CODE: paymentVerification.ts, insurance-analytics.ts, weeklyPilotReport.ts all compute independently | A single `receipts` service that all three read |
| P2 one prompt per objective, dental frozen | CANNOT JUDGE | Frozen `dental_v1` means dental money outcomes keep the current regex-based outcome mapping until retired; ensure frozen prompt still feeds the fixed evidence gate | CODE: outcome status drives `carrier_confirmed` (paymentVerification.ts:22) | Show that outcome status is written only by typed tools for all packs |
| P3 placement test | SUPPORT | "Payments and receipts" passes it: dental and every other module need it, so it is core | REASONING | none |
| P4 typed attribute fields instead of tables | SUPPORT WITH CHANGES | Money, dates, identifiers, payer and payment references must be **real columns**, not JSON. Reports summing money across modules cannot depend on per-module schemas. JSON only for descriptive attributes | REASONING: audit queries and fee statements must be written once | Evidence that a module has a money field with no common shape (none seen) |
| P5 module contract | SUPPORT WITH CHANGES | Add one clause: a module may not define its own "recovered" or "saved" measure; it supplies evidence, core computes | CODE: A3, A4 show the cost of local definitions | none |
| P6 about eight core entities | OPPOSE as written | The proposal's own M1 creates 23 tables (section 9), contradicting P6, P8 and the Tier C list | CODE/SOURCE: proposal section 9 M1 vs brief P6, P8 | Rewrite M1 down to the four money-bearing tables in section 4 above |
| P7 retirement rule | CANNOT JUDGE | If a module is retired, its ledger rows and any fee statements must remain for audit; retirement must not delete financial history | REASONING | Retention clause in the rule |
| P8 cuts | SUPPORT WITH CHANGES | Party table: fine. Accrual: fine. Remittance table: defensible only if allocation rows carry payment header columns and are append-only. Do not cut allocations themselves. Add `interest_or_fee` kind | section 4 | An export from a real customer showing how payments arrive |
| P9 W1 first | SUPPORT | Good for money too: W1 reuses `InsuranceClaim`, so no new ledger is needed; but this means W1 is a poor test of the ledger. Do not claim the ledger is validated by W1 | REASONING | none |
| P10 build order | SUPPORT WITH CHANGES | "Honest recovery attribution" is listed as a defect fix; the classifier is a feature. Split it: **fix now** = relabel, evidence tiers, drop IN_QUEUE/CALLING/ON_HOLD from the credited statuses (or credit them only as "receipts"), idempotency key on events, replace the weekly report formula, fix landing copy. **Later** = any classifier | CODE: A1 to A6 are each a few lines | none |
| P11 human-assisted launch, graduate on measured criteria | SUPPORT WITH CHANGES | Add a finance criterion: staff-confirmed payment states agree with system-inferred states at a stated rate before a module's dollar figures appear anywhere | REASONING | none |
| P12 hallucination controls | SUPPORT WITH CHANGES | "Each extracted fact appears in the transcript" will fail on spoken numbers ("eighteen twenty", "dollars and forty cents") unless normalised; cheque numbers are poor ASR targets. Read-back plus human confirmation is the real control. Any fact that feeds attribution (payment reference, issue date) must be corroborated by import or staff, not by transcript alone | REASONING | A normaliser with measured accuracy on real transcripts |
| P13 scoped shared knowledge | CANNOT JUDGE (outside lens) | Finance note: cross-tenant "payers pay in N days" benchmarks derived from tenant data are the same sharing problem and also a commercial confidentiality one | REASONING | none |

---

## 10. Concrete alternative design for the weakest proposition (attribution classifier, 5.9)

Weakest from this lens: `recovery_attributions` with four classes and window rules.

**Alternative: evidence-tiered receipts plus a confirmable engagement list. No causal class.**

Data:
- `payment_allocations` (append-only; corrections are reversing rows): invoice, amount, kind (insurer payment, customer payment, adjustment, write-off, reversal, interest_or_fee, holdback_release), payment_ref, payer, payment_date, evidence_tier (remittance > export insurer-paid line > staff-confirmed > balance-delta-only), source_import_run_id, unique key `(invoice, payment_ref or run_id, kind)` so replays cannot double count.
- `engagement_facts`: per call, typed events such as `payer_requested_resubmission`, `payer_found_not_received`, `payer_requested_document`, `payer_confirmed_payment_issued(date, ref)`, `payer_promised_payment(date)`.

Reports (two numbers, one list):
1. **Verified receipts** on invoices engaged by CollectRx: sum of allocations of kind insurer_payment at tier remittance or export-line, dated by payment date, with a per-invoice evidence tier. Excludes adjustments, interest, balance-delta-only.
2. **Receipts after a payer corrective action:** invoices where an `engagement_fact` of the corrective types precedes the payment. Shown as a count and a list; the dollar total is labelled "followed" not "caused".
3. **Confirmation list:** staff tick the invoices they agree followed a CollectRx call. Only ticked items are ever used in a statement, a case study or a fee.

Causal estimate, if ever wanted: a randomised stagger. For the first customers, split eligible invoices at random and begin calls on half at the normal age and half 14 days later; compare days-to-pay. This is the only design that answers "would it have been paid anyway" without a baseline we do not have. It needs consent and a stated rationale; it delays follow-up by two weeks on a subset, which the customer must accept.

Why this is better: fewer tables and rules than the classifier; no invented expected-pay window; no reliance on a rep's promise; replay-safe; and it hands the customer the final say on attribution, which defuses the audit and fee disputes in section 8.

---

## 11. Issues the author missed, ranked by severity

1. **Customer-facing weekly email overstates revenue (HIGH, live today).** weeklyPilotReport.ts:63-67 sums billed amount per RESOLVED attempt. Not in the proposal's list of defects or the build order. Fix or switch off before any pilot sees another one.
2. **Double credit on replayed or older imports; no reversal netting (HIGH).** ClaimRecoveryEvent has no unique key or run id; claim status is never reset by import; RESOLVED status then qualifies as evidence. Section 2 A5. Add to P10 fixes.
3. **"Payment promised" counted as causal (HIGH, design).** S1 in section 3. Changes WP-2 acceptance fixtures: the fixture "call recorded `payment_issued` with reference, later payment: attributed" must be reversed or split by whether a corrective action preceded it.
4. **The final-delta credit rule mixes insurer and non-insurer dollars (HIGH).** A1: cumulative `insurancePaidAmount` or a RESOLVED status turns any later zeroing into "recovered". Fix by crediting only the increase in the insurer-paid column where it exists, else only remittance or staff-confirmed amounts.
5. **Inconsistent time baselines in one product (MEDIUM-HIGH).** 18 minutes (dashboard), 50 minutes (landing page and pricing calculator), 6 hours per week (landing pain stat), plus an unsourced 18 percent write-off figure and $47K average AR on the landing page. A prospect or regulator can see all of them.
6. **The organic/assisted baseline does not exist (MEDIUM-HIGH).** No Ontario days-to-pay evidence; the classifier would need the customer's own pre-period history, which no work package collects.
7. **Interest, fees, tax and holdback are not modelled as non-principal money (MEDIUM).** S6. Statutory interest on overdue SABS amounts (SOURCE) and 10 percent holdback (SOURCE) are in the Ontario evidence the research itself collected.
8. **Import control totals are optional, so the drift check can be vacuous (MEDIUM).** pmsImportPipeline.ts defaults the source balance to the imported balance when the caller does not pass one. A "reconciled to your PMS report" claim (LandingPage.tsx:1161) is not what the code guarantees by default.
9. **Dual-write rounding (MEDIUM).** The proposal stores cents in new tables and `Decimal(10,2)` in `insurance_claims`, with dual-write and later reversal of direction (M9). Rounding rules and a nightly parity check on sums, per tenant, are not specified. Decimal(10,2) also caps a single balance below 100 million, fine, but the cents/Decimal conversion is currently done with `Number()` and `Math.round` in several places (paymentVerification.ts:66, transitionClaimRecovery.ts:281).
10. **Immutability and retention of fee-grade evidence (MEDIUM).** Append-only ledger, retention period, versus the privacy aim of deleting call data (see section 8).
11. **Practice-side parallel follow-up is invisible (MEDIUM).** S4. Any attribution overstates by an unknowable amount; the product should say "followed" not "caused".
12. **No negative / disputed state in receipts (LOW-MEDIUM).** Recoupments, NSF, overpayment demands arrive as balance increases; the product should surface them to staff rather than silently adjusting.

---

## 12. Over-engineered versus under-engineered (money lens)

Over-engineered for the evidence:
- Four-class attribution with rule versions and window days.
- Full import coverage model (date windows, locations, entity kinds) before any customer has produced a second export.
- A 23-table M1.
- Policy-pack-configured manual-equivalent time baselines per objective and payer program.
- Party roles with effective dating.

Under-engineered:
- Idempotency, replay safety and reversal netting for payment events (does not exist in the shipped code).
- Separation of principal, interest, fee, tax, holdback.
- One owner of "recovered" and "saved" definitions (three calculators today).
- Control totals on import (optional today).
- Append-only discipline and retention for anything that may ever be billed against.
- A written definition of what "paid" means per module before the first non-dental dollar is displayed.

---

## 13. Suggested money-correctness acceptance tests to add to WP-2 (fixtures)

1. Claim with prior part insurer payment (insurerPaid > 0), balance then zeroed by a write-off only: receipts 0, not recovered. (Fails today.)
2. Claim in RESOLVED status, older file re-imported, newer file imported: exactly one credit. (Fails today.)
3. Claim never called, paid on schedule while IN_QUEUE: counted only as receipt, never in any CollectRx-linked figure.
4. One cheque over three invoices, one of which is unknown to the ledger: three allocations plus an unallocated remainder surfaced to staff.
5. Insurer payment includes interest: principal and interest are separate rows; only principal counts in receipts.
6. Payment promised on a call, payment arrives, no corrective action recorded: appears in receipts, not in the confirmable engagement list.
7. Two RESOLVED call attempts on one claim in a week: weekly report counts the claim once and does not use billed amount.
8. Payer reverses a payment: negative allocation, receipts total falls.
9. Two import sources, a "complete" run on source A: source B receivables untouched.

---

## 14. Limits of this review

- The research files contain search-excerpt evidence only; I did not verify any external source. Legal statements in section 8 and the competition law note in section 6 are OPINION and need counsel.
- I did not run the code or the tests; all code findings are from reading. A5 (double credit) is derived by tracing the importer, verification gate and event writer; a fixture should confirm it before it is cited externally.
- I did not read production data, so I cannot say how large any overstatement is in practice. The direction is clear from code; the size is unknown.
