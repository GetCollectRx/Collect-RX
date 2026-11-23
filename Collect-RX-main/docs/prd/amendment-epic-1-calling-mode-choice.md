# PRD amendment: the practice chooses its calling mode

**Status:** Draft for the founder. Not yet part of either PRD.
**Owner:** Khalid
**Amends:** "CollectRx PRD: Hybrid Call Flow and Expansion" (Oct 28, 2026), Epic 1 and the "Product scope: one call flow, two endings" table. Also resolves decision D3 and the non-goal "Autonomous carrier conversation" in "CollectRx PRD v2: gap analysis, direction forward, path to complete" (Nov 20, 2026).
**Neither PRD is in this repository.** Before this is merged into them, check every statement here against the source.
**Decision record:** `docs/adr/0007-calling-mode-is-an-explicit-choice.md`. The Oct 28 PRD refers to a graduation decision as "ADR 0005" and the architecture bake-off as "ADR 0006"; neither is in the repository yet, so the mode-choice ADR is numbered 0007.

---

## What changes

| Where | Today | This amendment |
|---|---|---|
| Oct 28 PRD, Epic 1 | "Ending chosen by plan plus carrier graduation" | The practice chooses its mode. Plan and carrier approval decide what is available to choose, not the choice. |
| Oct 28 PRD, scope table, "Available when" for autonomous | Plan includes autonomy, practice has not kept Hold Sentinel on, carrier passes graduation evidence, founder has approved the carrier | Kept as the conditions under which autonomous is active for a carrier. Added: the practice must have chosen it, and the choice screen must show these conditions. See the open decision on whether they are a hard gate. |
| PRD v2, D3 (positioning) | Recommended: Hold Sentinel only; autonomous stays a graduation criterion, not the pitch | Decided by the founder on 2026-11-23: neither mode is the default entry. Hold Sentinel is recommended to risk-averse practices and is the confidence-building route into the larger product. Autonomous is available. |
| PRD v2, non-goals | "Autonomous carrier conversation" is out of scope | Autonomous remains unproven and is not claimed as ready. Building the choice and education is in scope; describing autonomous as working is not. |

## Problem

Practices and insurance-facing businesses resist what they do not understand. Some will not accept an AI speaking to an insurer on their behalf, and others want it. A product that offers only one answer loses one group. The evidence check in the Oct 28 PRD also says hold time as the headline pain is unproven, so the mode choice must be explained in terms of the practice's own situation, not a pitch.

## Goals

- A practice makes an informed, recorded choice of calling mode before any call is placed.
- Cautious practices are guided toward Hold Sentinel without being told it is the only option.
- A practice can change its mind at any time, per carrier.
- Onboarding gives the practice enough to explain the product to its own staff and privacy officer.

## Non-goals

- Setting autonomous prices. The Oct 28 PRD proposes core, growth and scale carry the autonomous ending at 50, 100 and 150 calls per location per month, prices not set, and waits for Epic 6 to measure cost.
- Removing the server-side forced Hold Sentinel override. That waits for the autonomous test program and the pre-call gate.
- Any change to the safety rules in the last section.

## Requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| CM-1 | A required setup step, "Choose how calls are handled", with no pre-selected option | A new practice cannot dispatch a call until a mode is recorded. The step appears in the setup checklist. Nothing is selected when it first loads. |
| CM-2 | Options: Hold Sentinel; Autonomous; Hold Sentinel with graduation per carrier | Each option shows who speaks to the rep, what staff do, what is recorded, and what the AI can see. |
| CM-3 | A short questionnaire recommends an option | The recommendation is shown, not pre-selected, and the user may choose any option. Only the chosen mode, the recommended mode, who chose and when are stored. Free-text answers are not stored. |
| CM-4 | A practice-level mode with a per-carrier override, changeable at any time | An in-flight call finishes under the mode it started with. A claim still queued uses the new mode at its next dispatch. A change is audit logged. |
| CM-5 | Existing practices keep their behaviour and confirm their choice once | No existing practice changes mode silently. |
| CM-6 | Education screens | A side-by-side comparison; a walkthrough of a call using synthetic data; a safety controls page; a privacy page; an exportable plain-language "How we use AI" summary. Reachable without leaving onboarding. |
| CM-7 | Per-carrier status shown on the choice screen: whether the carrier meets the conditions for autonomous (plan, graduation evidence, founder approval, terms check) | Derived from recorded evidence, never typed by hand. A carrier that does not meet the conditions shows why, and its calls use Hold Sentinel. |
| CM-8 | Guardrails for autonomous mode | Scope limits, escalation triggers, a no-commitment rule, live view with takeover, a daily summary. Specified after the autonomous test program reports. |
| CM-9 | The owner, and a role the owner delegates, may change the mode | PRD v2's proposed permission matrix gives the owner full access to practice settings, which covers this. It is a proposal until approved. |
| CM-10 | Every sentence on the education screens maps to a ledger row | PRD v2 principle 1 and R-001: nothing is stated at a proof level it has not reached. Autonomous is described as unproven until test results say otherwise. |

