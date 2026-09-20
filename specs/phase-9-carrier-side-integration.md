# PRD: Phase 9 — Carrier-Side Structured Data Integration

**Status**: Draft (Speculative / Not Validated)
**Author**: Alex (Product)
**Last Updated**: 2026-07-27
**Version**: 0.1
**Stakeholders**: Eng Lead, Compliance, Business Development (unowned — see Open Questions)

---

## 0. Confidence & Validation Needed

This PRD is explicitly speculative. It documents a possible future direction, not a committed roadmap item. Before any part of this is scoped for engineering work, the following must be true and currently is not:

- **No carrier has been contacted.** No conversation, RFP, developer-program application, or informal outreach has occurred with Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, or TELUS AdjudiCare about structured data access. Everything below about carrier motivations is hypothesis, not evidence.
- **Carriers have no obvious incentive to reduce their own phone volume for a third-party vendor.** Call centers are existing sunk infrastructure for these carriers; CollectRx is not a party they have a pre-existing relationship or revenue arrangement with. It is equally plausible that carriers view automated third-party calling as a nuisance to restrict (see the existing `CARRIER_BLOCK` protocol, which exists precisely because this risk is real today) as it is that they'd welcome a structured integration.
- **Any claim in this document about which carrier(s) might be receptive is explicitly not researched fact.** This document does not name a "most likely" carrier to start with, does not estimate probability of any carrier agreeing, and does not imply a business development conversation is underway or imminent. Do not treat language elsewhere in this doc as evidence of carrier interest — none exists yet.
- **This is a business-development-led initiative, not an engineering-led one.** The engineering shape below is directional and cannot be finalized until a carrier actually specifies (or agrees to build) a real interface. Effort estimates in a normal PRD sense (T-shirt sizes, sprints) are not meaningful here because the biggest unknown is not technical.

The purpose of writing this now is to have a shared internal reference for what CollectRx would want to ask for and build if and when a carrier conversation becomes possible — not to signal that one is scheduled.

---

## 1. Problem / Opportunity

Today, 100% of carrier interaction happens via the Vapi voice squad dialing carrier IVR and rep lines (`IVR_Navigator` and `Claims_Agent`, per `Collect-RX-main/CLAUDE.md`). This works, but it inherits every constraint of a phone channel: call time windows (Mon–Fri 8am–5pm ET), max 3 attempts per claim, CRTC ADAD disclosure obligations on every rep-answered call (`Collect-RX-main/docs/compliance/crtc-disclosure-decision.md`), IVR-menu brittleness per carrier, and exposure to `CARRIER_BLOCK` if a carrier decides to suspend automated calls entirely. None of these constraints exist for claim status obtained via a structured data channel.

If any of the six carriers were willing to expose claim status (and ideally predetermination/eligibility data) through EDI or an API, CollectRx could retire the phone-based path for that carrier's claims entirely, which is materially cheaper, faster, and has zero CRTC disclosure surface (structured data exchange between two businesses is not a voice call).

## 2. Goals

- For any carrier that agrees to structured exchange, replace voice-based claim status checks with a data channel that returns equivalent or better status/reason-code information.
- Preserve the existing claim/queue/practice data model on the CollectRx side — the fetch mechanism changes at the boundary, not the internal architecture.
- Open a secondary revenue/relationship line: a carrier-facing analytics product, offered in exchange for integration cooperation.

## 3. Non-Goals

- This phase does not commit to building any specific EDI/API integration before a carrier agreement exists.
- This does not replace the voice squad for carriers that don't participate — CollectRx must support a permanent hybrid state (some carriers via phone, some via data) indefinitely, not treat structured integration as a full replacement milestone.
- This does not include renegotiating CDA/CDAnet-ITRANS membership terms, which are a separate legal/BD track from the API-per-carrier track (see Section 5).
- Not a spec for the carrier analytics product — that is sketched at a business-model level only (Section 6) and needs its own discovery cycle if it advances.

## 4. Target Users

This phase has two target users, which is unusual for a CollectRx feature and should shape how it's evaluated:

1. **Dental practices** (existing user) — benefit indirectly: faster, more reliable claim status, no voice-channel latency or IVR failure modes for participating carriers.
2. **The carrier itself** (new user type) — the actual buyer/gatekeeper of this phase. Requirements must be framed in terms of what reduces the carrier's cost or risk (e.g., fewer inbound calls to their provider line, structured data instead of ambiguous automated calls), not in terms of CollectRx's convenience.

## 5. What This Would Replace

