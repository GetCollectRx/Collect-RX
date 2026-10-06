# CollectRx Adversarial Pressure Test (2026-10-06)

Point-in-time record (see root `CLAUDE.md` rule 4). Not a status source; `docs/operations/PATH-TO-DELIVERY.md` remains the live tracker.

Purpose: try to prove the business, product, workflow, compliance posture, onboarding model and retention strategy are flawed, then turn every finding into a product change, a test, or an evidence-collection task.

---

## 0. How to read this document

Every claim is tagged:

| Tag | Meaning |
|---|---|
| **[FACT-CODE]** | Verified by reading this repo on 2026-10-06. File path given. |
| **[FACT-DOC]** | Stated in a repo doc; not independently verified against the live system. |
| **[ASSUMPTION]** | Your stated assumption or mine. Must be validated before it is relied on. |
| **[EXTERNAL-UNVERIFIED]** | A claim about the outside world (carriers, PMS vendors, competitors, law) that I did not verify against primary sources in this pass. Treat as a hypothesis and use the evidence task attached. |
| **[REC]** | Recommendation, always paired with its tradeoff. |

No market-size numbers appear anywhere in this document by design.

---

## 1. Headline findings (read this if nothing else)

| # | Finding | Tag | Why it matters |
|---|---|---|---|
| H1 | **The product you describe is not the product the code builds.** You describe Hold Sentinel as "wait on hold, then transfer to the practice when a human answers." The shipped squad has Hold_Sentinel hand off to an **AI Claims_Agent** that talks to the rep. The only transfer-to-a-phone-number code in the repo is a test harness (`Collect-RX-main/src/webhooks/holdParkTest.ts`). There is no production warm transfer to the practice. | FACT-CODE | Sales, ROI, compliance and carrier-risk analysis all change depending on which product you sell. A transfer product has low carrier-detection risk and low PHI-on-call risk but saves less labour. An AI-talks product saves more labour but carries CARRIER_BLOCK and disclosure risk. Pick one for the wedge and make the code match. |
| H2 | **"Dollars recovered" is currently not provable.** `verifyPaymentFromSyncUpdate` (`src/server/recovery/paymentVerification.ts`) treats any drop in imported `outstandingAmount` as recovered money. It cannot tell a carrier payment from a write-off, an adjustment, a patient payment, a reversal, or a payment that would have arrived without CollectRx. | FACT-CODE | The single most important retention number (recovered $ vs $799) is inflated by design. A skeptical office manager will reconcile it against the PMS ledger in month 2 and stop trusting the dashboard. |
| H3 | **Confirmed false-recovery path on line-level exports.** Claim identity is `(practiceId, claimNumber)` only (`src/server/pms/prismaClaimImporter.ts`, `upsertInsuranceClaim`). There is no per-claim aggregation of rows. If an export has one row per procedure line sharing a claim number, each row overwrites the previous row's `outstandingAmount`, and the drop between line 1 and line 2 is pushed to `runPaymentVerificationBatch` as a partial payment. A single import can report recovered dollars that never moved. | FACT-CODE | This is a bug, not a strategy issue. Fix before any pilot shows a recovered-$ number. |
| H4 | **Claims that disappear from the export are never closed.** No code path detects "claim was in the last import, is absent from this one." Many AR reports only list open balances, so a claim resolved in the PMS simply stops appearing. CollectRx keeps it open and can keep calling. | FACT-CODE (absence confirmed by search; treat as high confidence, not proof) | Calling a carrier about a paid claim wastes minutes the practice pays for, annoys the carrier rep, and is the fastest route to "your robot doesn't know what we already fixed." |
| H5 | **Scheduled local sync exists only for AbelDent.** `desktop/services/abeldent-sync.cjs` is the only scheduled extractor. There is no folder watcher or scheduled CSV pickup for any other PMS. For non-AbelDent practices, "no daily manual export" is not true today. | FACT-CODE | Your constraint "do not assume staff will export daily" is violated for the majority onboarding path (CSV). |
| H6 | **The 30-day trial cannot show verified recovered dollars.** Calls require claims aged 30+ days (flat floor, `src/carriers/adapter.ts`). Carrier reprocessing and payment typically take further weeks after a successful call [ASSUMPTION]. Trial ends at day 30. The practice is asked to pay before the lagging proof exists. | FACT-CODE + ASSUMPTION | Conversion will be decided on leading indicators (rep reached, outcome captured) unless the pilot is redesigned. See Section 10. |
| H7 | **Minute-based pricing bills the practice for carrier slowness.** Core is $799 for 1,200 minutes (`src/billing/tiers.ts`). Hold minutes count. `CARRIER_TIMEOUTS` documents RBC average hold at 38 minutes. One bad hold week can burn the pool. | FACT-CODE | The customer perceives "I paid more because the insurer was slow." That is a pricing-model objection, not a value objection, and it is fixable. |
| H8 | **Marketing copy makes an unsubstantiated savings claim.** `src/server/marketing/emailCampaignTemplates.ts` says Core "typically replaces around $3,000/month of front-desk phone time." No repo evidence supports "typically." At $30/hour that is 100 staff hours per month. | FACT-CODE | Credibility risk with owners who know their staff hours, and a misleading-representation risk under the Competition Act [EXTERNAL-UNVERIFIED: get counsel to confirm]. Remove or substantiate before outbound campaigns run. |
| H9 | **Carrier terms are unknown for all six carriers.** `docs/compliance/carrier-tos-research.md`: explicit AI-call prohibition is "UNKNOWN" for every carrier; agreements are behind portals. The same doc notes carriers offer self-serve portals for claim status. | FACT-DOC | The core activity has no confirmed permission, and the carrier itself offers a free substitute for part of the job. |

