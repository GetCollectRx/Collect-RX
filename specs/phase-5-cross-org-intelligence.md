# PRD: Phase 5 — Cross-Org Intelligence

**Status**: Draft
**Author**: Alex (Product)
**Last Updated**: 2026-07-27
**Version**: 0.1
**Stakeholders**: Eng lead, Compliance/Legal (BAA + PIPEDA review), Group Admin design partners, CollectRx Ops

---

## Confidence & Validation Needed

This phase is speculative in a way Phase 4 was not. Phase 4 (Abeldent connector, CSV import) solved a known, observed problem for a specific pilot practice. Phase 5 assumes something we haven't yet verified: that CollectRx has enough organizations, of enough variety, generating enough claim volume, for cross-org aggregates to be statistically meaningful and non-identifying at the same time. As of 2026-07-26, platform pilot status is effectively zero active practices (see project memory). **Every requirement below should be read as "build when the precondition is met," not "build now."**

Before committing engineering time to any of the three areas, validate:
- **Minimum org count for anonymization to hold.** Benchmarking against "peers" requires a k-anonymity floor (see Privacy section). If we have 3 orgs on the platform, benchmarking is either impossible or trivially de-anonymizable. Validate we're within sight of that floor before building the aggregation pipeline.
- **Whether carrier-lesson volume is already platform-wide.** It is — `CarrierLesson` (`Collect-RX-main/src/server/learning/carrierLessons.ts`) has no `practiceId`/`organizationId` column; lessons are keyed by `carrierId` only, and approval by any `group_admin` at `/api/group/carrier-lessons/proposed` already affects every org's future calls to that carrier. Area 2 of this PRD is therefore an extension of an existing platform-wide asset, not a new data-sharing decision — that lowers the validation bar for Area 2 relative to Areas 1 and 3.
- **Whether we have enough labeled outcomes for Area 3.** Denial/outcome prediction needs a training set with real variance (resolved vs. denied vs. blocked, across carriers and claim types). Check volume before scoping a model, not after.

Recommendation: treat Area 2 (carrier scoring) as the first candidate for real work, since it builds on data that's already platform-wide and doesn't have the cross-org identifiability problem. Areas 1 and 3 should stay in the "Later" bucket on the roadmap until the org-count precondition is met.

---

## Problem / Opportunity

Multi-org support (Phase before this one) created isolated pools of claim-outcome data per organization. Each DSO's group_admin can see their own practices' resolution rate, denial patterns, and carrier friction — but has no way to know whether their numbers are normal, good, or a sign something is broken. Individually, a practice with a 55% resolution rate doesn't know if that's the market average or a red flag.

Separately, CollectRx's own carrier-facing intelligence (IVR navigation lessons, carrier block detection) is currently split across two different scopes: navigation *lessons* are already global by design, but block *detection* (`CarrierBlockEvent` in `Collect-RX-main/src/server/frontDesk/carrierBlockService.ts`) is practice-scoped only. That means Practice A can get blocked by Sun Life on Monday and Practice B can walk into the same block, unwarned, on Tuesday — even though the platform already knows.

Finally, today's call queue prioritization is rules-based (claim age, carrier SLA windows, retry count) with no signal from historical outcomes. As claim volume grows, the queue has no way to prefer claims that are statistically likely to resolve quickly over ones that are statistically likely to need escalation — every claim of a given age gets the same priority regardless of what the platform has learned from thousands of similar past claims.

Aggregate data across orgs is a genuine platform asset once there's enough of it. This phase defines how we'd use it without compromising the privacy commitments the platform is built on.

## Goals

1. Give group_admins a peer-benchmark view (resolution rate, avg days-to-resolve, denial rate) so they can tell if their organization's performance is normal, ahead, or behind — without ever seeing another org's identity or raw numbers.
2. Convert practice-scoped carrier block detection into a platform-wide carrier risk signal, so a block or emerging pattern discovered by one practice protects every other practice on the same carrier.
3. Use historical claim-outcome data to inform (not replace) call queue prioritization, so claims more likely to need escalation or more likely to resolve fast are appropriately sequenced.

## Non-Goals

- This phase does not change per-org data ownership or introduce any UI where one org can browse another org's raw claims, practices, or names.
- This phase does not build a general-purpose analytics/BI product for CollectRx Ops beyond what's needed to support the three areas above.
- This phase does not replace the existing rules-based dispatch priority (claim age, SLA window, CARRIER_BLOCK) — outcome prediction is an additional weighting signal, not a new dispatch engine.
- This phase does not extend the carrier-lesson review workflow's trust model (transcript-derived lessons still require human `group_admin` approval before injection — see `carrierLessons.ts`).
- No PHI, and no org-identifying performance data, leaves the boundaries defined below under any circumstance in this phase.

