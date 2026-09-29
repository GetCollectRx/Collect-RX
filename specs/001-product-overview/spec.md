# Feature Specification: CollectRx Product Definition

**Feature Branch**: `001-product-overview`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "Define what CollectRx is: an AI-voice-agent platform that automates dental insurance accounts-receivable follow-up for Canadian dental practices, calling insurance carriers to check claim status and handle resolutions."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Practice Recovers Aged Claims Without Manual Calling (Priority: P1)

A Canadian dental practice has a backlog of outstanding insurance claims sitting with carriers (Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare). Instead of front-desk staff spending hours per week on hold with carriers, the practice relies on CollectRx's AI voice agents to place the calls, navigate carrier IVR systems, wait on hold, speak with a carrier representative, and report back claim status and next steps.

**Why this priority**: This is the core value proposition — AR recovery via automated carrier calling is the entire reason the product exists. Without this, there is no product.

**Independent Test**: Can be fully tested by importing a practice's claim data, letting an eligible claim enter the call queue, and confirming the system places a call, obtains a claim status/reason code from the carrier, and updates the claim record — without any human dialing a phone.

**Acceptance Scenarios**:

1. **Given** a claim past the carrier's minimum wait period (21 days for TELUS AdjudiCare, 32 days for all other carriers) and under 90 days old, **When** the claim enters the call queue during allowed calling hours (Mon–Fri, 8am–5pm Eastern), **Then** the system dispatches a voice-agent call to the correct carrier and records the outcome (status, reason code, or resolution) against the claim.
2. **Given** a claim reaches 90 days old without resolution, **When** the aging threshold is crossed, **Then** the system stops AI calling for that claim and escalates it to a human for manual handling.
3. **Given** a claim has already been called 3 times without resolution, **When** a 4th call would otherwise be scheduled, **Then** the system does not place another AI call and instead surfaces the claim for human follow-up.

---

### User Story 2 - Practice Onboards Without Requiring IT Integration (Priority: P2)

A new dental practice signs up for CollectRx, creates their practice profile, and gets their existing outstanding claims into the system — either by uploading a CSV export from their practice management software or, if they use AbelDent, by connecting the optional desktop sync tool. They begin a 30-day trial before deciding to subscribe.

**Why this priority**: Without a low-friction onboarding path, practices without AbelDent (the majority) cannot use the product at all — this determines the addressable market.

**Independent Test**: Can be fully tested by signing up as a new practice, uploading a claims CSV with no desktop software installed, and confirming imported claims appear correctly in the practice's queue within the 30-day trial limits (500 min/month, 50 min/day, no card required).

**Acceptance Scenarios**:

1. **Given** a new user with no AbelDent connection, **When** they sign up and upload a CSV of patient/claim data, **Then** their practice is created and the claims are validated and imported without requiring any desktop application.
2. **Given** a practice using AbelDent, **When** they install and configure the desktop sync connector, **Then** their AbelDent claim data syncs into the same claim queue used by CSV-onboarded practices.
3. **Given** a practice is within its 30-day trial, **When** it exceeds trial call-time caps for the day or month, **Then** further AI calling pauses until the cap resets or the practice upgrades.

---

### User Story 3 - Practice Trusts the System With Patient Data (Priority: P3)

A practice's compliance officer needs assurance that PHI (patient names, dates of birth, health card numbers) is never exposed to third-party AI voice infrastructure in a way that could create a PHIPA/PIPEDA compliance gap, and that if a carrier flags automated calling, the system stops calling that carrier immediately rather than continuing to risk the relationship.

**Why this priority**: This is a trust and compliance gate — a practice will not adopt or continue using the product if it creates regulatory or carrier-relationship risk, even if the core AR recovery works.

**Independent Test**: Can be fully tested by inspecting call metadata sent to the voice-agent platform (confirming only UUID tokens appear, never real patient identifiers) and by simulating a carrier-detected-automation event and confirming all queued and in-flight calls to that carrier halt immediately.

**Acceptance Scenarios**:

1. **Given** a claim is dispatched for an AI call, **When** metadata is sent to the voice-agent platform, **Then** only UUID tokens are present — no patient names, dates of birth, or health card numbers appear in metadata.
2. **Given** a carrier is flagged with CARRIER_BLOCK, **When** any code path attempts to schedule or continue a call to that carrier, **Then** the call is suspended immediately, not just the one currently in progress.

---

### Edge Cases