---

## 2. Perspective sweep (who kills the deal and how)

| Perspective | Strongest attack | Where it bites in the workflow |
|---|---|---|
| Practice owner | "Show me money I would not have collected anyway, net of $799." | Payment verification (H2, H3), attribution |
| Office manager / TC | "Your list doesn't match my aging report, and I spend Mondays fixing it." | CSV import, stale claims (H4), duplicates (H3) |
| Front-desk staff | "The transfer rings when I'm checking in a patient, and the rep is gone by the time I pick up." | Staff handoff timing (H1 if transfer model ships) |
| Privacy officer | "Where does patient name and DOB go, who hears it, who records it, and where is it stored?" | PHI on calls, recordings, vendor DPAs open (PATH-TO-DELIVERY section E) |
| Carrier rep | "I can't release claim details to an automated system" or "who am I speaking with, what is your provider number?" | Rep refusal, CARRIER_BLOCK |
| PMS vendor | "Unsupported third-party data access; we may block the export path or charge for the API." | Local sync, scheduled exports |
| Competitor | "We bundle claim status into the clearinghouse / PMS you already pay for." | Substitution of the carrier call entirely |
| Investor / acquirer | "Revenue depends on carriers tolerating automation and on CSV exports nobody controls. Where is the moat?" | Carrier dependency, data dependency |
| Implementation partner (dental IT, billing consultant) | "Installing a scheduled agent on a front-desk PC is my liability when it breaks Windows updates." | Local sync jobs, Electron app |
| Skeptical architect | "Claim identity is a free-text claim number. Nothing else holds." | Duplicate claims, patient matching, re-import |

---

## 3. Top 25 reasons a practice refuses to buy

Ranked by my estimate of likelihood x severity. Each links to the workflow element it attacks.

| # | Refusal reason | Workflow element | Counter-move (detail in sections 5 and 9) |
|---|---|---|---|
| 1 | "My aged insurance AR is small; we already chase it fine." | ROI | Free AR aging diagnostic before trial: quantify insurance AR >30/60/90 days by carrier from one export. Disqualify practices below break-even (Section 4). |
| 2 | "$799/month is more than the hours my staff spends on hold." | ROI | Lead with recovered/accelerated $ not labour; offer a lower-volume tier or success component (Section 4). |
| 3 | "I don't want an AI talking to insurers on my behalf." | AI conversation (H1) | Sell transfer-only mode as default; AI conversation as opt-in. |
| 4 | "Sending patient names and DOBs to a startup is a privacy risk I can't justify." | PHI | Data minimization statement, Canadian residency answer, signed agreement, list of subprocessors. Currently DPAs are open (PATH section E). |
| 5 | "We check status on the carrier portal or through our clearinghouse already." | Substitution | Position on claims where portal status is insufficient (stuck, "in review," needs a rep). Needs evidence of what share that is. |
| 6 | "Our PMS can't export what you need" or "I don't know how." | CSV import | Per-PMS export recipes with screenshots; accept the report the practice already runs. |
| 7 | "I'm not installing software on our front-desk PCs." | Local sync | CSV upload or emailed export as default; desktop agent only for AbelDent. |
| 8 | "Transfer will interrupt my staff while they're with patients." | Staff handoff | Scheduled call windows, "available" toggle, callback-request instead of live transfer. |
| 9 | "If the insurer flags us, our provider relationship is at risk." | CARRIER_BLOCK | Disclose CARRIER_BLOCK protocol in sales; carrier-by-carrier opt-in. |
| 10 | "Who is liable if the AI says something wrong to the carrier?" | AI conversation | Scope what the agent may say (status inquiry only, no commitments), contract language. |
| 11 | "Only six carriers. Half my problem claims are Blue Cross, Desjardins, Equitable, or CDCP." | Carrier coverage | Unsupported rows currently **fail import** (`carrierMap.ts` returns null). Show coverage % of the practice's own AR before signing. [EXTERNAL-UNVERIFIED: regional carrier mix varies by province] |
| 12 | "I can't see what happened on the call." | Trust | Call outcome card with transcript excerpt or summary, rep name, reference number. |
| 13 | "Our office manager owns this and she says no." | Champion | Pilot success metric framed around her time, not the owner's revenue. |
| 14 | "30-day trial isn't enough to see payments." | Proof (H6) | 45 to 60 day measured pilot (Section 10). |
| 15 | "Minute pricing is unpredictable." | Pricing (H7) | Per-claim or per-resolved-call pricing option, or minutes that exclude hold beyond a cap. |
| 16 | "We use a billing company / DSO central billing." | Buyer | Sell to the billing company as a channel, not the practice. |
| 17 | "Quebec practice: Law 25." | Compliance | `docs/compliance/Quebec-Law25-PIA.md` exists; PIA must be completed per practice before Quebec sales [EXTERNAL-UNVERIFIED]. |
| 18 | "Calls only 8 to 5 Eastern doesn't fit BC/Alberta carriers or our hours." | Call rules | Time-zone-aware calling windows per carrier line. |
| 19 | "We tried an automation tool before and it created more work." | Trust | Ship the "zero-touch week" metric (Section 5, PR-14). |
| 20 | "Denied claims need a narrative or X-ray, which your bot can't send." | Practice gates | Be explicit: CollectRx finds what is missing; staff attaches. Do not oversell. |
| 21 | "No SOC 2 / no pen test." | Security | PATH section E: pen test not scheduled. Written pilot exception at minimum. |
| 22 | "Who are you? No references." | Credibility | First 3 pilots at no cost in exchange for a referenceable case study with their own numbers. |
| 23 | "Our claim numbers are re-issued when we resubmit." | Duplicates (H3) | Composite claim identity (Section 5, PR-02). |
| 24 | "I don't want email noise and you can't text us." | Notifications | Single daily digest plus in-app queue; SMS excluded by your constraint. |
| 25 | "Cancelling will be painful and you'll keep our data." | Exit | Published exit and deletion process. Today PHIPA deletion is a manual runbook only (`docs/compliance/PHIPA-MANUAL-PROCESS-RUNBOOK.md`). |

