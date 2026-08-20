# PRD: Phase 10 — Data Platform & Consolidation (Speculative)

**Status**: Draft — not ready for review
**Author**: Alex (Product)
**Last Updated**: 2026-07-27
**Version**: 0.1
**Stakeholders**: TBD — see note below on ownership split

---

## This Phase Combines Two Unrelated Bets

Phase 10 was grouped in the roadmap brainstorm as "platform maturity, far-future" — but it is not one initiative. It bundles two decisions that have different owners, different risk profiles, and no dependency on each other:

1. **A data product** — selling aggregated, anonymized claims-processing benchmarking data to dental consultants, DSOs, or insurers. This is a product/data decision, owned by product and engineering, with real PHIPA/PIPEDA exposure.
2. **M&A / consolidation** — CollectRx acquiring smaller AR-automation competitors, or positioning to be acquired by a larger PMS/RCM platform. This is a corporate development and board-level decision, not a product decision at all.

The only thing these two ideas share is a time horizon (far-future, post-scale) and a vague "growth strategy" flavor. They do not share a technical dependency, a customer, a team, or a metric. Treating them as one "Phase 10" invites exactly the kind of muddled roadmap item this document process exists to prevent — a line item nobody can own, size, or say yes/no to as a single decision.

**Recommendation**: If either bet gets real traction — a customer asking to buy benchmarking data, or an acquisition conversation opening up — split it into its own PRD (for the data product) or an Opportunity Assessment routed to the executive team (for M&A), each with its own owner. Do not carry "Phase 10" forward as a combined roadmap item past this brainstorm. This document exists to record the ideas honestly, not to imply they are one shippable initiative.

---

## Sub-section A: Data / Analytics Product

**The idea**: Aggregate anonymized claims-processing data across CollectRx's practice base — turnaround times by carrier, denial rates by CDT code, resolution patterns by region — and sell it as a standalone benchmarking product to dental consultants, DSOs evaluating practice performance, or insurers interested in their own operational benchmarking.

**Hard dependency — this cannot precede Phase 5**: This idea is entirely downstream of the Cross-Org Intelligence anonymization and data-boundary work described in Phase 5. Phase 5 is where the actual hard problem lives: what queries are safe to run across tenant boundaries, what aggregation thresholds prevent a single practice's data from being inferable, and what the technical enforcement of "anonymized" actually means in this system. Nothing in Sub-section A is buildable, or even fully specifiable, until that foundation is solid and validated in production. If Phase 5 slips, ships partially, or reveals that safe cross-tenant aggregation is harder than expected, Sub-section A does not become a smaller version of itself — it becomes not-yet-possible.

**The regulatory constraint, stated plainly**: Small-sample aggregate data in healthcare is a well-known re-identification vector. This is not a generic SaaS privacy concern — it is a specific, documented failure mode in health data specifically. Even data that looks fully anonymized (e.g., "average claims turnaround for a 3-provider DSO in a mid-size Ontario market") can be re-identifiable when the underlying population is small, because the pool of practices matching that description may be a handful of businesses, some of which are identifiable by their competitors or by carriers with market knowledge. CollectRx's own PHI boundary work (`docs/compliance/PHI-VAPI-BOUNDARY.md`) governs patient-level PHI in the call pipeline; this is a related but distinct problem — practice-level and aggregate-level re-identification risk in a downstream data product, which the current PHI boundary decision record does not cover and was never scoped to cover.

**What this document is not doing**: proposing k-anonymity thresholds, aggregation minimums, differential privacy approaches, or any other specific technical mitigation. That work belongs in a real PRD, written after Phase 5 ships, informed by actual legal review — not asserted here as a placeholder.

**Before any product or engineering work starts on this idea**: legal/privacy counsel review is required up front, not as a launch gate at the end. Given the regulatory weight of PHIPA/PIPEDA in a healthcare-adjacent product, "get counsel to sign off before GA" is the wrong sequencing here — the review needs to inform (or kill) the idea before a PRD is even written, since the answer may be "the market you're aggregating is too small in Canada for this to ever be safely anonymized."

**Status**: Idea only. No RICE score, no user evidence, no committed owner. Not on the Now/Next/Later roadmap.

---

## Sub-section B: M&A / Consolidation

**The idea**: Either CollectRx acquires smaller regional AR-automation competitors (a roll-up strategy), or CollectRx positions itself to be acquired by a larger PMS/RCM platform, providing the AI voice layer on top of an existing practice-management distribution base.

This is a corporate development and business strategy decision — capital allocation, board-level, potentially involving investment bankers or M&A counsel — and it sits entirely outside product-engineering scope. It is recorded here only because the brainstorm asked for a named "Phase 10," not because it belongs in a product requirements document. There are no target users, functional requirements, or success metrics to write for an acquisition decision, and writing them would manufacture false depth where none exists yet. If this becomes a live conversation, it should be tracked by whoever owns corporate strategy at CollectRx, not by product.
