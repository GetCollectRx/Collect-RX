# PRD — Phase 7: Pilot Go-Live & Assumption Validation

> **Stale partner naming.** Canonical Phase 7: [`Collect-RX-main/docs/prd/phase-7-pilot-go-live.md`](../Collect-RX-main/docs/prd/phase-7-pilot-go-live.md) (generic first onboarded practice). Historical “Dr. Hasan / Tenth Line” references below are obsolete.

**Status:** ⏳ Pending  
**Owner:** Khalid  
**Pilot Partner:** Dr. Hasan — Tenth Line Family Dentistry, Ottawa  
**Duration:** 90 days  
**Dependencies:** Phases 0–5 complete; schema discovery done; credentials rotated  

---

## Problem Statement

CollectRx has three core assumptions that, if wrong, would fundamentally change the business model. Before investing in sales, expansion, or additional engineering, the pilot must validate or invalidate each assumption with real-world data. The 90-day pilot at Tenth Line Family Dentistry is the controlled test.

---

## The Three Assumptions

| # | Assumption | Kill Condition |
|---|-----------|----------------|
| 1 | Canadian insurance carriers will accept AI callers | Any carrier issues a practice-level block that cannot be resolved |
| 2 | AI achieves sufficient resolution rates to justify the cost | Resolution rate < 60% sustained over 30 days |
| 3 | Dental practices will pay the proposed pricing | Dr. Hasan declines to continue at the stated price after pilot |

---

## Goals

- Collect statistically meaningful data on all three assumptions
- Operate without critical incidents (no permanent carrier blocks, no PHI breaches)
- Deliver measurable ROI to Dr. Hasan's practice during the pilot period
- Identify product gaps discovered only under real conditions

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Carrier acceptance rate (calls not blocked) | ≥ 95% |
| Claim resolution rate | ≥ 60% |
| Average time-to-resolution vs. manual baseline | ≥ 40% faster |
| Dollars recovered in 90 days | Measurable and reported |
| System uptime | ≥ 99% |
| PHI incidents | 0 |
| Carrier block events | 0 permanent blocks |
| Dr. Hasan NPS at day 90 | ≥ 8/10 |

---

## Functional Requirements

### Call Operations
- Automated claim queue processing: 30/45/60/90 day aging buckets worked daily
- Max 3 call attempts per claim before escalation to human
- Call window enforcement: Mon–Fri, 8am–5pm ET
- Carrier block detection: one block event suspends all calls to that carrier practice-wide — no automatic retry

### Carrier-Specific Rules in Force
- **Sun Life:** EFT arrives within 2 business days of approval — use to detect payment stalls
- **Canada Life:** 5 business day SLA — do not call before day 7
- **TELUS AdjudiCare:** Identify TPA from member card before IVR — minimum wait day 21
- **All carriers:** AI disclosure at start of every call

### Escalation Protocol
- After 3 failed attempts: claim flagged in dashboard as `ESCALATED`
- Email notification to practice staff with recommended next action
- Escalation reason logged: `CARRIER_BLOCK`, `NO_ANSWER`, `DENIED`, `NEEDS_HUMAN`

### Practice SaaS Billing
- Stripe Billing Checkout / Customer Portal for the practice subscription only
- No patient/client payment collection

### Monitoring & Alerts
- Webhook failure alert → Khalid email within 5 minutes
- Sync failure alert → Khalid email within 15 minutes
- Carrier block event → Khalid SMS immediately
- Weekly automated report to Dr. Hasan: calls placed, claims resolved, revenue recovered

### Pilot Runbook
- Go-live checklist for Khalid (on-call day 1)
- Dr. Hasan FAQ: what to expect, who to call if something breaks
- Rollback procedure if critical issue arises
- Pricing conversation script for day-90 renewal discussion

---

## Technical Constraints

- Carrier-specific behavior must live in JSON config — not code — for rapid mid-pilot adjustments
- Backend on Railway must have 99%+ uptime SLA
- No schema changes during active pilot without migration and rollback plan
- All call audio and outcomes logged for post-pilot analysis

---

## Out of Scope

- Expansion to additional practices during pilot (focus on single-practice validation)
- TELUS AdjudiCare full integration (partial — basic support only in pilot)
- Automated pricing billing (manual invoice during pilot)