---

## 4. Conservative ROI model

### 4.1 Editable assumptions (all [ASSUMPTION] until the pilot measures them)

| ID | Variable | Conservative default | How to measure in pilot |
|---|---|---|---|
| A1 | Aged insurance claims needing a phone follow-up per month | 30 | Count from aging export, filtered to carriers supported and age 30 to 90 days |
| A2 | Calls per claim to reach a resolution signal | 1.5 | CollectRx call log |
| A3 | Baseline staff minutes per call today (dial + IVR + hold + talk + notes) | 25 | 2-week time study before pilot, stopwatch log by staff |
| A4 | Staff minutes still spent per call with CollectRx (transfer model: talk + notes + context switch) | 13 | Pilot time log |
| A5 | Staff minutes per call with CollectRx (AI-talks model: review outcome + action) | 4 | Pilot time log |
| A6 | Loaded staff cost per hour (CAD) | $30 | Practice payroll |
| A7 | Average outstanding $ per aged claim | $250 | Aging export |
| A8 | Baseline % of these claims eventually written off or abandoned | 8% | 12-month write-off history from PMS |
| A9 | Reduction in write-off rate attributable to CollectRx | 25% relative (8% to 6%) | Control group (Section 10) |
| A10 | Days earlier cash arrives on claims CollectRx moves | 14 | Control vs treatment payment dates |
| A11 | Cost of capital (annual) | 8% | Owner input |
| A12 | Price | $799/month (Core) | `tiers.ts` |

### 4.2 Arithmetic (transfer model)

| Line | Formula | Value |
|---|---|---|
| Calls/month | A1 x A2 | 45 |
| Staff time saved | 45 x (A3 - A4) / 60 x A6 | 45 x 12 / 60 x $30 = **$270** |
| Incremental recovery | A1 x A7 x A8 x A9 | 30 x $250 x 8% x 25% = **$150** |
| Acceleration value | A1 x A7 x A11 x A10/365 | 30 x $250 x 8% x 14/365 = **$23** |
| **Total monthly value** | | **$443** |
| Net vs price | $443 - $799 | **-$356** |

AI-talks model (A5 = 4): staff time saved = 45 x 21/60 x $30 = $473, total ~$646, still **below $799**.

### 4.3 Where ROI is weakest

| Weak point | Why |
|---|---|
| Solo practice, transfer model | Labour saving is capped by how much of each call is hold. The rep conversation still costs staff time. |
| Practices that already use portals | A3 is lower because some status checks never needed a phone call. |
| Low aged AR | A1 below ~30 kills it at any price near $799. |
| Write-off rate already low | A9 applied to a small A8 is near zero. |
| Carriers with short holds | The product's core value (absorbing hold time) shrinks. |

### 4.4 Break-even conditions at $799 (holding other defaults)

| Lever alone | Break-even value |
|---|---|
| Claims/month (A1), transfer model | ~54 |
| Claims/month (A1), AI-talks model | ~37 |
| Baseline write-off rate (A8), transfer model, A1 = 30 | ~27% (unrealistic for most practices) [ASSUMPTION] |

**Conclusion:** At $799, Core is justified for practices with roughly 40 to 55+ phone-worthy aged claims per month on supported carriers, not "solo dentist, 1 location, 20 to 40 outstanding claims" as `tiers.ts` currently targets. Either the target customer or the price/packaging is wrong.

### 4.5 What makes $799 hard to justify

- Dashboard recovered-$ that includes write-offs and payments that would have happened anyway (H2).
- Minutes burned on claims already paid (H4).
- Months where the call cap or minute pool is hit by hold time (H7).
- Any month where staff still had to do the rep conversation and feel no time back.

### 4.6 Proof a practice needs before paying

| Proof | Evidence artifact |
|---|---|
| Their own aged AR is big enough | AR diagnostic report from their export, by carrier and age band |
| Calls actually reach a rep | Rep-reached rate per carrier, with reference numbers |
| Outcomes are actionable | Outcome category per call (paid/pending/needs info/denied) with next action |
| Money moved | Payment matched in their PMS ledger, line-level, with date and payer, not inferred from balance drop |
| It would not have happened anyway | Control-group comparison or carrier reference number proving the call triggered reprocessing |
| Staff time saved | Before/after time log, signed by office manager |

### 4.7 Pricing options [REC]

