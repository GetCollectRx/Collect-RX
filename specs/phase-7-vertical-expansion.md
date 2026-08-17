# PRD: Phase 7 — Vertical Expansion Beyond Dental

**Status**: Speculative Concept — NOT a committed roadmap item
**Author**: Alex (PM)  **Last Updated**: 2026-07-27  **Version**: 0.1
**Stakeholders**: Eng lead, founder — for discussion only, no build authorization implied

---

## Confidence & Validation Needed

**This document is a directional brainstorm, not a spec.** It is item 7 of a 10-item forward-looking exploration the user requested. Treat every claim below about "what would transfer" as a hypothesis, not a finding.

What has **not** been done, and must happen before any engineering time is spent:

1. **Customer discovery calls in target verticals (minimum 10-15 per vertical under real consideration).** We have zero conversations with optometry, physiotherapy, chiropractic, or veterinary practice owners/office managers about whether insurance-AR phone follow-up is a pain they'd pay to solve, how they currently handle it, and what their claim-denial/appeal volume actually looks like. Dental AR pain (the entire premise of CollectRx) was validated through direct practice relationships — no equivalent exists here.
2. **Confirming carrier/payer overlap is real, not assumed.** Section 4 below names carriers that plausibly overlap with our six dental carriers based on general knowledge of the Canadian group-benefits market. None of this has been verified against actual payer directories, and it must be confirmed with primary sources (carrier provider-relations pages, practice billing staff) before it factors into any prioritization decision.
3. **Confirming the voice-AI approach transfers.** Dental IVR navigation, disclosure timing, and claim-status conversation patterns were tuned against six specific carriers over multiple build phases. Nothing confirms a physiotherapy or optometry claim call follows a similar shape, uses the same IVR systems, or faces the same regulatory disclosure requirements (CRTC rules apply to any outbound automated call in Canada regardless of vertical, but the underlying phone workflows are unverified).
4. **A pilot-of-one before a platform investment.** Even after discovery calls suggest interest, the right next step is a manual, non-automated pilot with 1-2 practices in the target vertical (a human logging call transcripts) to validate the workflow shape before building a second rule engine.

CollectRx also has **zero active dental practices as of this writing** (see internal pilot-status memory) — pilot revalidation in the core vertical is a higher-priority open question than expansion into new ones. This PRD exists to frame the idea for later evaluation, not to argue it should be prioritized now.

---

## 1. Problem / Opportunity (Hypothesis)

Dental practices lose staff hours per week chasing insurance carriers by phone for claim status. If other healthcare verticals — optometry, physiotherapy, chiropractic, veterinary — have a structurally similar workflow (a practice submits a claim to a payer, waits, and someone has to call to check status or resolve a denial), the carrier-calling engine CollectRx built for dental may generalize. This would let CollectRx expand total addressable market without starting from zero on the hardest-built piece: the voice-AI carrier-calling infrastructure.

This is unconfirmed. It is plausible on its face because insurance AR-chasing is a generic administrative pain across regulated healthcare billing — but "plausible on its face" is exactly the kind of unvalidated assumption this document is flagging, not endorsing.

---

## 2. Goals (If Validated)

- Determine whether a second vertical is worth a scoped pilot investment, not whether to build one now.
- Identify which parts of the current stack are genuinely vertical-agnostic vs. which require a parallel, vertical-specific build.
- Surface the specific validation work needed before any engineering commitment, so a future decision-maker has a checklist rather than a vibe.

## Non-Goals

- This is not a decision to build a second vertical.
- This is not a technical design or migration plan.
- This does not commit engineering time, a timeline, or a specific vertical choice.
- This does not replace or deprioritize dental pilot-acquisition work, which remains the more urgent open problem.

---

## 3. What's Reusable vs. What Requires a Parallel Build

**Genuinely reusable (vertical-agnostic by design already, based on reading the current architecture):**