---

## Acceptance Criteria

**Week 1 (Go-Live)**
- [ ] Sync runs successfully against Dr. Hasan's Abeldent
- [ ] First batch of calls placed without error
- [ ] Dashboard shows real claim data
- [ ] Khalid on-call, monitoring for 8 hours

**Day 30 Checkpoint**
- [ ] Assumption 1 assessment: carrier acceptance rate documented
- [ ] Assumption 2 early read: resolution rate trend positive
- [ ] No permanent carrier blocks
- [ ] Dr. Hasan check-in: satisfaction ≥ 7/10

**Day 60 Checkpoint**
- [ ] Resolution rate ≥ 60% sustained
- [ ] ROI report generated: dollars recovered vs. estimated subscription cost
- [ ] Any carrier IVR changes identified and configs updated

**Day 90 (Pilot Close)**
- [ ] Final assumption validation report completed
- [ ] Pricing conversation with Dr. Hasan conducted
- [ ] Post-pilot learnings documented for expansion playbook
- [ ] Decision: proceed to Abeldent market expansion (3,700 practices) or pivot

---

## V2 Execution Layer

### Validation Mode (Mandatory)

- This phase is executed in **single-practice pilot validation mode**.
- Expansion work is blocked until the Day-90 decision marks assumptions as validated.

### Scope Lock

**In scope**
- Single-practice pilot operation, instrumentation, and assumption validation
- Weekly KPI reporting and incident response workflow
- Final go/no-go business decision package

**Out of scope**
- Concurrent onboarding of additional practices
- Automated billing and generalized GTM rollout

### Task Breakdown

| ID | Task | Owner | Estimate | Dependency |
|----|------|-------|----------|------------|
| P6-1 | Finalize pilot scorecard and KPI calculation definitions | Khalid | 0.5 day | none |
| P6-2 | Implement telemetry events for calls, outcomes, blocks, payments | Eng | 1 day | none |
| P6-3 | Build weekly pilot report pipeline and template | Eng | 0.5 day | P6-2 |
| P6-4 | Execute go-live checklist and day-1 on-call protocol | Khalid | 0.5 day | P6-1..P6-3 |
| P6-5 | Run day-30 and day-60 structured checkpoint reviews | Khalid | 1 day total | P6-4 |
| P6-6 | Compile day-90 assumption validation and pricing decision memo | Khalid | 1 day | P6-5 |

### Test Plan

- **Operational tests**
  - Simulate webhook outage and verify alert routing.
  - Simulate sync failure and verify runbook action timing.
- **Data quality tests**
  - Validate KPI formulas against raw event data weekly.
  - Reconcile reported recovery totals with payment records.
- **Pilot process tests**
  - Dry-run escalation email and practice support handoff flow.
  - Confirm block detection halts carrier calls immediately.

### Risks & Mitigations

| Risk | Trigger | Mitigation | Fallback |
|------|---------|------------|----------|
| KPI ambiguity weakens decision quality | Conflicting metric interpretations | Lock formula definitions before day 1 | Recompute all reports using canonical definition set |
| Carrier behavior shifts mid-pilot | Sudden IVR/menu changes | Keep carrier rules in config and patch within 24h | Temporary manual routing for impacted carrier |
| Pilot partner confidence drops | Sustained incidents or unclear ROI | Weekly transparent reporting + rapid incident follow-up | Pause automation and run assisted mode |

### Operational Runbook

- Publish weekly pilot summary every Friday (calls, outcomes, ROI, incidents).
- Declare incident severity levels with response SLAs:
  - Sev1: immediate SMS + active incident channel
  - Sev2: response within 30 minutes
  - Sev3: same-day triage
- Maintain decision log for all config changes during pilot.

### Exit Criteria (Go/No-Go)

- [ ] Day-30, day-60, and day-90 reports completed with signed owner review
- [ ] Assumption outcomes clearly marked Validated / Invalidated / Inconclusive
- [ ] Incident summary and mitigation effectiveness documented
- [ ] Pricing continuation decision recorded
- [ ] Expansion recommendation package delivered
- [ ] Explicit decision recorded: `scale`, `hold`, or `pivot` before any multi-practice work starts