## Target User

- **DSO group_admin** (external): wants to know if their organization's carrier performance is competitive, and wants early warning before wasting call attempts on a carrier that's currently blocking automation platform-wide.
- **CollectRx Ops / platform_dev** (internal): needs a platform-wide view of carrier reliability to negotiate with carriers, tune the dispatch engine, and detect systemic problems (e.g., a carrier that silently changed its IVR structure) faster than any single org could.

---

## Functional Requirements

### Area 1 — Anonymized Peer Benchmarking

1. The system must compute, on a scheduled batch job (not per-request), three peer-benchmark metrics per organization size band: resolution rate, average days-to-resolve, and denial rate.
2. Size bands must be defined by practice count (e.g., 1, 2–5, 6–15, 16+) so a 2-practice DSO is never benchmarked against a 40-practice DSO.
3. A benchmark value must only be published for a size band with at least **k=5 contributing organizations**, testable by asserting the aggregation job refuses to write output for any band below that count.
4. The group_admin-facing view must show only the org's own value and the peer band's aggregate (median, and 25th/75th percentile) — never any other individual org's value, name, or a ranked list.
5. The aggregation job must read only structural claim fields (status, carrierId, submittedAt, resolvedAt) via a role scoped to aggregate counts only — never patient name, DOB, health card number, or free-text claim notes.
6. The API response for benchmarking must be rate-limited and must not accept parameters that could be used to iteratively narrow a peer band down to a single org (e.g., no arbitrary date-range or carrier-combination filtering that could isolate one contributor).

### Area 2 — Platform-Wide Carrier Performance Scoring

