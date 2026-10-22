# Council verdict (2026-10-13)

Six independent reviewers judged the 13 propositions in COUNCIL-BRIEF.md: staff engineer, voice-AI reliability, privacy and compliance, product and go-to-market, operations, finance and data integrity. Reports are in this folder. All six reports are included; the privacy and compliance report is summarized in section 8. Claims marked CHECKED were re-run or re-read by the author after the reports came in. Others are the reviewers' code readings and need a fixture or test before anyone relies on them.

## 1. Where the council agrees

1. **Prove value in dental and fix the existing system before building a general layer.** Product: stay dental for twelve months plus one bounded probe. Staff engineer: there is no separable engine today, so a shared core is a refactor of dental-shaped code (49 src files say "dental"). Finance: the numbers shown to customers cannot be defended yet. Operations: twelve controls must exist before any second vertical.
2. **The "placement test" (P3) is circular today.** Dental is the only consumer, so nothing qualifies for the core. It becomes useful only after a second module exists.
3. **Fields in JSON (P4) is wrong for sensitive identity.** It hides VINs and addresses from column-based scrubbing, retention and export. Staff engineer's alternative: typed one-to-one extension tables plus the vault. Product also opposes P4.
4. **P7 (delete weak modules) should become a lifecycle:** suspend, read-only, archive. Operations proposes this; product's kill criteria point the same way.
5. **P2 (small prompts) is not shown to reduce hallucination.** Voice reviewer found no evidence of a hallucination gain from splitting a prompt of this size. Treat it as a blast-radius and wrong-domain win, and settle the question with the cheap experiment below.
6. **P12's controls are weaker than the proposal says.** Read-back is defeated by rep agreement and shared speech-recognition errors; the transcript check is circular and not speaker-attributed; free-text fields have no check; strict mode is off on `log_call_outcome`; there are two outcome enums (Scribe 10 values, autonomous 9). The existing eval harness uses scripted, non-reactive counterparts, and the repo's own audit marks the 2026-07-10 run invalid.

## 2. Where the council disagrees

| Item | Positions |
|---|---|
| First module (P9) | Staff engineer: W1 first for reuse, but its test ("changes to the core mean the core is wrong") is the wrong test. Finance: supports. Product: oppose as the commercial choice; Ontario MVA payment trace (W2) is the better probe because the SABS 30-day rule and HCAI's lack of payment status create a clear phone job. |
| Per-payer budgets and blocks | Product: cross-tenant per-payer budgets spread one tenant's risk to everyone. Operations: blocks today are per tenant and per organization, not per payer, which contradicts CLAUDE.md; unify with a probation step. Both agree the current design is unsafe; they differ on the remedy and it needs a decision. |
| How much to build before evidence | Product: almost nothing beyond defects, instrumentation, and probes. Staff engineer and operations: a defined set of controls and a strangler-by-vertical path ready when a probe passes. |

## 3. New defects found (these matter even if you never expand)

| # | Finding | Status |
|---|---|---|
| 1 | `extractReferenceNumber` returns "number" when the agent says the mandatory line "Can I get a reference number for this call", and "manager" for "case manager". Any 4+ character reference counts as corroboration in the financial gate, so a hallucinated RESOLVED can pass. | **CHECKED**: ran the real regex from `src/outcome/processor.ts`; both strings return those values |
| 2 | `CARRIER_TIMEOUTS` uses hyphenated keys (`rbc-insurance`, `sun-life`) but carrier ids are underscored (`rbc`, `sun_life`), so only `manulife` matches; the rest fall back to 30 minutes, including RBC, intended at 45 | **CHECKED** in `src/billing/tiers.ts` against `maxCallDurationSeconds` |
| 3 | The tick returns early when the slot budget is exhausted, before the per-practice stale-attempt reaper runs; open attempts count against the budget, so enough lost webhooks can freeze all dispatch with no self-heal | **CHECKED by reading** `queueEngine.ts` (lines ~497 to 527 and the watchdog at ~560); not reproduced |
| 4 | Weekly customer email (`weeklyPilotReport.ts`) sums billed amount on RESOLVED attempts and labels it "Revenue recovered" | Reviewer reading; not checked |
| 5 | `PAYMENT_VERIFIED_SYNC` can be credited twice: no idempotency key, import never resets claim status, and RESOLVED counts as evidence; reversals never netted | Reviewer reading; **confirm with a fixture** |
| 6 | Whole balance drop is credited even if a write-off or patient payment cleared it, and claims never called can count | Reviewer reading; consistent with earlier author finding |
| 7 | Two block implementations; clearing a block does not restore `recoveryRoute`; BLOCKED means both "carrier block" and "ambiguous send", so clearing can redial | Reviewer reading |
| 8 | Circuit breaker counts 4xx responses, so one bad pack can halt the fleet; lease is claimed once per tick and never renewed | Reviewer reading |
| 9 | Time-saved baselines contradict each other: 18 minutes (dashboard), 50 (landing page), 6 hours a week (a pain stat); landing page carries unsourced figures | Reviewer reading |
| 10 | `call_attempts` row security joins through `insurance_claims`; a null `claim_id` would hide a call from its own tenant, and 15 child tables share the dependency | Reviewer reading |
| 11 | `InsuranceClaim` has 34 write sites in 15 files, so dual-write is not one change; `CarrierId` is non-null on 15 models and referenced in about 120 files | Reviewer reading |
| 12 | Sales and test traffic share the Vapi account and are invisible to the slot counter; the vault is capped at 100k tokens fleet-wide; Hold_Sentinel's 25-minute timer has no clock behind it | Reviewer reading |