| Option | Tradeoff |
|---|---|
| Keep $799, re-target to larger practices | Cleaner; shrinks addressable segment and lengthens sales cycle. |
| Add a lower tier (e.g., fewer minutes, transfer-only) | Fits solo practices; margin and support cost per account worse. |
| Success component (base + % of verified incremental recovery) | Aligns with value; requires H2/H3 fixed first, or you will be paid on inflated numbers and lose trust. Also creates disputes over attribution. |
| Price per claim worked instead of per minute | Removes H7 objection; you absorb hold-time variance, so COGS breaker logic must move to per-carrier risk pricing. |

---

## 5. Highest-risk workflow failures

| Area | Failure | Current state | Severity | Fix [REC] | Tradeoff |
|---|---|---|---|---|---|
| CSV import quality | Line-level rows per claim overwrite each other | FACT-CODE: no aggregation; last row wins; false partial payment (H3) | Critical | Aggregate by claim key before upsert; reject file if same claim key has conflicting header fields | Need per-PMS knowledge of whether rows are claim-level or line-level |
| CSV import quality | Unsupported carrier rows fail import | FACT-CODE: `mapToCarrierId` null = failed row | High | Import as "unsupported carrier, tracked not called" | More rows to store; clearer coverage reporting |
| CSV import quality | Substring carrier matching misroutes ("includes" match) | FACT-CODE: `carrierMap.ts` loops `key.includes(pattern)` | Medium | Exact alias table plus explicit confirm screen for new aliases on first import | One extra onboarding click |
| CSV import quality | Date formats (DD/MM vs MM/DD), currency with "$" or commas, Excel-mangled claim numbers (leading zeros, scientific notation) | Not verified | High | Header-level format detection, preview diff before commit | Slightly slower import |
| Local scheduled sync | Non-AbelDent practices have none | FACT-CODE (H5) | High | Folder-watch agent: PMS scheduled report writes to a folder, agent uploads. Or "email the report to a practice-specific inbox" | Folder agent = install burden; email path = PHI in email transit, needs TLS-enforced inbound and immediate deletion |
| Local scheduled sync | Agent silently stops (PC off, Windows update, password change) | `connectorMonitorScheduler.ts` exists; behaviour vs. stale data not verified | High | Freshness SLA: if no sync in N business days, pause dialing for that practice and notify | Pausing dialing reduces usage; better than calling on stale data |
| Duplicate claims | Resubmitted claim gets a new number; old one stays open | FACT-CODE: identity = claimNumber only | High | Composite fingerprint: carrier + patient token + service date + procedure codes + billed amount; link and supersede | False merges if two legitimate claims share fingerprint; require human confirm on fuzzy match |
| Stale claim status | Claim resolved in PMS disappears from export, remains open | FACT-CODE (H4) | Critical | "Absent from full export" rule: mark WAIT_SYNC, do not dial, ask practice to confirm | Requires knowing whether the export is full or partial; ask at upload |
| Stale claim status | `daysOutstanding` frozen at import value if not recomputed | Not verified | Medium | Always derive from `submittedAt`/`servicedAt` at dispatch time | Needs those dates present |
| Payment verification | Balance drop counted as recovery | FACT-CODE (H2) | Critical | Require payer-typed transaction (insurance payment) from the export, or a carrier reference from the call, before "verified recovered" | Fewer, smaller, but true numbers; owners may see lower value at first |
| Payment verification | Attribution (paid anyway) | No control | High | Report "touched by CollectRx then paid within X days" separately from "paid without touch" | Honest numbers may look weaker; they are defensible |
| Carrier IVR changes | Menu tree changes, IVR_Navigator presses wrong key, burns minutes or reaches wrong department | Only an eval file references drift | High | Per-carrier IVR fingerprint (expected prompts); abort and flag on mismatch; daily canary call per carrier | Canary calls cost minutes you pay for |
| Patient matching | Rep can't find patient (name spelling, DOB mismatch, member ID vs certificate number, dependents) | No matching logic (none found) | High | Pre-dispatch completeness check: subscriber vs patient, relationship, certificate/member ID per carrier requirements | More data required = more PHI; collect only what the carrier asks for |
| Missing attachments | Carrier needs X-ray/narrative; call can't complete | PRACTICE_GATE route exists (`dispatchGate.ts`) | Medium | Good base. Add per-gate SLA and aging; stop re-dialing until gate cleared (already blocks) | Gates pile up; staff see a to-do list they didn't ask for |
| Staff handoff timing | Transfer arrives when nobody can pick up; rep hangs up | No production transfer exists (H1) | Critical if transfer model ships | Pre-announced windows; staff "ready" presence toggle; rep-hold script ("connecting the provider's office, one moment"); fallback to capture reference number and request callback | Lower transfer volume; requires staff discipline |
| Failed callbacks | Carrier says "we'll call you back" to a number nobody monitors | Not verified | High | Callback number must be the practice's line, and the outcome must create a "callback expected by" task | Practice workload |
| Already resolved in PMS | Staff fixed it yesterday; export not refreshed | Partly covered by recall scheduling | High | Pre-dial freshness check: no dial if last import older than 2 business days, or one-click "already resolved" in the daily digest | Delays some dials |

---

## 6. Top 25 reasons a practice cancels (30, 60, 90 days)