- What happens when a claim's practice has exhausted its billing tier's usage (trial cap, overage-pending, or payment failure)? Calling for that practice pauses until the billing condition clears, independent of individual claim eligibility.
- How does the system handle a claim for TELUS AdjudiCare where the underlying Third-Party Administrator (TPA) cannot be identified from the group number? The claim should not be dispatched to a carrier-specific IVR path until the TPA is identified.
- What happens when a carrier call reaches a live human before IVR navigation completes, or before the hold-monitoring stage hands off? The agent squad must hand off to the conversational agent the moment a human speaks, regardless of which stage triggered it.
- How does the system handle claims imported via CSV that fail validation (missing required fields, unrecognized carrier)? Those rows must be rejected from import with a reported reason, not silently dropped or silently defaulted into the queue.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let a dental practice onboard by creating its own practice profile through self-serve sign-up (no manual provisioning by CollectRx staff required).
- **FR-002**: The system MUST support importing outstanding claims via CSV upload for any practice, independent of practice management software.
- **FR-003**: The system MUST support an optional AbelDent desktop connector as an alternative claim data source for AbelDent-using practices.
- **FR-004**: The system MUST place outbound automated voice calls to insurance carriers to check claim status and drive claims toward resolution, covering at minimum Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, and TELUS AdjudiCare.
- **FR-005**: The system MUST restrict outbound calling to Monday–Friday, 8am–5pm Eastern time.
- **FR-006**: The system MUST cap automated call attempts at 3 per claim before requiring human follow-up.
- **FR-007**: The system MUST NOT enter a claim into the call queue before the carrier's minimum wait period has elapsed (21 days for TELUS AdjudiCare, 32 days for all other carriers).
- **FR-008**: The system MUST escalate any claim older than 90 days to human handling instead of continuing automated calling.
- **FR-009**: The system MUST immediately suspend all calling to a carrier — not just the current call — when that carrier is flagged as having detected automation (CARRIER_BLOCK).
- **FR-010**: The system MUST NOT expose patient names, dates of birth, or health card numbers to the voice-agent platform's persistent metadata; any patient identifier needed for a carrier call MUST cross only as an ephemeral value used for that call's dispatch, with detokenization occurring on the backend.
- **FR-011**: The system MUST enforce a 30-day trial period for new practices with a defined call-time allowance (500 minutes/month, 50 minutes/day) and no payment method required to start.
- **FR-012**: The system MUST gate automated calling on a practice's current billing state (trial limits, active paid tier, overage-pending, or payment failure), pausing calling when the practice is outside an allowed state.
- **FR-013**: The system MUST record the outcome of each carrier call (status obtained, reason code, resolution, or no-resolution) against the corresponding claim.
- **FR-014**: The system MUST identify the underlying Third-Party Administrator for TELUS AdjudiCare claims before routing a carrier IVR call, since TELUS AdjudiCare is a clearinghouse rather than a single insurer.
- **FR-015**: The system MUST provide a way for a human to take over a claim that has exhausted automated attempts, aged past the escalation threshold, or otherwise needs manual handling.

### Key Entities

- **Practice**: A dental practice using CollectRx; has a name, contact/billing information, a billing tier/trial state, and one or more staff users. Onboards via self-serve sign-up.
- **Claim**: An outstanding insurance claim owned by a practice, associated with a carrier, a patient (referenced via internal identifier, not exposed externally as PHI), an age (days since submission), a status, a call-attempt count, and a resolution outcome once closed.
- **Carrier**: One of the six supported Canadian dental insurers/clearinghouses; has a minimum claim wait period and a CARRIER_BLOCK state that gates all calling to it.
- **Call Attempt**: A single automated voice call placed to a carrier on behalf of a claim; has a timestamp, outcome, and links back to the claim it was placed for.
- **Billing/Usage Period**: Tracks a practice's call-time consumption against its trial or paid-tier allowance, gating whether new calls may be placed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A practice can go from sign-up to having its first claim actively worked by an AI voice call without any manual data entry beyond a CSV upload.
- **SC-002**: At least 78% of a practice's typical outstanding claim volume is addressable by automated calling, reflecting coverage of the six supported carriers' share of the Canadian private dental market.
- **SC-003**: Zero instances of patient name, date of birth, or health card number appearing in voice-agent platform metadata across all calls placed.
- **SC-004**: 100% of calls to a CARRIER_BLOCK-flagged carrier are suspended, with no automated call reaching that carrier after the block is set.
- **SC-005**: Practices reduce manual phone time spent on insurance follow-up compared to their pre-CollectRx baseline, as self-reported or measured via call-log comparison during onboarding.

## Assumptions

- "CollectRx" as defined here refers to the product described in `Collect-RX-main/` (the canonical Vite/React + Express/Prisma application), not the deprecated root-level prototype (`src/api` + `src/frontend`).
- Patient/client payment collection (e.g., Stripe Connect pay links) is out of scope for this product definition — CollectRx's scope is Practice → Insurance AR recovery, plus practice SaaS billing for CollectRx's own subscription revenue.
- The six supported carriers (Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare) represent the full initial carrier scope; adding a new carrier is a distinct, separately specified change per the process in `CLAUDE.md`.
- "Human escalation" is assumed to route to practice staff or a CollectRx-provided escalation workflow, not a specific named team — the exact escalation destination is an implementation detail outside this product definition.
- The Electron desktop app and AbelDent connector are assumed optional infrastructure for a minority of practices; CSV import is assumed to be the primary onboarding path for most practices.