7. The system must compute a per-carrier reliability score (rolling 30/90-day resolution rate, average call duration to resolution, block-event frequency) aggregated across **all** practices and orgs on the platform, extending the existing carrier-scoped (not practice-scoped) design already used by `CarrierLesson`.
8. `CarrierBlockEvent` records, which are currently practice-scoped only, must feed a platform-wide "carrier risk state" (e.g., `carrierId` currently has N active blocks across N distinct practices in the last 24 hours) visible to `platform_dev` and factored into Requirement 9.
9. When a carrier crosses a defined block-frequency threshold platform-wide (e.g., 3+ independent practices blocked within a rolling 6-hour window), the system must surface a platform-wide advisory that throttles or pauses new automated dispatch to that carrier, distinct from and in addition to the existing per-practice CARRIER_BLOCK flag.
10. Carrier performance scores must be visible to `platform_dev` in full detail (including per-practice breakdown, since this is CollectRx's own operational data) and visible to `group_admin` only in aggregate, carrier-identified form (e.g., "Sun Life: 82% resolution, avg 11 days" — no practice or org breakdown).

### Area 3 — Denial/Outcome Prediction Feeding Dispatch Priority

11. The system must produce a claim-level outcome-likelihood score (e.g., probability of resolution within N days, probability of denial) using only structural, non-PHI features already present in the claim record: carrierId, claim age, procedure/CDT tier, prior attempt count, prior outcome codes for similar claims.
12. The outcome score must be surfaced as one additional weighted input to the existing rules-based dispatch priority function — never as a replacement for CARRIER_BLOCK checks, the 30-day minimum age rule, or the 90-day auto-escalation rule, all of which remain hard gates evaluated before priority scoring.
13. The prediction model (or heuristic, if a full model isn't warranted yet) must be retrained or recalibrated on a defined cadence (e.g., monthly) and must log its own precision/recall against actual outcomes so drift is visible.
14. There must be a kill switch (feature flag, consistent with existing `CSV_AR_FEATURES` flag pattern) that reverts dispatch to pure rules-based priority with no code deploy required.
15. No claim in the training or inference pipeline may carry patient name, DOB, or health card number — training data must be pulled from the same structural-field-only view used in Requirement 5.

---

## Privacy & Data Boundary

This is the hardest constraint in this PRD and the one most likely to be under-scoped if rushed.

**Two distinct boundaries are in play, and they are not the same problem:**

- **PHI boundary (already governed):** patient names, DOBs, health card numbers never leave the per-practice boundary except as ephemeral Vapi call `variables` at dispatch time, per `Collect-RX-main/docs/compliance/PHI-VAPI-BOUNDARY.md`. Nothing in this phase changes that decision record. All three areas above operate on structural claim metadata only (status, dates, carrier, CDT tier, outcome codes) — never on patient identifiers, free-text transcript content, or claim notes that could contain incidentally-captured PHI.
- **Org-identifiability boundary (new for this phase):** even PHI-free, aggregate performance data is competitively and reputationally sensitive between organizations. A DSO's resolution rate is business information; leaking it to a peer DSO (even anonymized-in-name but identifiable-by-elimination) is a trust breach the platform cannot afford, especially given multi-tenant billing already ties orgs together by size and tier.

**Controls required before any benchmarking data reaches a group_admin:**
- k-anonymity floor of 5 contributing orgs per published cohort (Requirement 3); the aggregation job must fail closed (return "insufficient peer data") rather than publish a value below that floor.
- No org name, practice name, or any free-text field crosses into a cross-org aggregate at any stage — aggregation reads only counts and computed rates.
- No filter combination in the benchmarking API may be expressive enough to re-derive a single contributor (Requirement 6); this needs adversarial review, not just a threshold check, before ship.
- The aggregation job runs under a distinct, narrowly-scoped internal role — not the per-request practice-RLS context used elsewhere in the codebase (see `runWithPracticeRls` in `rlsContext.ts`) — because it legitimately needs cross-practice read access that no single request-scoped role should have. That role must be audited the same way `PhiAccessEvent` audits PHI reads today.
- Carrier scoring (Area 2) does not have the org-identifiability problem in the same way, because CollectRx already legitimately aggregates carrier behavior across the whole platform for its own operations (carrier is the entity being scored, not the org) — but the practice/org-level breakdown behind that score must stay internal to `platform_dev`, never exposed to any `group_admin` (Requirement 10).

## Dependencies

- Minimum viable org count and claim volume on the platform (see Confidence section) — this blocks Area 1 entirely and partially blocks Area 3.
- A new internal, audited role/service account for cross-practice aggregate reads, distinct from `runWithPracticeRls`.
- Legal/compliance sign-off that aggregate, PHI-free, k-anonymized benchmarking does not require additional consent language in the org Terms of Service (likely yes, but not yet confirmed — flag for legal review, not assumed).
- Feature-flag infrastructure already in place (`CSV_AR_FEATURES` pattern) — reusable for Area 3's kill switch.
- Existing `CarrierLesson` and `CarrierBlockEvent` data models as the substrate for Area 2; no new data collection needed to start, only new aggregation and surfacing logic.

## Open Questions

- What is the actual org count and claim volume today, and what's the realistic timeline to hit k=5 per size band? (Blocks any Area 1 scoping decision.)
- Does platform-wide carrier risk state (Requirement 9) need a human-in-the-loop approval before auto-throttling dispatch, or can it act automatically the way per-practice CARRIER_BLOCK does today? Given CARRIER_BLOCK's own design treats automatic action as the safe default, this likely should too — needs explicit sign-off, not an assumption.
- Is a real predictive model warranted for Area 3, or does a simpler heuristic (e.g., weighted score from historical outcome rates by carrier + CDT tier) get 80% of the value at a fraction of the build and maintenance cost? Recommend starting with the heuristic and only justifying a model if the heuristic's precision is demonstrably insufficient.
- Who owns carrier-score ground truth when it disagrees with a specific org's lived experience (e.g., platform says Sun Life is 85% reliable, one DSO's admin insists it's blocking them constantly)? Needs a stated reconciliation process before this ships as advisory to `group_admin`.

## Rough Sequencing

1. **Now-gate (precondition, not a sprint):** confirm org count/volume trajectory; get legal sign-off on aggregate benchmarking data handling.
2. **First build candidate — Area 2 (carrier scoring):** lowest privacy risk, builds on existing platform-wide `CarrierLesson` data model, delivers value to CollectRx Ops immediately even before Area 1's org-count precondition is met.
3. **Second — Area 3 (dispatch priority), heuristic version:** ship the simple weighted-heuristic version behind a flag once Area 2's carrier scoring is live, since Area 3 can reuse Area 2's carrier reliability signal as one of its inputs.
4. **Last — Area 1 (peer benchmarking):** only once k=5-per-band is realistically achievable; this is the one area where shipping early actively risks a privacy incident rather than just shipping something low-value.