## Safety rules that apply in every mode

- Disclosure of the automated system, practice name and callback number within 10 seconds of a live rep answering.
- No patient identifiers in Vapi metadata; ephemeral call variables only; recording disabled; deletion after the call.
- CARRIER_BLOCK, the call window, the attempt limit, and escalation of claims over 90 days.
- Staff availability and the missed-handoff reference-number rule.
- No calls to real carriers during the build. The carrier terms and AI-caller check stays a launch gate for each carrier. The Oct 28 PRD notes one US insurer banned AI callers in April 2026 and that Manulife runs voice biometrics.

## How it is tested

PRD v2 defines a proof ladder (D document, U unit, S Stage 1 simulation, M mock Vapi, B browser walk, O owned-number run, C real carrier). A text-only conversation test is not on that ladder; it should be added as its own level so that it is never counted as O.

| Level | What |
|---|---|
| U | The mode model, the unchosen state, per-carrier precedence, and calls not dispatching until a mode is chosen. |
| S and B | A new practice journey: onboarding blocks calls until a choice is made; each option records correctly; a switch applies at the next dispatch. The choice and education screens load for every role that should see them and are refused for the rest. |
| Conversation test (text) | Autonomous agent prompts against simulated reps, scored against a fact sheet. Evidence for CM-7 and CM-8, not proof of live behaviour. |
| O and C | Gated. See the next section. |

## Gating on calls

The founder's standing directive of 2026-11-12 (`docs/operations/PRE-CALL-LOGIC-GATE.md`) places no call of any kind until its exit criteria are met, and the PRD v2 plan puts owned-number runs after the first four Phase 1 fixes (decision D11). Autonomous testing therefore starts with text conversations only.

## Decisions

| Decision | State |
|---|---|
| Is carrier approval for autonomous a hard gate, as the Oct 28 PRD says, or advisory? | **DEFAULT (register D-02), stands unless the founder vetoes.** The practice may choose autonomous, and each carrier activates only when it meets the conditions (plan, graduation evidence, founder approval, terms check). Otherwise that carrier uses Hold Sentinel and the screen says why. This satisfies both the Oct 28 PRD and the founder's 2026-11-23 direction that autonomous is not blocked. |
| Graduation thresholds | Starting figures exist in the Oct 28 PRD: at least 50 staff-handled calls, reference number captured on at least 90 percent, unresolved fields at most 15 percent, rep suspicion of automation at most 2 percent, at least 3 of 5 playbook categories. They are starting figures before any live data. |
| Autonomous plan placement and prices | Proposed in the Oct 28 PRD (core, growth, scale at 50, 100, 150 calls). Prices not set and waiting on Epic 6. Whether the $399 or the $799 figure is current for Hold Sentinel is also open. |
| Owner permission to edit setup | Proposed yes in PRD v2's matrix, pending approval. |
| Carrier block scope (this practice and its siblings, or every practice) | Open. It is gap 12 in the pre-call gate. |
| Existing practices: one-time prompt, or leave unchanged | Open. |
| French | Out of scope for the first release per PRD v2 (R-120 asks for a scope note). The education screens are English only until then. |

## Dependencies and order

1. This amendment is reconciled with both source PRDs and approved.
2. The mode model and the choice step (CM-1 to CM-5, CM-9) can be built without the open decisions.
3. The education screens (CM-6, CM-10) follow.
4. Carrier status (CM-7) and guardrails (CM-8) wait for the gate decision and the autonomous test results.
5. The forced override is removed only after the first autonomous results are reviewed and the pre-call gate is satisfied.

## Risks

- Offering autonomous raises CARRIER_BLOCK, disclosure and PHI-in-speech exposure. The education screens must say so plainly.
- Autonomous behaviour with a talking rep has not been tested. Describing it as ready would be unsupported.
- A choice screen that nudges toward one answer can read as manipulative. The recommendation must be easy to override and its reasons visible.
- Two documents now use the number 0005 for different decisions until the graduation decision is added to the repository and numbered.
