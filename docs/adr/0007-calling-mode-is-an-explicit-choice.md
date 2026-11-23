# ADR 0007: Calling mode is an explicit onboarding choice; autonomous calling is available

**Status:** Proposed (founder direction given 2026-11-23; recorded here for the founder's review before any code changes)
**Date:** 2026-11-23
**Numbering note:** the Oct 28 PRD refers to a graduation decision as "ADR 0005" and the architecture bake-off as "ADR 0006". Neither is in this repository yet, so this ADR takes 0007 to avoid a clash.
**Supersedes in part:** ADR 0003 (decision item 3 and the open items "Default mode for new practices" and "Criteria for moving a practice or carrier from V1 to autonomous"), and ADR 0004 (stage 3, and the enforcement bullets that force Hold Sentinel when a plan has no autonomous calling).

## Context

ADR 0003 made Hold Sentinel the V1 entry point and called autonomous calling the destination. ADR 0004 then put autonomous calling on no plan, and the server enforces that: `effectiveHumanAssisted` in `Collect-RX-main/src/billing/entitlements.ts` forces Hold Sentinel, `queueEngine.ts` and `preVisitDispatch.ts` rely on it, saving the setting as off is rewritten to on, and the settings toggle is locked. New practices default to Hold Sentinel.

Founder direction on 2026-11-23:

- The fully autonomous path is not blocked.
- Neither mode is the default entry. Hold Sentinel is the recommendation for risk-averse practices and insurance-facing businesses, and a way to build confidence before moving to the larger product.
- Practices and insurance-facing businesses will resist what they do not understand, so onboarding must educate them, not only ask them to pick.

## Decision

1. **The calling mode is an explicit choice.** Onboarding gets a required step, "Choose how calls are handled". No option is pre-selected. Calls do not start for a new practice until a choice is recorded.
2. **Options.** Hold Sentinel (the AI navigates and waits, staff speak with the rep), Autonomous (the AI speaks with the rep), and Hold Sentinel with graduation per carrier.
3. **Recommendation, not default.** A short questionnaire recommends an option. The user may choose any option regardless. Hold Sentinel is the recommendation for cautious practices.
4. **Granularity.** A practice-level mode with a per-carrier override. A practice can return to Hold Sentinel at any time, including for claims already queued.
5. **Autonomous calling is no longer withheld by plan placement or by a server-side forced override.** Where it sits on the pricing plans is an open decision (below).
6. **Education is part of the product.** The choice screen compares the modes side by side. The product also provides a walkthrough of a call, a page on safety controls, a privacy page, and an exportable plain-language summary of how the practice uses AI, written for its privacy officer.
7. **Readiness is shown from evidence.** Per carrier, the product may show a readiness label (proven, early, untested) derived from test and call results. This is information, not a block. Whether to show labels is an open decision.

## Safety rules that do not change in either mode

- Disclosure of the automated system, practice name and callback number within 10 seconds of a live rep answering (`docs/compliance/crtc-disclosure-decision.md`).
- The PHI boundary: no patient identifiers in Vapi metadata, ephemeral call variables only, recording disabled, deletion after the call (`docs/compliance/PHI-VAPI-BOUNDARY.md`).
- The CARRIER_BLOCK protocol.
- The call window, the Ontario holiday rule, the attempt limit, and the over-90-day escalation.
- The practice escalation phone number and the missed-handoff reference-number rule.

## Why

- A practice that does not understand what runs on its behalf will push back. A visible choice, with the reasons for each option, turns that resistance into a decision.
- Forcing one mode removes a legitimate option from customers who want it and from the sales conversation.
- A recommendation that is shown but not pre-selected keeps the cautious path easy without presenting it as the only path.

## Consequences

- Production code changes are needed and are not part of this ADR: a mode model with an unchosen state, a per-carrier override, a new setup step, removal of the forced override in `entitlements.ts`, `queueEngine.ts` and `preVisitDispatch.ts`, and an update to the settings screen and Billing copy.
- Existing practices keep their current behaviour. They see a one-time prompt to confirm their choice; nothing changes silently.
- Autonomous calling has not been tested with a talking rep, in a simulation or on a real call. Describing it to customers as ready would be unsupported until the autonomous test program has results. The readiness labels in decision 7 depend on that evidence.
- The owner role cannot currently edit setup. Choosing the mode is an owner decision, so that permission must change first.

## Open decisions

| Decision | Owner |
|---|---|
| Which plan includes autonomous calling, and at what price | Founder |
| Show per-carrier readiness labels to customers, or not | Founder |
| Handling of existing practices: one-time confirmation prompt, or leave unchanged | Founder |
| Owner role permission to edit setup | Founder |
| Graduation thresholds (for example outcome accuracy against staff calls, handoff miss rate, zero carrier-block incidents) | Founder, after test results |
| Scope of CARRIER_BLOCK: one practice and its sibling locations, or every practice | Founder |
