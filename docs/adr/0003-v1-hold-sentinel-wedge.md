# ADR 0003: V1 product is Hold Sentinel; full AR recovery follows

**Status:** Accepted (founder decision; open items below)
**Date:** 2026-10-06 (records a decision made earlier, before commit `bdafe2e`, 2026-08-30)

## Context

By mid-2026 CollectRx had built the full insurance AR recovery process: ingest, triage, routing, carrier calls by an autonomous voice squad, outcome handling, payment verification, and denial and CDCP workflows.

The founder's mentor advised starting from the client's single biggest pain point instead of the whole process. For dental practices chasing aged insurance claims, that pain point is **staff waiting on hold with carriers**.

## Decision

1. **V1 is Hold Sentinel (human-assisted mode).** CollectRx dials the carrier, navigates the IVR, and waits on hold. When a live rep answers, the call is transferred to practice staff, who speak with the rep themselves. Squad: IVR_Navigator, Hold_Sentinel, Claims_Scribe. Code: `humanAssistedMode` (`Collect-RX-main/src/types/practiceSettings.ts`), squad selection in `queueEngine.ts`, transfer via `request_staff_handoff` in `src/webhooks/vapi.ts`.
2. **V1 is also the learning loop.** Claims_Scribe listens silently and logs a structured outcome for every staff-handled call (`HumanAssistedCallLog`). These logs are synthesized into per-carrier playbooks (`HumanAssistedCarrierProfile`, `src/server/learning/humanAssistedProfiles.ts`). That is how CollectRx learns what actually resolves claims with each carrier.
3. **The full AR recovery product (autonomous squad: Claims_Agent, Escalation_Closer, Resolution_Closer) comes after V1.** It stays built, but it is the destination, not the entry point.

## Why

- It sells the pain the client already feels, which is hold time, instead of asking a practice to trust an AI talking to insurers on day one.
- Staff stay on the rep conversation. That lowers carrier-detection risk (CARRIER_BLOCK), keeps judgment calls with people, and puts less PHI into AI-spoken conversation.
- It generates the training data the autonomous product needs: what real staff say and do on real carrier calls.

## Consequences

- Sales copy, onboarding, and the pilot should lead with Hold Sentinel and hold time recovered.
- V1's labour saving is the hold portion of each call only, because staff still handle the rep. The ROI case at $799/month must also rest on recovered dollars (see `docs/strategy/PRESSURE-TEST-2026-10-06.md`, section 4).
- Handoff reliability is now the critical V1 workflow: a transfer nobody answers wastes the hold.

## Open items (not decided by this ADR)

| Item | Current state |
|---|---|
| Default mode for new practices | Code defaults `humanAssistedMode` to `false` (autonomous). This contradicts the decision above until changed. |
| Criteria for moving a practice or carrier from V1 to autonomous | Not defined. Needs evidence thresholds (for example, playbook coverage per carrier, outcome accuracy of autonomous calls vs. staff calls). |
| Staff availability before transfer, and fallback when nobody answers | Not found in code review on 2026-10-06. |
