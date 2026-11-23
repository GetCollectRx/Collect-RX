# Scenario coverage, 23 November 2026

Owner: Khalid. Written by a Claude Code session. Governing rules: docs/PRODUCT-BRIEF.md, docs/DECISIONS-REGISTER.md, docs/operations/PRE-CALL-LOGIC-GATE.md. No call of any kind was placed to produce this.

## Conclusions first

- **Registry:** 248 scenarios exist. Before this change no code read them, apart from the 45 `telephony_controlled` ones that the Carrier Twin checks by id. The five `harness` values had no runner.
- **A runner now exists** (`Collect-RX-main/tests/validation-lab/runner/`). It reports all 248 as PASS, FAIL, FINDING or UNVERIFIED on every run. It runs 62 of them through real production code: all 39 post_call, 21 of 22 dispatch, and 2 handoff.
- **Current run:** PASS 48, FAIL 4, FINDING 9, UNVERIFIED 187 (the 187 include D016, which ran and cannot be observed). Rows are level **U** (real production function, synthetic data) or **S** (real queue tick, routes, webhook, PHI vault, desk socket; stubbed Vapi; synthetic data; no network). None is a mock Vapi server run, a browser walk, an owned-number run or a real carrier call. Identical, down to the observed codes, over three consecutive runs.
- **Most serious defect found (P017):** a call where the rep says the claim was denied and also says "the reference number is X" is stored as RESOLVED or APPROVED_PENDING_PAYMENT. The text "reference number is" is a resolution pattern that is checked before the denial patterns, and a spoken reference number lets the result past the financial gate. A denial can therefore close as paid.
- **FAIL (the expected result is not met):**
  - P017: the denial that is stored as paid, described above, and no appeal deadline captured.
  - P013: a rep names a different patient than the claim and the claim still closes RESOLVED. Nothing compares names spoken with the claim.
  - D017: Canada Life is configured `portalFirstDispatch: true`, but nothing reads the flag. The voice call is allowed.
  - P008: a denial with a code in the text is DENIED, but the call outcome has no field for the code, so it is never extracted.
- **FINDING (behaviour no document calls intended, or a conflict that needs a decision):**
  - E001: a failed call raises the queue attempt count twice (at dispatch, then when the recovery step requeues it). Two failed calls already escalate the claim, so the documented cap of 3 calls allows 2.
  - P002 and the rule in the brief: the registry expects a paid call with a reference number to stay RESOLVED, and the product does that. The brief says a claim is only called paid with evidence beyond a spoken reference number. The registry expectation and the brief disagree.
  - P012: no patient identifier is stored, but the redacted transcript is still stored at rest in `call_attempts.transcript_text`. Register D-01 says transcripts are not kept at rest by default.
  - P014: a partial payment spoken with a reference number becomes approved-awaiting-payment, so the shortfall is not sent to a human.
  - P023: "waiting period not met" is detected only in that literal wording.
  - D004: the carrier block holds for the practice that raised it. A second practice on the same carrier can still dial. Block scope is an open register item.
  - D012: dispatch uses a flat 30 day floor, while carrier-configs.json documents day 21 for TELUS (HUMAN-DECISIONS-PENDING item 1).
  - E003: the outcome lands on the right claim when the end-of-call report carries the claim metadata. Without it the outcome is dropped and the claim stays CALLING. A real Vapi report keeps its metadata, so this is a dependency, not a proven defect.
  - P015: the registry line "90+ days in transcript" is ambiguous. Under the interpretation used, wording in the call does not escalate. The scenario needs a clearer definition.
- **Side observations, not scored:** the manual trigger route needs the practice owner role (a front desk session gets 403, D014). Calling `runDeskQueueTick` twice at once inside one process dialled the same claim twice in one run and once in another. Production is protected by the scheduler latch and the database lease, so this is a hazard for a future caller, not a live defect.
- **The biggest gap is in the registry itself.** It has no scenario for the V1 staff handoff, the missed handoff, staff presence and capacity, staff hours, the NPI rule, Claims_Scribe, or metering. Its 22 "handoff" scenarios are autonomous agent-to-agent handoffs. Unit tests exist for several of these behaviours but carry no scenario ids.
- **Blocked:** 55 scenarios need a live call (45 IVR, 10 ops). The pre-call gate has not been met. 130 need a text conversation harness that does not exist. Khalid confirmed there is no other workstream building it, so it is ours to build, and his rule is that nothing is paid for until all 248 are done. A harness that plays the rep with a model costs money, so the 130 stay at level D or U (prompt contract checks, scripted replay through deterministic code) until he lifts that rule.

## 1. Inventory (verified against the files)