## 4. Revised propositions

| # | Original | After the council |
|---|---|---|
| P1 | One engine plus modules | Keep as the direction. Treat as a refactor done by strangler, vertical by vertical, only after a probe passes |
| P2 | Small prompt per objective | Keep for blast radius. Do not claim fewer hallucinations until the experiment below says so |
| P3 | Two-uses placement test | Keep, but it applies only once a second module exists |
| P4 | JSON attribute fields | Replace: typed one-to-one extension tables for anything sensitive or queried; JSON only for non-sensitive display attributes |
| P5 | Module may not touch core | Two-phase contract: phase 1 the core is changed once to expose the constants and types as data; phase 2 modules supply data only |
| P6 | Cap of eight entities | Replace the number with a tagged manifest and a CI test that fails when entities are added without review |
| P7 | Retire modules | Suspend, read-only, archive lifecycle |
| P8 | Cut list | Keep, plus: payment rows need header columns and an `interest_or_fee` kind; source-scoped import absence is the minimum import fix |
| P9 | W1 first | Open decision between W1 (reuse) and W2 (commercial). See section 5 |
| P10 | Build order | Keep; add the new defects in section 3 to stage 0 |
| P11 | Human-assisted first | Keep |
| P12 | Hallucination controls | Replace with an evidence ledger: each extracted fact stored with its transcript span, speaker and confidence; unconfirmed money states never auto-act |
| P13 | Scoped knowledge | Keep. Compliance reviewer's report is pending |

## 5. Recommended sequence (council synthesis)

- **Stage 0, fix now (dental benefits):** manual trigger parity, one dispatch path, the defects in section 3 (1, 2, 3 first), honest recovery numbers, remove or correct "Revenue recovered", disclosure proof, Scribe first message, squad in the repo, hold time persisted.
- **Stage 1, instrument and pilot dental:** per-call analytics; a 50 to 100 call pilot.
- **Stage 2, probes in parallel (no new tables):** free AR-export audit for prospects; a priced offer test; a concierge MVA payment-trace probe on the existing squad in human-assisted mode.
- **Stage 3, decision gate** against written kill criteria (product report has numbers).
- **Stage 4, only if a probe passes:** strangler-by-vertical with typed extension tables, the operations gate list (reaper independent of capacity, one slot-reserving dispatch path, kill switches at tenant, pack, payer-route and platform scope, block unification with probation, immutable pack versions with canary and rollback, per-payer ceilings, per-pack metrics, breaker hygiene, runbooks).

## 6. Experiments the council asks for
1. **Prompt split:** 50 reactive-counterpart scenarios, four arms (current mega-prompt, split prompt, split plus evidence ledger, split plus ledger plus server-held facts), 10 trials each, scored against hidden fact sheets.
2. **Fixture for the double credit** (section 3, item 5).
3. **Reproduce the reaper freeze** in a test with eight stale attempts.

## 7. Open questions the council cannot answer
Whether payers accept automated callers (untested and binary); real call length and hold time; whether success fees trigger collection-agency licensing in Ontario (counsel); whether the July BUILD-HANDOFF note ("zero active practices") is current.

## 8. Privacy and compliance reviewer (arrived last)

Report: privacy-compliance.md. Confidence: high on code and the PHIPA text, medium or low on CRTC, Criminal Code and PIPEDA points (marked for counsel).

1. **The PHIPA agent risk exists in shipping dental code today.** CHECKED: `humanAssistedProfiles.ts` selects call records by carrier only (no practice filter), sends them to the Anthropic API, and stores the result by carrier. `CarrierSubmissionChannel` is global, last writer wins, and its text is injected into other tenants' prompts. The reviewer also notes that the legal prompt in the repo says CollectRx "owns anonymized analytics". The agent definition requires acting for the custodian's purposes and not the agent's own. This needs counsel now, whatever happens with expansion.
2. **P13 is right in direction but conflates scope with purpose and covers only custodians.** Proposal: a knowledge ledger where every record carries a purpose tag (customer service versus product improvement), a source scope, and a de-identification state.
3. **Human-assisted mode does not meet the repo's own disclosure decision**: the decision requires a recording and transcription notice at rep contact, and the Scribe is silent (and says "Hello." at entry). The schema even flags when a rep suspects automation. Fixable cheaply; not demonstrably compliant as built.
4. **Allowlists are necessary but not sufficient.** Variables go to every squad member, availability is not use, and what the rep says back is unbounded. Suggested: a late-bound "reveal identifier" tool so an identifier is released only when the rep asks for that specific one.
5. **The transcript scrubber has no name or address patterns**, so "PHI never stored" is overstated; vehicle, property and employer identifiers are untouched by it.
6. **Third parties:** Deepgram and ElevenLabs are missing from the PHI boundary record; business agreements with Vapi and Twilio are unchecked; the data-residency headers may be inert (low confidence).
7. **Expansion removes the carrier phone allowlist**, which creates misdial risk (a wrong number receiving patient or claimant identifiers).
8. **P9 opposed for privacy reasons:** W1 extends the custodian exposure (more health-custodian customers on the same shared-knowledge path).
9. **Review-once is only partly achievable.** Knowledge ingestion, disclosure rules by counterpart class, and the subprocessor register must be part of the core, not modules.

Effect on the sequence: add to stage 0 (1) a counsel review of the cross-practice synthesis and global channel memory, (2) a fix for the human-assisted recording notice and the Scribe first message, (3) the subprocessor register including Deepgram and ElevenLabs, and (4) name and address scrubbing patterns.