| # | Day | Reason | Root cause in workflow | Prevention [REC] |
|---|---|---|---|---|
| 1 | 30 | Trial ends before any verified payment | H6 | 60-day measured pilot; trial converts on agreed leading indicators |
| 2 | 30 | Import errors on first upload, nobody fixes them | CSV quality | White-glove first import by CollectRx |
| 3 | 30 | Unsupported carrier rows "missing" | carrierMap null | Track-not-call import |
| 4 | 30 | Calls hit claims already paid | H4 | Absent-claim rule and freshness gate |
| 5 | 30 | Staff missed transfers, rep gone | Handoff | Presence toggle, windows |
| 6 | 30 | Minutes exhausted mid-month by hold time | H7 | Hold-time cap per call, per-claim pricing |
| 7 | 30 | Daily cap (50 trial, 100 Core) throttles volume | `tiers.ts` | Show cap math upfront |
| 8 | 30 | Staff stopped exporting after week 2 | H5 | Folder watch or email ingest |
| 9 | 30 | No visible call evidence | Trust | Outcome card per call |
| 10 | 60 | Recovered-$ doesn't reconcile to PMS ledger | H2, H3 | Ledger-grade verification |
| 11 | 60 | Gates pile up; it feels like more work | PRACTICE_GATE | Gate SLA, weekly gate budget |
| 12 | 60 | Duplicate claims after resubmission | Identity | Composite fingerprint |
| 13 | 60 | Carrier changed IVR, a week of failed calls | IVR drift | Canary + auto-pause per carrier |
| 14 | 60 | CARRIER_BLOCK on a major carrier halts product | Carrier risk | Pre-disclosed; transfer mode as fallback; per-carrier pacing |
| 15 | 60 | Champion (office manager) leaves | People | Onboard two named users minimum |
| 16 | 60 | Overage confirmation emails feel like upsell pressure | Billing | Clear cap behaviour; default to stop, not overage |
| 17 | 60 | Wrong carrier routing for TELUS-administered plans | TELUS TPA | Group-number TPA check surfaced at import |
| 18 | 60 | Patient not found by rep repeatedly | Matching | Pre-dispatch completeness |
| 19 | 90 | Aged AR backlog cleared; ongoing volume too small for $799 | ROI decay | Downgrade path instead of cancel |
| 20 | 90 | Owner compares to cost of a part-time billing temp | ROI | Quarterly value report with verified numbers only |
| 21 | 90 | Privacy officer review after an incident elsewhere | Compliance | Pre-built privacy pack, DPAs signed |
| 22 | 90 | PMS update breaks export format | Import | Schema drift detection, alert before data is wrong |
| 23 | 90 | Desktop agent unsigned/flagged by antivirus | Local sync | Signed builds only (already a stated rule) |
| 24 | 90 | Calls outside practice's region hours or carrier hours | Call rules | Per-carrier hours |
| 25 | 90 | Feature promises (autonomous resolution) not delivered | Vision gap | Sell what exists; roadmap in writing, not in pitch |

---

## 7. Product requirements to reduce cancellation risk

Priority: P0 = before first paid pilot; P1 = before 10 practices; P2 = before scale.

| ID | Pri | Requirement | Acceptance criteria | Tradeoff |
|---|---|---|---|---|
| PR-01 | P0 | Aggregate import rows by claim before upsert | Line-level file with N rows per claim produces one claim with summed outstanding; zero payment events on first import | Must detect claim-level vs line-level exports |
| PR-02 | P1 | Composite claim fingerprint and supersede link | Resubmitted claim with new number links to old one; old one closed as SUPERSEDED, never dialed | False-merge risk; human confirm on fuzzy matches |
| PR-03 | P0 | Absent-from-full-export handling | Upload asks "full open AR or partial?"; on full, missing open claims move to WAIT_SYNC and are not dialed | One extra question per upload |
| PR-04 | P0 | Payment verification requires payer evidence | "Verified recovered" only with insurance-payment transaction or call reference + balance drop within window; other drops labeled "balance reduced, unverified" | Smaller headline number |
| PR-05 | P0 | Attribution split in reports | Report shows: touched-and-paid, paid-without-touch, written off, still open | Honest but less flattering |
| PR-06 | P0 | Freshness gate before dial | No dial when practice's last successful import is older than configurable N business days | Lower call volume when practices lapse |
| PR-07 | P0 | Decide and implement the wedge (transfer vs AI-talks) | Product, sales copy and code agree; if transfer: real transfer path with presence toggle and fallback | Transfer = less labour value; AI = more carrier risk |
| PR-08 | P1 | Non-AbelDent scheduled ingest (folder watch or secure email ingest) | Practice configures PMS scheduled report once; uploads arrive without staff action for 10 business days | Install burden or email-PHI risk |
| PR-09 | P1 | Track unsupported carriers | Import succeeds; claims visible as "not callable" with carrier coverage % | Storage of PHI for claims you cannot act on: minimize to token + amounts |
| PR-10 | P1 | IVR fingerprint and canary | Mismatch aborts call within 60 seconds and flags carrier; canary detects change within 1 business day | Canary cost |
| PR-11 | P1 | Hold-minute cap per call and per-claim pricing option | Practice can set max hold minutes; overruns end call and reschedule | Lower reach rate on long-hold carriers |
| PR-12 | P1 | Outcome card per call | Rep reached Y/N, reference number, status, next action, timestamp | Storing call details increases PHI footprint; summary only, no audio by default |
| PR-13 | P1 | Gate SLA and gate budget | Gates show age; digest shows top 5 gates only | Some gates wait longer |
| PR-14 | P1 | "Staff minutes this week" metric | Self-reported or inferred touches per week, trended | Self-reporting is soft data |
| PR-15 | P2 | Per-carrier calling hours and pacing | Configurable per carrier line, time-zone aware | Config complexity |
| PR-16 | P0 | Remove or substantiate "$3,000/month" claim | Copy replaced with formula-based estimate or pilot-measured number | Weaker headline |

