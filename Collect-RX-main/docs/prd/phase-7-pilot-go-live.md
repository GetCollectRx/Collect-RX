# PRD — Phase 7: Pilot Go-Live & Assumption Validation

**Status:** ⏳ Pending  
**Owner:** Khalid  
**Pilot scope:** First onboarded practice (tenant configured via signup + CSV/PMS import — no hardcoded practice name in code or env)  
**Duration:** 90 days  
**Dependencies:** Phases 0–5 complete; schema discovery done; credentials rotated  

---

## Problem Statement

CollectRx has three core assumptions that, if wrong, would fundamentally change the business model. Before investing in sales, expansion, or additional engineering, the pilot must validate or invalidate each assumption with real-world data. The 90-day pilot at the first onboarded practice is the controlled test.

---

## The Three Assumptions

| # | Assumption | Kill Condition |
|---|-----------|----------------|
| 1 | Canadian insurance carriers will accept AI callers | Any carrier issues a practice-level block that cannot be resolved |
| 2 | AI achieves sufficient resolution rates to justify the cost | Resolution rate < 60% sustained over 30 days |
| 3 | Dental practices will pay the proposed pricing | Pilot practice declines to continue at the stated price after pilot |

---

## Goals

- Collect statistically meaningful data on all three assumptions
- Operate without critical incidents (no permanent carrier blocks, no PHI breaches)
- Deliver measurable ROI to the pilot practice during the pilot period
- Identify product gaps discovered only under real conditions
- Confirm multi-tenant isolation (RLS + session scoping) under real PHI load

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
| Pilot owner NPS at day 90 | ≥ 8/10 |

---

## Functional Requirements

### Call Operations
- Automated claim queue processing: 30/45/60/90 day aging buckets worked daily
- Max 3 call attempts per claim before escalation to human
- Call window enforcement: Mon–Fri, 8am–5pm ET
- Carrier block detection: one block event suspends all calls to that carrier **for that practice** — no automatic retry
- Practice identity for carrier calls read from `Practice` row (billing phone, NPI, address) — not global env vars

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
- Webhook failure alert → ops email within 5 minutes
- Sync failure alert → ops email within 15 minutes
- Carrier block event → ops SMS immediately
- Weekly automated report to pilot practice owner: calls placed, claims resolved, revenue recovered

### Pilot Runbook
- Go-live checklist for on-call engineer (day 1)
- Pilot practice FAQ: what to expect, who to call if something breaks
- Rollback procedure if critical issue arises
- Pricing conversation script for day-90 renewal discussion

---

## Technical Constraints

- Carrier-specific behavior must live in JSON config — not code — for rapid mid-pilot adjustments
- Production API (Fly.io) must have 99%+ uptime SLA
- No schema changes during active pilot without migration and rollback plan
- All call audio and outcomes logged for post-pilot analysis
- PostgreSQL RLS enabled in production; platform workers use `app.rls_bypass` only where required

---

## Out of Scope

- Expansion to additional practices during pilot (focus on first-practice validation before multi-site rollout)
- TELUS AdjudiCare full integration (partial — basic support only in pilot)
- Automated pricing billing (manual invoice during pilot)

---

## Acceptance Criteria

**Week 1 (Go-Live)**
- [ ] Sync runs successfully against pilot site's AbelDent (if connector enabled) or CSV import complete
- [ ] First batch of calls placed without error
- [ ] Dashboard shows real claim data for the pilot tenant only
- [ ] Engineer on-call, monitoring for 8 hours

**Day 30 Checkpoint**
- [ ] Assumption 1 assessment: carrier acceptance rate documented
- [ ] Assumption 2 early read: resolution rate trend positive
- [ ] No permanent carrier blocks
- [ ] Pilot owner check-in: satisfaction ≥ 7/10

**Day 60 Checkpoint**
- [ ] Resolution rate ≥ 60% sustained
- [ ] ROI report generated: dollars recovered vs. estimated subscription cost
- [ ] Any carrier IVR changes identified and configs updated

**Day 90 (Pilot Close)**
- [ ] Final assumption validation report completed
- [ ] Pricing conversation with pilot practice conducted
- [ ] Post-pilot learnings documented for expansion playbook
- [ ] Decision: proceed to broader market expansion or pivot
