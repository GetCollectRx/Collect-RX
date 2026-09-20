# PRD: Phase 8 — Broader Revenue Cycle Management

**Status**: Draft
**Author**: Alex (Product)
**Last Updated**: 2026-07-27
**Version**: 0.1
**Stakeholders**: Eng Lead, Voice/Vapi Lead, Compliance, Product Leadership

---

## 0. This Reverses a Prior Product Decision

A prior version of CollectRx touched patient-facing billing and collections. That surface was deliberately removed. The evidence is in the codebase today: `Collect-RX-main/src/server/routes/groupAdminRoutes.ts` hardcodes `outstandingAR: 0` in the group practice-summary response, with the comment `// Patient AR removed — CollectRx is insurance-only`. This is a documented, intentional product boundary, not an oversight or a gap waiting to be filled.

I do not have context on **why** patient AR was removed — that reasoning isn't in the code or in anything I've reviewed for this PRD. Before any part of this initiative touches patient billing, that "why" needs to be surfaced and understood, most likely from whoever made the original call.

Because of that, this PRD treats the two RCM extensions below (prior authorization, denial appeals) as in scope because they are natural extensions of insurance-only AR — CollectRx continues to only ever talk to carriers, never bill or collect from patients. Patient billing/collections is called out separately at the end and is explicitly **not** designed here. Re-adding it requires a conscious, separate decision from product leadership — not something that should get built as a side effect of an engineer picking up a "Phase 8" ticket. If this document is used to scope work, the patient-billing section should not be actioned without that decision being made first and documented.

---

## 1. Problem Statement

CollectRx today is reactive on two of the highest-friction points in the insurance revenue cycle:

- **Pre-authorization**: The Eligibility Engine (`src/services/eligibility/`) produces a pre-treatment cost *estimate* using carrier rules data, but for procedures that require carrier pre-approval (many major and ortho procedures), the practice still has to separately submit and track a pre-auth request by phone or fax. The estimate and the pre-auth are currently disconnected — practices get a number, then do the real work of getting the carrier to commit to it manually.
- **Denial appeals**: When a claim comes back denied, resolution today depends on office staff noticing the denial, understanding the reason code, and manually drafting and calling in an appeal. This is the same manual-labor problem CollectRx already solved for claim-status follow-up, just one step further down the funnel — and it's currently unautomated.

Both are extensions of capability CollectRx already has (carrier rules data, carrier-calling voice infrastructure), not new product categories.

**Evidence**: Existing customer conversations and the eligibility engine's own reconciliation logic (`reconciliation.ts`, which already flags estimate-vs-actual variances >$50) point at pre-auth and denial handling as the two places where a correct estimate still doesn't guarantee a correct outcome. This PRD does not yet have dedicated interviews on pre-auth/appeals specifically — that's the first open item below, not a substitute for it.

---

## 2. Goals & Non-Goals

**Goals**
- Automatically initiate carrier pre-authorization requests for procedures the Eligibility Engine flags as requiring one, before treatment.
- Automatically draft and initiate a carrier-facing appeal when a claim is denied, using the existing voice-AI squad.
- Keep CollectRx strictly insurance-facing: no new patient communication, billing, or collections surface.

**Non-Goals (this phase)**
- Patient billing/collections of any kind (see Section 6).
- New carrier integrations beyond the existing six.
- Automated appeal *decisions* without a human review gate at launch (see Open Questions — full autonomy may come later, not v1).
- Redesigning the Eligibility Engine's estimate math; this phase builds on top of it, not into it.

## 3. Target User

Same as existing CollectRx users: front-desk and billing staff at Canadian dental practices, and DSO group admins overseeing multiple locations. No new persona is introduced.

---

## 4. In Scope — Part 1: Prior Authorization Automation

Extends the Eligibility Engine's pre-treatment estimate flow (`engine.ts`) from "produce a number" to "produce a number and, when required, get the carrier to commit to it."

