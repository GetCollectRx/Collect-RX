# CollectRx: end-to-end product journey and assumptions

**Status:** Draft v1, 2026-11-12. A design record, not a status source. Live launch status stays in `docs/operations/PATH-TO-DELIVERY.md`.
**Purpose:** One map of the whole product: who is involved, what each person is trying to do at each step, what the software does, and what we are assuming. Every assumption has a way to be proven wrong.

## How to read this

| Tag | Meaning |
|---|---|
| FACT-CODE | Seen in this repo (path given). |
| FACT-DOC | Stated in a repo doc, not re-verified today. Most items from `PRESSURE-TEST-2026-10-06.md` are this. |
| ASSUMPTION | Believed but unproven. Listed in section 7 with a validation method. |
| UNKNOWN | We have no evidence either way. |

---

## 1. Actors and what each wants

| Actor | Goal | What makes them say no |
|---|---|---|
| Practice owner (buyer) | Money collected that would not have been collected anyway, net of the subscription | No provable recovered dollars; privacy risk; carrier relationship risk |
| Office manager / billing lead (daily user, real champion) | A shorter list of claims to chase, and fewer hours on hold | A list that does not match their aging report; extra cleanup work |
| Front-desk staff (takes the handoff) | Talk to the rep only when it is worth it, and never miss the rep | Transfer rings while they are with a patient; rep gone when they pick up |
| Carrier rep | Verify the caller, give status fast, close the ticket | Automated or odd callers; no provider number; long calls |
| Carrier (the company) | Fewer wasteful calls, no abuse of the phone line | Detected automation (CARRIER_BLOCK) |
| Platform operator (you) | Calls that work, carriers that do not block us, margin per practice | Cost per call over budget; silent failures |
| Privacy officer / counsel | No PHI where it should not be; consent and notice covered | Unlogged PHI flows; open vendor agreements |
| Patient | Never contacted (out of scope) but is the subject of every claim | n/a |

Product boundary (FACT-DOC, `CLAUDE.md`): Practice to Insurance AR recovery plus practice SaaS billing. No patient payment collection.

---

## 2. The journey, stage by stage

Stages S0 to S10. For each: who acts, what the software does, the data it touches, and the assumptions it leans on (IDs in section 7).

### S0. Discover and decide to buy
- **Practice:** hears about it, asks "is my aged insurance AR big enough to matter?"
- **System:** marketing engine (prospect harvesting, email campaigns, reply intelligence) in `src/server/marketing/` (FACT-CODE).
- **Assumptions:** A1 (AR is big enough), A2 (price vs value), A19 (marketing claims are substantiated).
- **Known gap:** the campaign copy claims Core "typically replaces around $3,000/month of front-desk time" with no evidence (FACT-DOC, pressure test H8).

### S1. Sign up and start the trial
- **Practice:** owner registers, creates the practice, gets 30 days, 500 min/month, 50 min/day, no card.
- **System:** `POST /api/auth/register`, `billingTier='trial'`, `trialEndsAt` +30 days (FACT-DOC, PATH-TO-DELIVERY billing lifecycle).
- **Practice settings that matter:** `humanAssistedMode` (default true), `escalationPhoneNumber` (the staff line), callback number.
- **Assumptions:** A3 (30 days is enough to see value; pressure test says no, H6), A4 (staff will set a staff line that someone answers).