---

## 8. Test plan (risks converted to adversarial tests)

Format: ID, input, expected result. All should be automated in `Collect-RX-main/tests/` unless marked MANUAL.

### 8.1 Import and re-import

| ID | Input | Expected |
|---|---|---|
| T-IMP-01 | Same claim number on 3 rows ($400, $150, $50) in one file | One claim, outstanding $600, **0 payments verified** (currently fails per H3) |
| T-IMP-02 | Import file A, then identical file A | No changes, 0 payments, 0 events |
| T-IMP-03 | File A then file B where one claim is absent, upload flagged "full" | Claim moves to WAIT_SYNC, not dialed |
| T-IMP-04 | Same as 03, flagged "partial" | Claim unchanged |
| T-IMP-05 | Claim outstanding drops from $300 to $0 with no payer column | Status "balance reduced, unverified," not counted as recovered |
| T-IMP-06 | Drop with insurance payment transaction row | Counted as verified |
| T-IMP-07 | Claim number "000123" vs "123" vs "1.23E+02" | Flagged for review, not silently treated as distinct or same |
| T-IMP-08 | Dates "03/04/2026" with no hint | Ambiguity flagged at preview |
| T-IMP-09 | Amounts "$1,234.50", "(150.00)", "1 234,50" | Parsed correctly or row rejected with reason |
| T-IMP-10 | Carrier "Blue Cross" | Imported as unsupported, not failed |
| T-IMP-11 | Carrier string that substring-matches the wrong carrier | Exact-match failure surfaces confirm prompt |
| T-IMP-12 | Resubmitted claim, new number, same fingerprint | Linked and superseded |
| T-IMP-13 | 10,000-row file | Completes within agreed time, no partial commit on failure |
| T-IMP-14 | CSV injection payload in a text field ("=HYPERLINK(...)") | Stored inert; escaped on any CSV export from CollectRx |
| T-IMP-15 | Import for practice A containing practice B's claim numbers | No cross-tenant read or write (RLS) |

### 8.2 Sync jobs

| ID | Input | Expected |
|---|---|---|
| T-SYNC-01 | No sync for 3 business days | Dialing paused for that practice; one notification |
| T-SYNC-02 | Sync resumes | Dialing resumes only after a successful import |
| T-SYNC-03 | Export schema changes (column renamed) | Import blocked with diff, no partial data |
| T-SYNC-04 (MANUAL) | PC reboot, Windows update, user logoff | Agent resumes or alerts within one day |

### 8.3 Dispatch and calls

| ID | Input | Expected |
|---|---|---|
| T-CALL-01 | CARRIER_BLOCK set mid-queue | Zero further dials to that carrier across all practices |
| T-CALL-02 | Claim with blocking PRACTICE_GATE | Not dialed (covered by `dispatchGate.ts`; keep regression) |
| T-CALL-03 | IVR prompt text differs from fingerprint | Call aborts within 60s, carrier flagged |
| T-CALL-04 | Hold exceeds practice cap | Call ends, rescheduled, minutes reported |
| T-CALL-05 | Rep says "cannot speak to automated system" | Outcome = REFUSED_AUTOMATION, carrier counter increments, threshold triggers CARRIER_BLOCK review |
| T-CALL-06 | Rep cannot find patient | Outcome = PATIENT_NOT_FOUND, practice gate created with the specific missing field |
| T-CALL-07 | Rep promises callback | Task "callback expected by" created, claim not re-dialed before date |
| T-CALL-08 | Transfer, practice does not answer within 30s | Fallback captures reference, ends gracefully (only if transfer model ships) |
| T-CALL-09 | Call attempted outside Mon to Fri 8 to 5 ET | Blocked |
| T-CALL-10 | 4th attempt on a claim | Blocked |
| T-CALL-11 | Claim already marked resolved by staff between queue and dial | Not dialed (race test) |

### 8.4 PHI boundary

| ID | Input | Expected |
|---|---|---|
| T-PHI-01 | Inspect Vapi metadata on every dispatch | UUID tokens only (existing `workflowPhiVapiBoundary`; keep) |
| T-PHI-02 | Grep logs after a full call cycle for test patient name/DOB | Zero hits |
| T-PHI-03 | Error path during detokenization | No PHI in error message or Sentry event |
| T-PHI-04 | Transcript storage | Name/DOB redacted or transcript not retained, per decided policy |

### 8.5 Attribution and reporting

| ID | Input | Expected |
|---|---|---|
| T-RPT-01 | Mix of touched-paid, untouched-paid, written-off | Report separates all three |
| T-RPT-02 | Dashboard total vs sum of ledger-verified rows | Equal |

---

## 9. Onboarding plan (minimal practice effort)

| Step | Who | Practice effort | Notes / tradeoff |
|---|---|---|---|
| 0. AR diagnostic | CollectRx | One export, 10 minutes | Qualifies or disqualifies before trial. Saves both sides a failed trial. |
| 1. Agreement and privacy pack | Owner | Sign once | Must include subprocessors and data flow. Currently DPAs open. |
| 2. Export recipe | CollectRx provides per-PMS guide | 15 minutes once | Accept the report they already run; map columns on our side. |
| 3. First import, white-glove | CollectRx staff | Zero after upload | Costs your time per practice; that is the price of first-impression accuracy. |
| 4. Coverage review call | Office manager | 20 minutes | Show supported %, unsupported carriers, gates found on import. |
| 5. Recurring ingest | CollectRx configures | One-time scheduled report setup | Folder-watch or email ingest (PR-08). AbelDent: desktop agent. |
| 6. Handoff rules | Office manager | 10 minutes | Transfer windows, presence toggle, digest recipient. |
| 7. First calls supervised | CollectRx | Zero | Listen to first calls per carrier. |
| 8. Week-1 review | Office manager | 15 minutes | Outcomes, gates, corrections. |