- **Vapi 4-agent squad architecture** (IVR_Navigator → Claims_Agent → Escalation_Closer → Resolution_Closer) — the handoff pattern (navigate IVR → gather status → handle escalation → confirm resolution) is a generic insurance-call shape, not dental-specific logic. The agents' *prompts and carrier-specific IVR hints* are dental/carrier-specific; the squad *orchestration pattern* is not.
- **Queue engine and dispatch/fairness logic** — call scheduling, retry limits, Mon-Fri/8-5 windowing, multi-practice fairness — these operate on claims as generic records and don't reference dental concepts.
- **CARRIER_BLOCK safety protocol** — this is carrier-relationship risk management, not dental-specific. It would need to extend to a generic "payer" concept but the mechanism (suspend all calls to a detected-automation payer immediately) transfers directly.
- **Multi-tenant `Practice`/`Organization` data model** — the base entity (a billing entity with identity fields, Stripe billing, users, roles) is generic administrative-practice modeling, not dental-specific.
- **PHI boundary pattern (UUID tokens in metadata, ephemeral variables at dispatch)** — this is a PHIPA/PIPEDA-driven architecture pattern applicable to any regulated health data, not dental-specific.

**Dental-specific — would require a parallel, vertical-specific build:**

- **CDT procedure codes and coverage-tier mapping** (`cdt-codes.ts`, 300+ codes mapped to preventive/basic/major/ortho tiers) — this has no equivalent yet for optometry (which likely uses different procedure/service coding, possibly CPT-adjacent or vision-plan-specific schedules), physiotherapy, chiropractic, or veterinary (which, notably, has no human-insurance regulatory framework at all — pet insurance is a fundamentally different payer relationship, often reimbursement-to-owner rather than direct billing).
- **`carrier-configs.json` rules** (coverage %, deductibles, annual max, waiting periods, frequency limits) — entirely dental-plan-specific even for the *same* carrier (e.g., Sun Life's dental benefit structure tells us nothing about Sun Life's vision or paramedical benefit structure, which are usually separate plan riders with separate rules).
- **Carrier IVR menus and call scripts** — each carrier's phone tree, hold patterns, and rep conversation flow were mapped for dental claims specifically; a physiotherapy claim call to the same carrier may route through a completely different IVR path (paramedical/extended-health benefits vs. dental benefits are frequently separate systems even within one insurer).
- **Compliance/disclosure requirements** — CRTC ADAD disclosure rules are federal and vertical-agnostic (they'd apply the same way), but any vertical-specific regulatory bodies (e.g., provincial veterinary colleges, physiotherapy regulatory colleges) and their rules on automated communications to third parties are unverified and would need separate legal review per vertical.
- **Eligibility/estimate engine math** — `deductible.ts`, `annual-max.ts`, `cob.ts` encode dental-benefit-specific rules (e.g., ortho lifetime max tracked separately, TELUS TPA identification for dental plans). Extended-health/paramedical benefit structures (common for physio, chiro) often work differently — visit-count limits per calendar year rather than dollar-tier annual maximums, for example — and this is a guess, not a confirmed fact.

---

## 4. Data Model Concept: Does "Practice" Generalize?

The current `Practice` model (Prisma) is a reasonably generic billing-entity shape — name, timezone, billing/fax/address fields, Stripe subscription state, users, roles. Nothing in its core fields is dental-specific by name.

However, the model has no `vertical` or `verticalType` field today, and rule loading is currently implicit — the eligibility engine assumes dental CDT codes and dental carrier configs unconditionally. Two directional options, neither validated against real requirements:

- **Option A — vertical as a first-class field on `Practice`/`Organization`.** Add a `vertical` enum (`dental`, `optometry`, `physio`, ...) that determines which procedure-code table and which carrier-config ruleset loads for that practice. This keeps one platform, one queue engine, one squad-orchestration layer, with vertical-specific rule packs swapped in — analogous to how `carrier-configs.json` is already externalized as data, not code.
- **Option B — separate rule-engine modules per vertical, practice model unchanged.** Keep `Practice` generic, but each vertical ships its own `src/services/{vertical}/` engine (mirroring `src/services/eligibility/`) with its own types, procedure-code map, and carrier configs, selected at the application layer rather than via a DB field.

Option A is directionally cleaner (single source of truth for "what kind of practice is this") but has migration implications for existing dental practices and touches the `PracticeRole`/settings surface. Option B is lower-risk to ship without touching the existing dental data model but risks duplicated plumbing across verticals over time. **Neither has been scoped — this is a two-paragraph sketch, not a design.**

---

## 5. Which Vertical Looks Most Promising? (Unconfirmed)

I do not have confident, sourced information on carrier/payer overlap between dental and other Canadian healthcare verticals, and I am not going to fabricate specific overlap percentages or claims here. What I can say directionally, to be validated:

- **Physiotherapy and chiropractic** are the most plausible first bets *if* overlap holds, because extended-health/paramedical benefits (which cover physio, chiro, massage) are frequently administered by the *same major Canadian group insurers* we already call (Sun Life, Canada Life, Manulife, Green Shield are all major extended-health administrators, not just dental administrators) — but whether that means the *same claims department, same IVR system, and same phone number* as dental is unverified and could easily be false (insurers commonly separate dental adjudication from extended-health/paramedical adjudication into different systems).
- **Optometry** is a plausible second bet for the same reason (vision is often bundled into extended-health plans with the same major insurers) but vision claims sometimes route through third-party vision-specific administrators (e.g., separate vision networks) rather than the base insurer, which would break the overlap assumption entirely.
- **Veterinary** is the weakest bet structurally: pet insurance is a fundamentally different payer relationship (usually reimburse-the-owner, not direct-bill-the-provider), which likely eliminates most of the "call the carrier to check claim status on behalf of the practice" workflow that CollectRx automates. This is worth flagging as probably not a good first bet without stronger evidence otherwise.

**This entire section requires validation before being used to prioritize anything.** The correct next step, if this idea is pursued further, is not engineering — it's calling the actual carrier provider-relations lines to ask whether dental and paramedical/vision claims share the same call queue.

---

## 6. Target User (Hypothetical)

Office manager or billing coordinator at a physiotherapy, chiropractic, or optometry clinic in Canada, currently spending manual phone time chasing extended-health or vision claim status with insurers — structurally analogous to the dental office manager CollectRx serves today. Unconfirmed persona; no interviews conducted.

---

## 7. Directional (Not Committed) Requirements

If validation clears the above open questions, a first-pass concept would need to address, at minimum:

- A vertical-selection mechanism on the practice/organization model (see Section 4)
- A parallel procedure-code and coverage-tier rule set for the chosen vertical, built the same "data not code" way as `carrier-configs.json`
- Confirmed carrier/payer IVR menus and call-navigation scripts specific to that vertical's claim type, even where the underlying insurer is the same as a dental carrier
- Legal review of any vertical-specific regulatory body's rules on automated outbound calls, in addition to CRTC (which applies regardless of vertical)
- A non-automated, human-run pilot to validate the workflow shape before any voice-AI build begins

---

## 8. Open Questions (Must Resolve Before Any Build Decision)

- [ ] Do physiotherapy/chiro/optometry practices in Canada actually experience meaningful phone-based AR pain with insurers, at a volume that would justify automation? (Requires: 10-15 discovery interviews per vertical.)
- [ ] Do the major Canadian group insurers route dental and paramedical/vision claims through the same phone system, or separate ones? (Requires: direct confirmation with carrier provider-relations lines or credible primary-source documentation, not inference.)
- [ ] What is the actual procedure-coding standard for each candidate vertical, and how many distinct codes/tiers would need mapping? (Requires: research per vertical — this is unknown, not assumed to be CDT-equivalent in structure.)
- [ ] Are there vertical-specific regulatory bodies whose rules on automated communications differ from or add to CRTC requirements? (Requires: legal review per vertical before any pilot.)
- [ ] Given CollectRx currently has zero active dental practices, is vertical expansion the right sequencing question at all right now, versus re-validating and re-acquiring in the core dental vertical first? (This is a business-sequencing question for the founder, not an engineering question — flagged here, not answered.)
- [ ] If a vertical is chosen, is Option A or Option B (Section 4) the right data-model direction? (Requires: real requirements from Q1-Q3 above before this can be scoped meaningfully.)