| Asset | Count | Notes |
|---|---|---|
| `validation-lab/registry/scenarios.json` | 248 | Matches `expectedCatalogCount` and `SCENARIO-MASTER.csv` (248 rows). |
| By layer | conversation 105, ivr 50, post_call 39, handoff 22, dispatch 22, ops 10 | |
| By tier | P0 179, P1 60, P2 9 | |
| By harness | carrier_conversation 132, transcript_outcome 39, scenario_vitest 22, telephony_controlled 45, supervised_pilot 10 | The CSV calls these eval_conversation, vitest_transcript, vitest_agents, ivr_research_call, manual_pilot. |
| By implementation field | partial 66, unimplemented 172, pilot_only 10 | All 22 dispatch are `partial`. All 39 post_call are `unimplemented`. |
| CSV status | wired 25, pass 10, planned 213 | The 10 `pass` rows came from static transcripts, not live runs. |
| Layer and harness pairs | conversation and ivr (5) and handoff (22) use carrier_conversation. ivr (45) uses telephony_controlled. post_call uses transcript_outcome. dispatch uses scenario_vitest. ops uses supervised_pilot. | |
| Registry assertions | Every `expected` is a generic `scenario.outcome equals "<free text>"` | They cannot be executed as written. Each needs a per-id binding to a real function, which is what the runner adds. |
| Stage 1 (`stage1.e2e.test.ts`) | 115 check results per run, in one sequence | Baseline PASS 79, FAIL 15, FINDING 16, UNVERIFIED 5. Not scenario-per-id. |
| Office-day suite | 12 sections, A to M | Per the 23 November handoff note it was PASS 57 with 2 FAIL before pull request 206 fixed a stale date. I did not re-run it for this document. |
| Carrier Twin (`stage2/`) | 107 scenarios | Models 44 of the 45 `telephony_controlled` ids. CX-SL-02 is listed as unmodeled. The twin scores itself against its own ground truth, including the 10 second disclosure rule. It does not run the product. |

## 2. Executability (all 248, from the run)

| Class | Count | Meaning | Where |
|---|---|---|---|
| RAN_OFFLINE | 62 | Bound to real code and run today, level U or S | dispatch 21, post_call 39, handoff 2 |
| RUNS_OFFLINE_NOT_YET_BOUND | 1 | Can run offline, not wired yet | D020 (plan capacity soft limit) |
| NEEDS_HARNESS | 130 | Needs the text conversation harness (agent prompt against a simulated rep) | conversation 105, handoff 20, ivr 5 |
| NEEDS_LIVE_CALL | 55 | Needs a live dial or a person | ivr 45 (twin models them, product needs the squad), ops 10 |

Limits of this classification: unbound scenarios are classified by their harness label, not read one by one. A few ops scenarios (X003 server refuses to start without the webhook secret, X006 CSV to queue to dial) probably can run offline. I did not check them.

## 3. Hold Sentinel coverage map

Legend for "Run today": U unit test, S Stage 1 or office-day simulation, T twin (offline, scores the twin only), R this runner (U), none.

| Behaviour | Registry scenarios | Run today | Not run, and gap |
|---|---|---|---|
| Dial rules: age, attempts, window, holidays, authorization, plan limits | D001 to D013, D018, E004, E008 | R: 21 of 22 (16 at U, 5 at S: D014, D019, E004, E008 and D016). S: office-day B (age), C (window, holidays, western office), E (retries), K (gates). U: `workflowDispatchSafetyRules.test.ts`, `callCalendar.test.ts`. | D020 plan capacity soft limit is unbound. D016 ran but cannot be observed: no TELUS TPA has a verified phone, so no TELUS call is ever dispatched. |
| Practice NPI and staff hours, staff presence | none | U: `staffedHours.test.ts`. S: office-day C and K. | **No registry scenario.** Add ids (batch 4). |
| Menu navigation | IVR-DR, IVR-CB, IVR-AI, IVR-FR, IVR-DC, S004, S005, S006, S019, S021 | T only (twin conformance). | Product against the twin needs a live squad dial: blocked. |
| Hold detection | IVR-HO x6, IVR-HP x6 | T only. Stage 1 FAIL: live state sequence and hold seconds are not recorded. | Detector accuracy is not closable offline (pre-call gate gap 13). |
| Rep pickup | IVR-HP | T only. | Same as above. |
| Handoff to staff | none (the registry "handoff" layer is autonomous agents) | U: `missedHandoff.test.ts` (mocked database), `handoffAlert.test.ts`, `handoffNotify.test.ts`. S: Stage 1 takeover check (UNVERIFIED), office-day G. | **No registry scenario.** Pre-call gate gaps 2 and 3 (edge cases, one transfer number) have no test. |
| Missed handoff | none | U: `missedHandoff.test.ts`, `missedHandoffAlert.test.ts`. | **No registry scenario.** Gap 1 (what happens to the claim afterwards) is untraced. |
| Outcome recording | P001 to P030, E001 to E010, T003 | R: 39 of 39 post_call (22 at U, 17 at S): classification, the financial gate, the webhook route, idempotency, PHI, desk broadcast, outboxes, KPI. S: Stage 1 steps 4 to 7. | Real vendor behaviour (recording deletion, sidecar audit) is stubbed. |
| Disclosure within 10 seconds | S016, S023, H005 (conversation layer) | U: `crtcDisclosure.test.ts`. T: the twin scores it. | Needs the conversation harness or a live call. No registry scenario measures time to disclosure on the product. |
| Carrier block | D004, D005, P005, P006, P019, P020, T003 | R: D004, D005, P005, P006, P019, P020, T003. S: office-day F, Stage 1 (live refusal FAIL, requirement R-012). U: `carrierBlock*.test.ts`. | Block scope (register: open). Live in-call detection does not trigger today. |
| Metering | X008 only | S: Stage 1 and office-day D, H (minutes, idempotency). Stage 1 FAIL: staff minutes saved and hold minutes avoided. | **No registry scenario** for metering. |
| Learning and playbooks (Claims_Scribe) | none | S: Stage 1 step 8. Stage 1 FAIL: identifier filter lets a name through (R-015). | **No registry scenario.** |