For a participating carrier, `IVR_Navigator` and `Claims_Agent` become unnecessary for that carrier's claims. `Escalation_Closer` and `Resolution_Closer` may still have a role if the structured channel only covers status/reason codes and not resolution actions (e.g., disputing a denial might still require a human or voice step). The simplified flow: claim enters the queue exactly as it does today → dispatch layer checks whether the claim's carrier has a structured-data integration active → if yes, a data-fetch call replaces the outbound Vapi dial → response is normalized into the same claim-status/reason-code shape the voice squad produces today, so downstream reconciliation, dashboards, and practice-facing UI require no changes. The `CARRIER_BLOCK` and call-window rules become irrelevant for that carrier's traffic; whatever this new channel's equivalent rate-limit or SLA is (carrier-defined) replaces them.

## 6. Path to "Certified Partner" — Two Shapes, Not Yet Chosen

There appear to be two structurally different paths, and which one applies will vary per carrier — this cannot be resolved without carrier input:

- **Standard rail: CDAnet / ITRANS.** This is the existing Canadian Dental Association claims-submission network used for real-time claims by CDA-certified practice management software. Per CDA's own description, access is gated to dental-association members and CDA-certified PMS software (cda-adc.ca/en/services/cdanet) — it is not, on its face, open to a third-party AR-automation vendor like CollectRx. If this rail is usable at all, CollectRx would likely need to either become a CDA-certified software vendor in its own right, or partner with/operate through an already-certified PMS vendor. The engineering team should check `Collect-RX-main/src/server/preVisit/` for any existing CDAnet-adjacent code from the predetermination/eligibility work before scoping this — there may already be partial familiarity with the format in this codebase that this document has not fully inventoried.
- **Bespoke path: per-carrier API/EDI agreement.** Each of the six carriers may have its own provider-facing API, EDI 837/835-equivalent, or partner-integration program independent of CDAnet. This would mean six separate BD relationships, six separate technical integrations, and six separate maintenance surfaces — the opposite of the "carrier rules are data, not code" simplicity the eligibility engine already achieves for benefit rules.

Either path is materially more BD-effort than engineering-effort at this stage.

## 7. Secondary Opportunity: Carrier-Facing Analytics (Sketch Only)

One plausible lever to make integration attractive to a carrier: offer them a dashboard built from CollectRx's own claim-outcome data — turnaround time by carrier, denial-reason distribution, comparison against other carriers (anonymized), IVR/rep-line friction points. This would be a new product surface, sold or bartered to carriers rather than practices, and would need its own discovery, data-sharing/privacy review (carrier data about their own claims is not the same PHI-boundary problem as patient data, but still needs a real review), and pricing model before it's anything more than an idea. It is included here only as a possible BD bargaining chip, not as a committed initiative.

## 8. Directional Requirements (Non-Binding)

- Any structured integration must normalize into the existing claim-status/reason-code data model — no new parallel schema.
- PHI handling for a data-channel integration needs its own compliance review; the existing `docs/compliance/PHI-VAPI-BOUNDARY.md` Option B design was built for voice call variables specifically and should not be assumed to transfer as-is to an API/EDI context.
- Hybrid operation (some carriers voice, some data) must be the default assumption for the dispatch layer, not a transitional state.
- No carrier-specific code branching in the eligibility/reconciliation engine — the "rules are data, not code" principle should extend to the fetch mechanism where possible.

## 9. Open Questions

- [ ] Who owns carrier BD outreach — is this Product, founder-led, or a dedicated BD hire? Currently unowned.
- [ ] Has legal reviewed whether becoming a CDA-certified software vendor is feasible for a company CollectRx's size/stage?
- [ ] What would a carrier actually want in return (cost reduction proof, exclusivity, data-sharing terms)? Unknown until a real conversation happens.
- [ ] If one carrier agrees and five don't, does the hybrid-forever state (Section 6) hold up operationally and in the UI, or does it create confusing inconsistency for practices?
- [ ] Does the existing `preVisit` CDAnet-adjacent code (if any) already encode assumptions that would need to be revisited for a claims-status use case rather than predetermination?

## 10. Sequencing Note

This is almost certainly the longest-lead-time, most business-development-dependent phase on the CollectRx roadmap. Every other phase to date (eligibility engine, Abeldent connector, CSV import, load testing) has been within CollectRx's unilateral control to build and ship. This phase is gated on external parties agreeing to something they have no obligation to agree to, and no outreach has begun. It should stay in "Later" on the roadmap, with the trigger to advance being a real carrier conversation — not an engineering estimate.