**Functional requirements**
- Extend `carrier-configs.json` (data, not code, per the existing design rule) with a per-CDT-code / per-carrier flag for whether pre-authorization is required or recommended before treatment.
- When an estimate is generated for a flagged procedure, create a `PriorAuthRequest` record linked to the `eligibility_estimates` row, in a `PENDING` state.
- Dispatch a carrier call via the existing Vapi squad and Twilio pipeline to submit the pre-auth request, reusing `IVR_Navigator` and `Claims_Agent` roles rather than building new call infrastructure.
- Same PHI boundary as claim-status calls: UUID token in `metadata`, patient identifiers as ephemeral call `variables`, detokenized server-side at dispatch — no new PHI pathway.
- Capture the carrier's response (approved, denied, more-info-needed, no-response) and reconcile it against the original estimate; a pre-auth response that materially changes the estimate should re-trigger the existing reconciliation variance flag (>$50 threshold, matching current behavior).
- Respect all existing call rules unchanged: Mon–Fri 8am–5pm ET, max 3 attempts, CARRIER_BLOCK check before every dispatch.
- Surface pre-auth status in the practice UI wherever the estimate is already shown, not as a separate workflow the office has to learn.

---

## 5. In Scope — Part 2: Denial Appeals Automation

Extends the existing claim-status call infrastructure one step further down the funnel, using the **Escalation_Closer** Vapi agent role, which already exists specifically to handle denied/disputed claims.

**Functional requirements**
- When a claim's status transitions to denied (via existing webhook/status-update path), automatically generate a draft appeal packet: denial reason code, original claim data, and any supporting rationale derivable from carrier rules data (e.g., coverage the carrier's own published config supports).
- Route the draft appeal through a human-approval gate before any carrier contact — office staff review and approve/edit before dispatch, at least for v1 (see Open Questions on when/whether to relax this).
- On approval, dispatch a carrier call using the Vapi squad, extending `Escalation_Closer`'s existing role rather than introducing a new agent — it already owns the "handles denied/disputed claims" job description.
- Track appeal outcome (overturned, upheld, needs-more-info) as a first-class state on the claim, distinct from the original denial, so resolution reporting reflects the appeal's effect.
- Same PHI boundary, call-rule, and CARRIER_BLOCK constraints as all other carrier calls — no exceptions for this call type.
- Respect claim-age rules already in place (claims >90 days already escalate to human; an automated appeal should not re-automate work that's already been pulled to a human queue).

---

## 6. Out of Scope: Patient Billing / Collections

Not detailed in this PRD. Re-introducing any patient-facing billing, balance, or collections surface reverses a prior, deliberate product decision (Section 0) and requires an explicit decision from product leadership — including understanding why it was removed before — not a spec written alongside two unrelated, in-scope features. If leadership decides to pursue it, it should get its own PRD, its own discovery, and its own sign-off process, separate from this one.

---

## 7. Dependencies

- **Eligibility Engine** (`src/services/eligibility/`): pre-auth logic is additive to `engine.ts` and `carrier-configs.json`; no changes to the core estimate math (deductible/annual-max/COB logic) are anticipated.
- **Vapi Squad**: both features are extensions of existing agent roles (`IVR_Navigator`, `Claims_Agent`, `Escalation_Closer`) — no new agent is proposed. Any prompt/role changes go through the existing publish-via-API workflow, never dashboard-inline edits.
- **PHI boundary infrastructure** (`docs/compliance/PHI-VAPI-BOUNDARY.md`): reused as-is; no new PHI pathway is introduced by either feature.
- **CARRIER_BLOCK protocol**: both new call types must check this flag before dispatch, same as every existing call path.

---

## 8. Open Questions

- [ ] What's the actual demand signal for pre-auth and appeals automation specifically — do we have interviews or support-ticket volume, or is this inferred from adjacent pain? Needs discovery before this leaves Draft. Owner: PM.
- [ ] For denial appeals, does a human-approval gate stay permanent, or is there a path to autonomous dispatch for high-confidence appeal types? Needs a compliance and carrier-relationship risk read, not just a product call.
- [ ] Do any of the six carriers have documented pre-auth or appeals submission channels that differ meaningfully from their claim-status IVR (e.g., fax-only, portal-only)? This could change "voice call" from the default assumption to one channel among several.
- [ ] What is the actual context behind the original patient-AR removal (Section 0)? Needs to be answered before Section 6 is ever revisited, independent of this phase's timeline.

---

## 9. Rough Sequencing

1. Discovery: validate demand for pre-auth and appeals automation with practice interviews and carrier-channel research (answers Open Question 1 and 3).
2. Prior authorization: data-layer changes to `carrier-configs.json`, `PriorAuthRequest` tracking, and `IVR_Navigator`/`Claims_Agent` call extension.
3. Denial appeals: draft-generation logic, human-approval UI, and `Escalation_Closer` call extension — built after pre-auth so it can reuse any pattern established there for human review gates.
4. Patient billing/collections: not sequenced. Blocked on a separate product-leadership decision (Section 0), not on engineering capacity.