Target: under 90 minutes of total practice time in the first two weeks, and zero recurring manual export.

---

## 10. 30-day pilot design (and why it needs a 60-day tail)

### 10.1 Structure

| Element | Design |
|---|---|
| Population | Practice's supported-carrier claims aged 30 to 90 days |
| Control | Random 30% held out; practice works them as usual. Without a control, recovered $ is not attributable. Tradeoff: fewer claims worked in pilot. |
| Duration | 30 days of calling, 30-day observation tail for payments (total 60) |
| Price | Free calling period; paid decision at day 30 on leading indicators, with a money-back clause tied to day-60 verified results. Tradeoff: delayed revenue, much higher trust. |
| Ingest | Recurring ingest must be live by day 3 or the pilot pauses |

### 10.2 Success metrics

| Metric | Type | Target (set with practice before start) |
|---|---|---|
| Rep-reached rate per carrier | Leading | >= 60% of attempts [ASSUMPTION] |
| Calls on already-resolved claims | Quality | 0 |
| Actionable outcome captured | Leading | >= 80% of rep-reached calls |
| Staff minutes per claim worked | Efficiency | >= 40% below the pre-pilot time study |
| Verified recovered $ (ledger-matched), treatment vs control | Lagging | Treatment paid rate exceeds control by an agreed margin by day 60 |
| Dashboard vs PMS ledger reconciliation | Trust | 100% match on verified items |
| CARRIER_BLOCK / automation refusals | Safety | 0 blocks; refusals reported per carrier |

### 10.3 Exit criteria

| Outcome | Condition |
|---|---|
| Convert | Leading metrics hit at day 30 and no data-quality incident |
| Extend | Leading metrics hit, lagging data incomplete |
| Stop | Any PHI incident; CARRIER_BLOCK on a carrier making up most of the practice's AR; recovered $ does not exceed control |

### 10.4 Evidence to collect (applies across this doc)

| Evidence | Method |
|---|---|
| Baseline staff time per carrier call | 2-week stopwatch log, 3 practices |
| Hold time distribution per carrier | CollectRx call logs, minimum 50 calls per carrier |
| Share of aged claims where portal status is insufficient | Ask staff to tag 50 claims: "portal enough" vs "needed a call" |
| Write-off rates | 12-month PMS write-off report from 5 practices |
| Carrier tolerance | Carrier relations outreach to all six (provider relations), written answer on automated calls |
| Export formats | Collect one anonymized export template per PMS in your target list |

---

## 11. Compliance and privacy risk register (PHIPA/PIPEDA style)

Not legal advice. Items marked EXTERNAL-UNVERIFIED need counsel.

| ID | Risk | Likelihood | Impact | Current control | Gap / action [REC] | Owner |
|---|---|---|---|---|---|---|
| C-01 | PHI to voice/AI subprocessors without signed agreements | Medium | High | Option B ephemeral variables (`PHI-VAPI-BOUNDARY.md`) | DPAs open (PATH section E). Sign before pilot. | Legal/Ops |
| C-02 | Cross-border processing (US-hosted AI/voice providers) | High | Medium to High | Unknown | Disclose in privacy pack; obtain practice acknowledgement; assess Canadian-region options [EXTERNAL-UNVERIFIED: provincial rules differ, e.g., Quebec Law 25 transfer assessment] | Legal |
| C-03 | Call recordings/transcripts contain name and DOB | High | High | Not verified | Default no audio retention; redacted summary only; retention period stated | Eng/Privacy |
| C-04 | Deletion and breach workflows manual only | Certain | Medium | Manual runbook | Acceptable for pilot if disclosed; automated workflow blocked on counsel (HUMAN-DECISIONS item 2) | Legal |
| C-05 | Unsupported-carrier claims stored without purpose | Medium | Medium | None (currently they fail, which is accidentally minimal) | If PR-09 ships, store token + amounts only | Eng |
| C-06 | Email ingest path puts PHI in email | Medium | High | N/A until built | Enforced TLS inbound, auto-delete on ingest, or prefer folder agent | Eng |
| C-07 | Desktop agent credentials to PMS database on front-desk PC | Medium | High | Signed builds rule | Read-only DB user, least-privilege query list, local secret storage review | Eng |
| C-08 | Tenant isolation depends on non-superuser DB role | Low | Critical | Runtime guard shipped | One-time production verification still open (HUMAN-DECISIONS item 3) | Ops |
| C-09 | AI disclosure at start of call | Medium | Medium | Conservative disclosure rule (`crtc-disclosure-decision.md`) | Keep; test that disclosure fires on every human pickup | Eng |
| C-10 | Carrier ToS prohibits automation | Unknown | Critical | CARRIER_BLOCK | Written carrier answers (Section 10.4) | Founder |
| C-11 | Misleading marketing claims | Medium | Medium | None | PR-16 | Founder |
| C-12 | Who is the custodian/agent? CollectRx acting as agent of the practice (HIC) under PHIPA | Medium | High | Not documented | Agent agreement template defining CollectRx as agent, permitted uses, no secondary use (including model training on call data) [EXTERNAL-UNVERIFIED] | Legal |
| C-13 | "Learning from carrier behaviour" vision uses PHI-bearing transcripts for training | Medium | High | None | Train only on de-identified outcome features; state this in contract | Eng/Legal |
| C-14 | No pen test | Certain | Medium | None | Schedule or written pilot exception (PATH section E) | Ops |

