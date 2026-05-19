# PRD — Phase 7: Pilot Go-Live & Assumption Validation

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

### Patient AR Collection
- SMS/email reminders: day 7, 21, 45 after insurance adjudication
- Stripe Connect payment links: payment routes directly to practice
- Reminder rate limiting: max 5 reminders per patient per cycle

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