### S2. Get claims in
- **Practice:** exports an aging report from their PMS and uploads it, or installs the AbelDent agent.
- **System:** CSV parse, validate, upsert to `insuranceClaim`, then `syncWorkItemsForPractice` enrolls eligible claims in the queue. Import enrolls automatically; there is no separate "turn on calling" step (FACT-DOC, `INGEST-AND-QUEUE.md`).
- **Data:** claim number, carrier, patient identifiers (tokenized for calls), outstanding amount, dates.
- **Assumptions:** A5 (the practice's export has what we need), A6 (they will keep exporting), A7 (carrier names map to the six supported).
- **Known gaps:**
  - The 2026-10-06 pressure test reported three problems that the code now appears to address, so treat them as "verify", not "open": line-level exports inflating recovery (H3, see `tests/prismaClaimImporter.lineLevel.test.ts`), claims vanishing from an export never closing (H4, see `src/server/pms/absentClaimHandler.ts`, with a mass-absence guard), and any balance drop counting as recovery (H2, see the evidence gate in `paymentVerification.ts`). Not re-tested end to end.
  - Only AbelDent has a scheduled extractor; CSV practices must export by hand (H5, FACT-DOC, not re-verified).
  - Unsupported carriers fail import (`carrierMap.ts` returns null, FACT-DOC).

### S3. Decide what to call, and when
- **System:** queue engine (`src/server/frontDesk/queueEngine.ts`) applies the call rules:
  - Mon to Fri, 8am to 5pm Eastern.
  - Max 3 attempts per claim.
  - Claim must be at least 30 days old (flat floor, `validateDispatch`). Documented per-carrier minimums (21 TELUS, 32 others) are NOT enforced (FACT-DOC, `HUMAN-DECISIONS-PENDING` item 1).
  - Over 90 days: no AI, escalate to a human.
  - CARRIER_BLOCK flag on a carrier suspends all calls to that carrier.
  - Billing gates: trial caps, overage pending, payment failure all pause calling.
  - TELUS: identify the underlying TPA from the group number first.
- **Assumptions:** A8 (30 to 90 days is the right window), A9 (Eastern hours fit practices in other time zones; pressure test #18), A10 (3 attempts is the right cap).

### S4. The call: dial and navigate the IVR
- **System:** Vapi squad, IVR_Navigator dials the carrier via Twilio and navigates menus with DTMF only. Silent, never converses.
- **Data:** only UUID tokens in Vapi metadata; patient identifiers injected as ephemeral call variables at dispatch (PHI boundary, FACT-DOC).
- **Rep side:** not yet involved. The carrier's IVR is the "user" here, and IVR drift is the main failure (carrier-ivr-health agent exists for this).
- **Assumptions:** A11 (IVR menus are stable enough to navigate by DTMF), A12 (carriers allow this at all; ToS status UNKNOWN for all six, pressure test H9).

### S5. The call: hold
- **System:** Hold_Sentinel waits silently through hold music and queue messages, hands off the moment a live human speaks. Hold minutes count against the practice's minute pool (FACT-DOC, H7). RBC average hold is documented at 38 minutes.
- **Value delivered:** this is the V1 product. Staff time saved equals the hold time they did not spend.
- **Assumptions:** A13 (the detector can tell a human from hold audio reliably), A14 (practices value hold time saved at the price), A15 (minute pricing is tolerable when carriers are slow).

### S6. The handoff to staff (V1 critical moment)
- **Today (FACT-CODE):** `request_staff_handoff` sends a blind Vapi transfer to `escalationPhoneNumber` and emails "Rep on the line, pick up". A blind transfer ends the Vapi call, so Claims_Scribe most likely never hears the staff conversation (unverified without a live test).
- **Staff journey:** phone rings, they stop what they are doing, pick up, the rep is already there, they must re-establish context (who, which claim) and then do the work.
- **Rep journey:** has been on a call with silence or hold, suddenly a different voice appears with no context.
- **Planned (see `staff-conference-handoff.md`):** a per-call Twilio conference so carrier, staff and a silent listener share one call.
- **Assumptions:** A16 (staff pick up in time), A17 (a rep tolerates a transfer or a new voice), A18 (a silent listener is lawful and acceptable with the notice we choose), A19b (the audio gap on the move to a conference is short enough that the rep does not hang up).
- **Known gaps:** no staff availability check before transfer; a ring-out after the transfer connects is not covered by code (ADR 0003 open items). Missed handoff has a standing rule: the agent gets a reference number using fixed CRTC-style disclosure text (`missedHandoff.ts`).

### S7. The conversation between staff and rep (what we need to learn)
- **Rep goals, in order:** confirm who is calling and that the provider is real, locate the claim, say what the status is, give a reference number, end the call.
- **Staff goals:** get status, reason code, expected payment date or amount, what is needed to move it, rep name and reference number.
- **What we want logged (one record per call):** scenario (paid, processing, not received, need information, denied, max benefits, unclear), amounts and whether they match expected, reason code, rep name, reference number, next action, unresolved questions. No transcript and no PHI.
- **System:** Claims_Scribe `log_call_outcome` writes `HumanAssistedCallLog`; `humanAssistedProfiles.ts` synthesizes per-carrier playbooks in `HumanAssistedCarrierProfile` (FACT-CODE/FACT-DOC).
- **Assumptions:** A20 (a call has a small set of outcome scenarios that cover almost everything), A21 (staff behaviour on calls is worth copying; ADR 0003 rests on this), A22 (enough calls per carrier will exist to build a playbook), A23 (what we log will not contain PHI).

### S8. After the call: outcome, claim status, next action
- **System:** `processCallEnded` (`src/server/vapi/vapiWebhook.ts`) resolves an outcome and a claim status. For a human log, `resolveOutcomeFromHumanAssistedLog` maps scenario to outcome conservatively: shortfalls, transfers and "unclear" go to ESCALATED for human review (FACT-CODE).
- **Claim states (FACT-CODE `schema.prisma`):** PENDING, IN_QUEUE, CALLING, APPROVED_PENDING_PAYMENT, RESOLVED, DENIED, ESCALATED, ON_HOLD, BLOCKED. **Call outcomes:** RESOLVED, PENDING, DENIED, ESCALATED, BLOCK_DETECTED, FAILED, NO_ANSWER, HUNG_UP.
- **Phase 0 change on this branch:** staff-handled calls with no log now resolve to ESCALATED instead of an outcome guessed from IVR and hold audio. Reason: `processCallEnded` fires at the handoff, before staff finish talking.
- **Assumption:** A24 (staff or the listener will produce the log; if they do not, escalation to review is an acceptable cost).
- **Known gap:** a log that arrives after `processCallEnded` has run is not reconciled into the claim (Phase 2 work).

### S9. Follow-through and proof of recovery
- **System:** payment verification watches the imported `outstandingAmount` fall (`paymentVerification.ts`); denial and CDCP workflows; underpayment recovery on the Recovery plan.
- **Practice:** wants to see "money recovered because of CollectRx".
- **Assumptions:** A25 (a drop in outstanding amount means a carrier payment), A26 (we can attribute it to our call), A27 (the practice updates the PMS fast enough for the next import to see it).
- **Known gaps:** H2 (write-offs looking like payments) appears addressed by an evidence gate in `paymentVerification.ts`; verify it end to end. H6 (trial ends before payments land) is still open (FACT-DOC).

### S10. Pay, grow or leave
- **System:** Stripe Billing, tiers Hold Sentinel $399 (1,000 min), Recovery $799, Growth $1,999, Scale $2,499 (FACT-DOC, ADR 0004). Overage $0.25/min ($0.20 Scale) after owner confirmation. Plan gates features server side. Cancel drops to trial tier with calls paused.
- **Stage 3 (autonomous AI talking to the rep):** on no plan yet. Opens per carrier only after graduation criteria that are not yet defined (ADR 0003).
- **Assumptions:** A28 (practices upgrade because of results), A29 (the $399 stage margin of about 63% is acceptable), A30 (exit and data deletion are acceptable; PHIPA deletion is a manual runbook today).

---

## 3. The carrier rep journey on its own

This is the side the product knows least about. Treat it as the main research gap.

| Rep stage | What the rep is thinking | What we need to know | Where it shows up in the product |
|---|---|---|---|
| Answer | "Who is this and what do they want?" | Opening line that gets cooperation | IVR_Navigator exit, handoff timing |
| Verify | "Is this a real provider? Which provider number? Which patient?" | Which identifiers each carrier asks for and in what order | Staff talk track, playbook per carrier |
| Locate claim | "Search by claim number, patient, or date of service" | Which key finds it fastest at each carrier | Playbook lookup hints |
| Disclose | "What am I allowed to say to this caller?" | What each carrier will and will not share by phone | Scenario list (UNCLEAR rate) |
| Resolve | "Give status, reference number, close" | Reference number format, call length norms | `referenceNumber`, `repName` |
| Detect | "Is this a robot or a repeat caller?" | Which signals trigger a block | CARRIER_BLOCK phrases, retry cadence |

Unknowns: carrier ToS for AI calls (all UNKNOWN), per-carrier identity checks, how a rep reacts to a transfer or a third voice.

---

## 4. Staff journey on its own

| Stage | Today | Pain | Product answer |
|---|---|---|---|
| Choose claims | Aging report and gut | No ranking | Queue and priority rules |
| Dial and wait | Staff on hold | The core pain | Hold Sentinel |
| Rep picks up | Staff must be free right now | Misses and context switching | Availability check (not built), conference (planned) |
| Talk to rep | Staff alone | Notes after the fact | Silent listener logs outcome |
| Record result | Manual notes in PMS | Duplicate work | Outcome card in dashboard |
| Follow up | Memory and sticky notes | Lost claims | Escalations, next action |

---

## 5. Operator journey

| Stage | Task | Support in product |
|---|---|---|
| Onboard a practice | CSV, staff line, settings | Onboarding flow, practice-onboarding-validator agent |
| Watch the fleet | Call success, carrier blocks, cost | Admin, weekly health agent, COGS breaker |
| Handle a block | Suspend carrier, investigate | CARRIER_BLOCK protocol |
| Handle privacy request | Deletion, breach | Manual runbook only |
| Tune carrier knowledge | Update rules and playbooks | `carrier-configs.json`, learning loop |

---

## 6. Rules that apply at every stage

- PHI never enters Vapi metadata; ephemeral variables only; no PHI in logs or the database for calls.
- CARRIER_BLOCK suspends every call to that carrier immediately.
- Calls only inside the window; max 3 attempts; age floor and ceiling as in S3.
- Plan and billing gates are enforced on the server, not only in the UI.
- No hardcoded practice names, emails or credentials in code.
- Nothing recorded or stored for the staff conversation in V1; no PHI in the outcome log.

---

## 7. Assumption register

Risk if wrong: H high, M medium, L low. "How to test" is the cheapest honest check.

| ID | Assumption | Stage | Tag | Risk | How to test |
|---|---|---|---|---|---|
| A1 | Practices have enough aged insurance AR to justify the price | S0 | ASSUMPTION | H | Free AR aging diagnostic on 5 real exports before selling |
| A2 | Owners value recovered dollars more than saved hours | S0 | ASSUMPTION | H | Ask each pilot owner to rank; compare at renewal |
| A3 | 30 days is long enough to show value | S1 | ASSUMPTION (pressure test says no) | H | Track days from first call to first verified payment |
| A4 | Someone will answer the staff line | S1/S6 | ASSUMPTION | H | Handoff answer rate and time to pick up in pilot |
| A5 | The practice's export has what we need | S2 | ASSUMPTION | H | Run first export through the validator before kickoff |
| A6 | Practices keep exporting without nagging | S2 | ASSUMPTION | M | Days since last import per practice |
| A7 | Their carriers are mostly the six we support | S2 | ASSUMPTION | H | Carrier coverage % of each practice's own AR |
| A8 | 30 to 90 days is the right call window | S3 | ASSUMPTION | M | Outcome mix by claim age |
| A9 | Eastern hours work for the practice and the carrier line | S3 | ASSUMPTION | M | Answer rate by hour and province |
| A10 | Three attempts is the right cap | S3 | ASSUMPTION | L | Resolution rate by attempt number |
| A11 | IVR menus are stable enough for DTMF | S4 | ASSUMPTION | H | IVR failure rate per carrier per week |
| A12 | Carriers tolerate automated dialing and hold | S4 | UNKNOWN | H | Read each carrier's agreement; track block rate |
| A13 | The detector tells a live human from hold audio | S5 | ASSUMPTION | H | False handoff and missed handoff counts |
| A14 | Hold time saved is worth the price | S5 | ASSUMPTION | M | Staff time study before and during pilot |
| A15 | Minute pricing is acceptable when carriers are slow | S5 | ASSUMPTION | M | Overage rate and complaints; hold minutes per carrier |
| A16 | Staff pick up before the rep leaves | S6 | ASSUMPTION | H | Time from rep answer to staff answer |
| A17 | A rep tolerates a transfer or an added voice | S6 | UNKNOWN | H | Rep hang-up rate after handoff; run the conference spike |
| A18 | A silent listener is lawful with the chosen notice | S6/S7 | UNKNOWN | H | Counsel review before any pilot call |
| A19b | The audio gap when moving to a conference is short enough | S6 | UNKNOWN | H | Measure the gap in the Phase 1 spike |
| A20 | A small scenario list covers nearly every call | S7 | ASSUMPTION | M | UNCLEAR share of logged calls |
| A21 | Staff behaviour is worth copying | S7 | ASSUMPTION | M | Compare resolution rates across staff and carriers |
| A22 | Enough calls will exist per carrier to build playbooks | S7 | ASSUMPTION | H | Calls per carrier per month vs playbook threshold |
| A23 | The outcome log contains no PHI | S7 | ASSUMPTION | H | Scrub in place for narrative fields; sample audit monthly |
| A24 | Staff or the listener will produce the log | S8 | ASSUMPTION | H | Logged calls divided by handed-off calls |
| A25 | A drop in outstanding amount means a carrier paid | S9 | ASSUMPTION (evidence gate exists in code, not tested end to end) | H | Reconcile 20 recoveries against EOBs |
| A26 | We can attribute recovery to our call | S9 | ASSUMPTION | H | Control group of similar claims not called |
| A27 | The PMS is updated before the next import | S9 | ASSUMPTION | M | Lag from carrier payment to PMS update |
| A28 | Practices upgrade because of results | S10 | ASSUMPTION | H | Trial to paid conversion vs recovered dollars shown |
| A29 | Thin margin at $399 is acceptable | S10 | ASSUMPTION | M | Real cost per minute vs $0.135 model |
| A30 | Exit and deletion terms are acceptable | S10 | ASSUMPTION | L | Ask in sales calls; counsel review |
| A31 | Carrier-specific minimum waits (21 TELUS, 32 others) are right | S3 | ASSUMPTION | M | See HUMAN-DECISIONS-PENDING item 1 |
| A32 | Autonomous AI conversation is where the product ends up | S10 | ASSUMPTION | H | Define graduation criteria first (ADR 0003 open item) |

---

## 8. What to measure at each stage (turns the map into data)

One event per stage, so every assumption above has a number behind it.

| Stage | Event | Key fields |
|---|---|---|
| S2 | import_completed | rows, rejected rows and why, carriers unmapped |
| S3 | claim_enqueued / claim_skipped | reason (age, carrier block, billing gate) |
| S4 | ivr_completed | carrier, menu path, success, failure step |
| S5 | hold_ended | carrier, hold seconds, human detected |
| S6 | handoff_attempted | answered, seconds to answer, rep still present |
| S7 | outcome_logged | scenario, UNCLEAR flag, source (listener or staff form) |
| S8 | outcome_resolved | outcome, claim status, source (log or fallback) |
| S9 | recovery_verified | amount, evidence type (EOB, PMS drop), attributed or not |
| S10 | plan_changed | from, to, trigger |

---

## 9. Open decisions

1. Silent listener notice and consent wording (counsel).
2. Whether a trial of 30 days stays, or becomes a 45 to 60 day measured pilot.
3. Whether to enforce per-carrier minimum waits.
4. Graduation criteria for autonomous calling, per carrier.
5. How recovered dollars are proven (EOB match, control group).
6. Whether to price on hold minutes or on resolved claims.

## 10. Next steps

- Review this map with the pilot practice office manager and rewrite the staff stages from what they say, not from this draft.
- Run the Phase 1 conference spike to settle A17 and A19b.
- Add the S2 to S9 events in section 8 as lightweight logging.