---

## 12. Sales objection library

| Objection | Rebuttal | Proof to show | Do not say |
|---|---|---|---|
| "Too expensive." | "Let's run your aging report through our diagnostic. If your supported-carrier aged claims are below what makes $799 pay back, we'll tell you not to buy." | AR diagnostic, break-even table (4.4) | "It pays for itself" without their numbers |
| "We use the portal." | "Keep using it. We work the claims the portal leaves 'in process' and the ones that need a rep." | Tagged sample of their claims | That portals are inadequate in general |
| "I don't want AI talking to insurers." | "Default mode only waits on hold and connects your staff; the rep talks to your person." (only true once PR-07 ships) | Demo of transfer | Anything about transfer before it exists |
| "Privacy risk." | "Here's exactly what leaves your PMS, where it goes, how long we keep it, and who signs for it." | Privacy pack, data-flow diagram, DPAs | "We're PHIPA compliant" as a blanket claim |
| "Insurers will block us." | "If a carrier signals it doesn't accept automated calls, we stop all calls to that carrier immediately, and you're never the first to find out." | CARRIER_BLOCK protocol | That carriers have approved it (they have not, per FACT-DOC) |
| "We don't have time to set it up." | "Under 90 minutes of your team's time over two weeks; we do the first import." | Onboarding plan | "Zero setup" |
| "We can't export daily." | "You set up a scheduled report once; we pick it up." (true once PR-08 ships; AbelDent today) | Setup demo | Daily-export requirement |
| "How do I know it worked?" | "Every recovered dollar shown is matched to an insurance payment in your ledger, and we hold back a control group." | Reconciliation report | Balance-drop totals (H2) |
| "Our billing company does this." | "We can work for your billing company, not around it." | Channel offer | Criticism of their vendor |
| "Only six carriers." | "Here's what share of your aged AR those six represent. If it's low, we're not a fit yet." | Coverage % from diagnostic | Market share percentages not verified for their region |

---

## 13. Competitive and substitution threats

| Threat | Mechanism | Severity | Response [REC] |
|---|---|---|---|
| Carrier portals | Free status check for many claims [FACT-DOC: portals exist for all six] | High | Target claims portals don't resolve; measure share (Section 10.4) |
| Clearinghouse/EDI claim status | If carriers expose status electronically through existing claim networks, calls become unnecessary for those claims [EXTERNAL-UNVERIFIED: verify which carriers support electronic status inquiry via CDAnet/ITRANS; repo has `ITRANS-2.0-Migration.md`] | High | If available, use it as the first check before any call; calls become the escalation layer |
| PMS vendors bundling AR tools | Vendor ships AR follow-up workflow inside the PMS | Medium | Be PMS-agnostic; sell multi-PMS groups and billing companies |
| Outsourced billing services | Humans do the calls with judgement | Medium | Partner channel rather than compete |
| US AI-RCM vendors entering Canada | Same mechanism, more capital [EXTERNAL-UNVERIFIED: do a named competitor scan before fundraising] | Medium | Canadian carrier IVR library and carrier relationships as the asset |

---

## 14. Investor/acquirer view: where the moat is and is not

| Claimed asset | Skeptic's view | What would make it real |
|---|---|---|
| AI voice agents | Commodity (Vapi + LLM) | No moat by itself |
| Canadian carrier IVR library and outcome data | Real if maintained and measured | Per-carrier reach rate, time-to-rep, outcome taxonomy over thousands of calls |
| PMS-agnostic ingest | Real if zero-touch | PR-08 and import accuracy metrics |
| Carrier relationships | Currently none confirmed (FACT-DOC) | Written carrier acknowledgement; ideally a sanctioned channel |
| Learning loop | Vision only | De-identified outcome dataset with consent terms (C-13) |

---

## 15. Recommended sequencing

| Order | Action | Why first |
|---|---|---|
| 1 | Fix H3 (aggregation) and H2 (verification semantics), PR-01, PR-04, PR-05 | Every number you show depends on them |
| 2 | PR-03 and PR-06 (stale claims, freshness gate) | Stops paid minutes on resolved claims |
| 3 | PR-07 decision: transfer vs AI-talks wedge | Determines sales copy, ROI, carrier risk |
| 4 | PR-16 copy fix | Cheap, removes credibility risk before outbound runs |
| 5 | Collect evidence in 10.4 with 3 practices before pricing changes | Avoid repricing on assumptions |
| 6 | PR-08 recurring ingest | Required before scaling past AbelDent practices |
| 7 | Carrier outreach | Long pole; existential if any carrier says no |

## 16. Open questions for the founder (I did not assume answers)

1. Is the wedge transfer-to-staff, AI-conversation, or both as modes? (H1)
2. Will practices supply an insurance-payment transaction column, or only balances? (Determines PR-04 design.)
3. Is the export you expect a full open-AR report or a date-ranged extract? (Determines PR-03.)
4. Which PMS systems are in the first 10 target practices? (Determines PR-08 priority and recipes.)
5. Are you willing to run a control group in pilots? (Determines whether recovered $ is ever attributable.)