## 4. Results so far (run 23 November, levels U and S)

Source: `Collect-RX-main/tests/validation-lab/runner/`. The full table with observed codes is in `docs/simulation/SCENARIO-RUN-2026-11-23.md`.

| Layer | Scenarios | PASS | FAIL | FINDING | UNVERIFIED |
|---|---|---|---|---|---|
| dispatch | 22 | 17 | 1 | 2 | 2 |
| post_call | 39 | 29 | 3 | 7 | 0 |
| handoff | 22 | 2 | 0 | 0 | 20 |
| ivr | 50 | 0 | 0 | 0 | 50 |
| conversation | 105 | 0 | 0 | 0 | 105 |
| ops | 10 | 0 | 0 | 0 | 10 |
| **Total** | **248** | **48** | **4** | **9** | **187** |

Honest limits of the 48 PASS results:

- Each proves one gate or one classifier, not the pipeline. For example D002 proves `validateDispatch` refuses a 91 day claim. It does not prove an escalation record is created.
- H006 and H015 are backend halves only. Whether the agents pass the reference number to each other is a conversation question.
- P002 is reported as a FINDING rather than a PASS: the product does what the registry says, and the registry conflicts with the brief rule on evidence for "paid". The same weakness (a spoken reference passes the financial gate) is behind P013, P014 and P017.
- E007 forces the database failure with a unique key clash, not a real outage. P016, P026 and P028 prove the product asks for or queues the action; the vendor, the browser and the audit sidecar are not exercised.
- The post_call scenarios use short synthetic carrier phrases and synthetic patient names held in memory. The runner fails if any phrase or any tracked identifier reaches the report, the run log or rows.json.

## 5. Data policy check (register D-01, brief tiers)

- Every registry scenario has `syntheticOnly: true` (asserted by the runner).
- Practices, claims and tokens are synthetic and deleted at teardown. Teardown throws if any practice row remains.
- Reports hold outcome codes and booleans only. No transcript text and no identifiers are asserted or stored. The runner test greps the report, the run log and rows.json for every synthetic phrase.
- The D015 allowlist scenario passes placeholder values to `initiateCall`, which refuses before any request. An outbound interceptor wraps the whole run. Vapi is stubbed, and the test asserts that no request was blocked and none went to a real host.
- The stateful scenarios import synthetic claims through the real PMS pipeline. Teardown deletes every row that mentions the run, then sweeps every table for the run ids and for the synthetic identifiers, and throws if any residue is left.

## 6. Next batches, in order

| # | Batch | Why this order | Size |
|---|---|---|---|
| 2 | **Done except D020.** D014, D016, D019, E004 and E008 are bound at level S through the queue tick, the manual trigger route and the PHI vault. | Closes the dispatch layer. | S left |
| 3 | New Hold Sentinel scenario file for the behaviours the registry lacks: staff handoff, missed handoff, handoff edge cases, one transfer number, gate precedence, staff hours, NPI, disclosure timing, metering. Kept outside the generated registry so its hash and count stay valid. Maps to pre-call gate gaps 1 to 4. | This is the wedge. It has the most unit coverage and the least scenario coverage. | M |
| 4 | **Done.** All 18 stateful post_call scenarios are bound at level S through the signed webhook route. | Found the P017 defect. | done |
| 5 | Resolve the product results, most serious first: P017 (denial stored as paid), P013 (names not compared), E001 (cap allows 2 calls), P012 (transcript at rest, handoff item 4), then D017, P008, P014, P023, and the decisions D004, D012, P002 | Turns FAIL and FINDING into PASS or a recorded decision. | S each |
| 6 | Ops X scenarios that need no vendor (X003, X006, X001), checked one by one | Cheap, and they reduce the live-call list. | S |
| 7 | Consume the text conversation harness for the 105 conversation, 20 handoff and 5 ivr scenarios when it exists. Bind by id. | Second priority per the brief. Not duplicated here. | L |
| 8 | 45 IVR scenarios against the product through the twin | Needs a live squad dial. Blocked until the pre-call gate is met. | L |

## 7. Decisions recorded

See docs/DECISIONS-REGISTER.md rows dated 2026-11-23 for the scenario runner. Summary:

- The runner reports every registry scenario each run, with UNVERIFIED as the default.
- Product results (FAIL, FINDING) do not fail the vitest run, matching the Stage 1 convention, so a known product defect does not block unrelated pull requests. The verdict is in the report.
- New Hold Sentinel scenarios go in a separate file, not the generated registry.
