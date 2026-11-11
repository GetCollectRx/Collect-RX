# Shadow-Call Validation Protocol

**Date**: 2026-09-05
**Status**: PROPOSED, not yet executed
**Author**: Claude, at Khalid's request
**Supersedes nothing**: this is additive to voice-agent-sim/RUN-LOG-2026-07-10.md, not a replacement

---

## 1. Why this exists

The open question is not whether the AR-chase phone call is the right channel (research on 2026-09-05 supports that it is, aged AR resolution appears to genuinely require a conversation, not just a portal status lookup). The open question is narrower and has not been tested by anything currently in the repo:

**Does the AI agent's extracted answer (status, reason, expected payment date) match what a human staff member gets on the same call, and does the human conversation surface anything a scripted agent structurally cannot (an offer to expedite, a rep catching an error mid-call, a verbal escalation)?**

## 2. What the July 10 run already covers, and what it does not

The 2026-07-10 free baseline (490 tests, 100% pass) validated infrastructure: carrier configs, PHI boundary, CARRIER_BLOCK protocol, outcome processor, dispatch gates. Solid, but it is not the answer to the question above.

The scenario library in `SCENARIO-MASTER.csv` (S001-S025, R001-R010, E001-E010, T001-T010) is genuinely well built and already anticipates most of the rep-behavior edge cases worth worrying about: off-topic tangents, bot accusations, settlement pressure, vague non-answer loops, verbal escalation, IVR curveballs per carrier (RBC callback offer, TELUS French-first menu, Sun Life AI-screening prompt, Manulife mid-call disconnect), obscure denial codes, COB confusion, auth field mismatches.

Two things about that library matter for what it can and cannot tell us:

- R001-R010's "pass" status in the CSV reflects a static, pre-authored transcript graded against a rubric, not a live model reacting to an unscripted rep. It tests "if this happens, does the agent's scripted response follow policy," not "will the agent actually produce this response when it happens live."
- Phase 2 (live LLM eval of S001-S025 against a real model) and Phase 3 (live IVR research calls, no PHI, against real carrier phone trees) were both built but never executed, blocked on `ANTHROPIC_API_KEY` and `RESEARCH_VAPI_*` respectively. So even the existing plan has not been run against anything live.
- Nothing in the repo, run or unrun, compares the agent's output to an actual human staff call on the same claim. That comparison is the gap this protocol fills.

## 3. The protocol

### Objective
For a small, iterative sample of real (or structurally realistic) aged claims, place a human call and an AI call to the same carrier about a matched question, and diff the outcomes on a fixed rubric. Use the result to decide whether the current conversational sophistication (escalation handling, pressure resistance, etc.) is earning its keep, or whether a leaner status-extraction-only script would get the same practical outcome.

### Method
1. Select a claim (or a synthetic claim shaped like a real one, if no live pilot data exists yet, no PHI required for this test).
2. Same day, same carrier: one call placed by a human (you, or a design-partner practice's staff member), one call placed by the AI agent via the existing `RESEARCH_VAPI_*` no-PHI research-call path.
3. Log both outcomes independently, before comparing, so the human log isn't anchored by the AI's answer.
4. Diff on the rubric below.
5. Run in batches of 3 to 5 calls per carrier, not all 6 carriers at once. Stop and adjust the script after each batch rather than running the full matrix blind.

### Rubric (capture per call)

| Field | Human call | AI call | Match? |
|---|---|---|---|
| Status/code returned | | | |
| Plain-language reason | | | |
| Expected payment/resolution date | | | |
| Reference number / rep name captured | | | |
| Unprompted value-add (offer to expedite, rep flags an error, rep suggests a workaround) | | | |
| Number of transfers/holds | | | |
| Total call duration | | | |
| Anything the AI call could not obtain that the human call did | | | |

### Decision thresholds
- If AI matches human on status/reason/date consistently across a batch, and the only gaps are in the "unprompted value-add" row, that's evidence the current build's conversational depth (built for handling pressure, tangents, escalation) may be more than the core job requires, supporting a leaner Step 1.
- If AI misses status/reason/date on a meaningful share of calls, that's evidence the conversational sophistication already built is necessary, not excess, and the finding argues for finishing Phase 2/3 rather than descoping.
- Either outcome is useful. The point of running this in small batches is to get a real answer before committing further engineering either direction.

## 4. Prerequisites to actually run this
- `RESEARCH_VAPI_*` env vars and per-carrier approval (already gated in the repo; nothing new to build).
- A small set of test claims or structurally realistic synthetic claims to call about (no PHI needed for a first pass).
- Someone to place the matched human call and log it honestly, ideally someone who does this call today as part of their normal job, not you role-playing it.
- Optional, cheap: `ANTHROPIC_API_KEY` to also finish the already-built Phase 2 live eval on S001-S025 in parallel (~$0.50-1.00), which tests policy compliance under adversarial conditions, a different and complementary question from the human-baseline comparison above.

## 5. Immediate next steps
1. Decide who places the human-side calls and confirm they'll log honestly rather than from memory after the fact.
2. Pick the first carrier and 3-5 test claims to start the first batch.
3. Confirm `RESEARCH_VAPI_*` credentials/approval status (per the July 10 log, this was not yet set).
4. Run batch 1, fill in the rubric, decide before running batch 2.
