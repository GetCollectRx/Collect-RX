# Production Monitoring & Alerts Specification

**Purpose**: Real-time safety net for staged voice agent deployment  
**Audience**: Ops team, on-call engineer, product (via dashboard)  
**Effective date**: Immediately upon staging deploy  
**Review cadence**: Daily during ramp-up week, weekly thereafter

---

## Critical Metrics (Must-Monitor)

### 1. CARRIER_BLOCK Events (Highest Priority)

**What**: Carrier has signaled refusal of AI calls or auto-suspend triggered.

**Telemetry Point**: 
```
event: "CARRIER_BLOCK_TRIGGERED"
carrier: "sun_life" | "canada_life" | "manulife" | "green_shield" | "rbc" | "telus_adjudicare"
reason: "post_disclosure_hangup" | "compliance_flagged" | "too_many_failures" | "explicit_refusal"
timestamp: ISO-8601
call_id: "call_xyz"
```

**Alert Threshold**:
- **CRITICAL** (page on-call immediately): 1 CARRIER_BLOCK event
- **Action**: Pause all calls to affected carrier; notify Khalid; initiate carrier outreach
- **Recovery**: Manual unblock via `/api/carriers/{id}/unblock` after carrier confirms resumption OK

**Dashboard**: Show by carrier, timeline, reason breakdown

---

### 2. False Escalations (Operational Efficiency)

**What**: Agent escalated a claim as "Needs Human Follow-Up" when it could have been resolved.

**Telemetry Point**:
```
event: "FALSE_ESCALATION_DETECTED"
scenario_id: "R001" | "R002" | ... (from robustness eval)
claim_id: "CLM_xyz"
reason: "ambiguous_rep_answer" | "incomplete_data" | "timeout" | ...
timestamp: ISO-8601
practice_id: "practice_xyz"
```

**Alert Threshold**:
- **WARNING** (email ops + Slack): >15% false escalation rate in 1-hour window
- **CRITICAL** (page): >25% in 1-hour window
- **Target**: <10% (from validation run)

**Dashboard**: Show by hour, by carrier, trending

---

### 3. Hard Constraint Violations (Safety Gate)

**What**: A hard rule was broken (aging <32 days called, PHI leaked, etc.)

**Telemetry Point**:
```
event: "CONSTRAINT_VIOLATION"
constraint: "AGING_MIN_32_DAYS" | "PHI_BOUNDARY" | "CARRIER_BLOCK_NOT_RESPECTED" | "UNAUTHORIZED_SETTLEMENT"
claim_id: "CLM_xyz"
timestamp: ISO-8601
severity: "critical"
```

**Alert Threshold**:
- **CRITICAL** (page immediately): ANY violation (zero tolerance)
- **Action**: Immediate incident response; disable affected queue; root-cause analysis

**Dashboard**: Should be zero; any event is high visibility

---

### 4. Hallucination Catch Rate (Validation)

**What**: Post-call validation caught an agent hallucination before it reached practice.

**Telemetry Point**:
```
event: "HALLUCINATION_CAUGHT"
gate: "source_verification" | "read_back" | "consistency" | "absence" | "authority" | "webhook"
claim_id: "CLM_xyz"
what_was_caught: "false_reference_number" | "amount_mismatch" | "conflated_claim" | ...
timestamp: ISO-8601
outcome_before: "Resolved"
outcome_after: "Needs Human Follow-Up"
```

**Alert Threshold**:
- **INFO** (no alert, just log): Expected; indicates gates are working
- **WARNING** (email): >1 per hour suggests gate tuning needed
- **CRITICAL**: If hallucination escapes to practice (outcome sent before catch)

**Dashboard**: Show catch rate, gate effectiveness, hallucination types

---

### 5. Escalation Discipline (Quality)

**What**: Agent correctly escalated when it should have (true positive) vs. false positive.

**Telemetry Point**:
```
event: "ESCALATION_DECISION"
scenario_id: "R003" | "S011" | ... (robustness test or live)
claim_id: "CLM_xyz"
decision: "escalate_to_human"
reason: "aging_75_plus" | "conflated_claim" | "vague_answer" | ...
ground_truth: "correct_escalation" | "false_escalation" | "missed_escalation"
timestamp: ISO-8601
```

**Alert Threshold**:
- **WARNING** (email): >10% false escalations in 4-hour window
- **CRITICAL** (page): >20% or any missed escalation (aging >75 days called)
- **Target**: 95%+ accuracy (from R001-R010 validation)

**Dashboard**: Confusion matrix (escalate vs don't escalate, correct vs wrong)

---

### 6. Aging Rule Enforcement

**What**: Claims are being queued/called in correct age windows.

**Telemetry Point**:
```
event: "CLAIM_QUEUED" | "CLAIM_CALLED"
claim_id: "CLM_xyz"
days_since_submission: 28
age_check_passed: true | false
reason_if_failed: "too_young_28_days" | "too_old_102_days"
timestamp: ISO-8601
```

**Alert Threshold**:
- **CRITICAL** (page): Any call to claim <32 days old (hard constraint)
- **WARNING** (email): Any claim 75+ days called without automatic escalation
- **Target**: 100% compliance (zero violations)

**Dashboard**: Show age distribution of queued/called claims

---

## Non-Critical Metrics (Informational)

### Success Metrics (Validate Frameworks)

| Metric | Target | Staging Window |
|--------|--------|-----------------|
| Robustness scenarios (R001-R010) pass rate | 90%+ | Measure daily |
| Hallucination catch rate | 100% | Track weekly |
| CARRIER_BLOCK response time | <30s | Measure on event |
| Escalation accuracy | 95%+ | Measure after 100 calls |

### Health Metrics (Baseline)

| Metric | Purpose |
|--------|---------|
| Call success rate | % reaching live rep |
| Average call duration | Detect IVR changes |
| Rep disconnect rate | Detect carrier issues early |
| Claim resolution rate | % Resolved vs Pending vs Needs Human |

---

## Alert Routing

| Severity | Channel | Action | SLA |
|----------|---------|--------|-----|
| CRITICAL | PagerDuty + Slack #incidents + email | Page on-call; halt new calls to affected carrier | 5 min |
| WARNING | Slack #voice-agent-alerts + email | Notify ops; investigate in next 30 min | 30 min |
| INFO | Dashboard only | No alert; log for dashboard review | - |

---

## Dashboard Requirements

### Home Dashboard (Real-time Status)
- **Top metrics**: CARRIER_BLOCK status (per carrier, ✅ or 🔴), false escalation rate, constraint violations, hallucination catch count
- **Timeline**: Last 4 hours (rolling window)
- **Alerts**: Active alerts, recent events

### Metrics Dashboard (Detailed)
- **Robustness scenarios**: Pass/fail per R001-R010, pass rate trend
- **Escalation discipline**: True positive, false positive, missed escalation (confusion matrix)
- **Hallucination catches**: By gate type, cumulative count
- **Aging compliance**: Histogram of claim ages in queue, compliance %; claims approaching 75-day threshold
- **Carrier health**: Call success rate per carrier, disconnect rate, CARRIER_BLOCK status

### Operational Dashboard (Ops Team)
- **Queue status**: Claims queued, claims called today, claims escalated
- **Timing**: Average call duration, IVR navigation time, rep transfer time
- **Errors**: Failed calls, timeouts, dropped connections (by hour)
- **Practice impact**: Top practices by call volume, by escalation rate

---

## Implementation Checklist

### Phase 1: Events & Logging (Prerequisite)
- [ ] Add telemetry hooks to src/server/vapi-webhooks/ (call.ended handler)
- [ ] Log CARRIER_BLOCK event when flag is set/cleared
- [ ] Log all escalation decisions with reason
- [ ] Log hallucination catches at each gate
- [ ] Log aging rule checks (pass/fail) at dispatch

### Phase 2: Alerting (Critical Path)
- [ ] Wire PagerDuty integration for CRITICAL events
- [ ] Wire Slack #voice-agent-alerts for WARNING events
- [ ] Email ops team on CRITICAL (backup to Slack/PagerDuty)
- [ ] Verify on-call escalation works end-to-end

### Phase 3: Dashboard (Staging Launch)
- [ ] Build home dashboard (real-time status)
- [ ] Build metrics dashboard (robustness, escalation, hallucination)
- [ ] Make accessible to on-call + ops
- [ ] Add 1-hour and 4-hour rolling windows

### Phase 4: Feedback Loop (Post-Deploy)
- [ ] Daily standup reviews dashboard during ramp-up week
- [ ] Tune alert thresholds based on live data (1-2 week feedback loop)
- [ ] Validate robustness scenarios running in production
- [ ] Adjust if patterns emerge (e.g., specific carrier behaviors)

---

## Success Criteria for Staging

Before rolling out to production, ALL of these must be true:

- ✅ Zero CARRIER_BLOCK events (or all investigated + resolved)
- ✅ False escalation rate <10% (from validation, expect ~5%)
- ✅ Zero hard constraint violations
- ✅ Hallucination catch rate 100% (no escapes)
- ✅ Escalation accuracy 95%+ (measured over 100+ calls)
- ✅ Aging rule compliance 100%
- ✅ On-call team trained and confident with alerts
- ✅ Dashboard live and monitoring in real-time

---

## Ramp-Up Schedule

| Phase | Duration | Criteria | Next Gate |
|-------|----------|----------|-----------|
| **Staging** | 2 weeks | All success criteria met | Production approval |
| **Production (Wave 1)** | 1 week | 5-10 practices, low volume | Expand to 20-30 practices |
| **Production (Wave 2)** | 1 week | 20-30 practices, medium volume | Full rollout decision |
| **Full Production** | Ongoing | All practices, standard volume | Monitoring as steady-state |

---

## Escalation Path (Incident Response)

**If CARRIER_BLOCK triggers:**
1. Page on-call engineer
2. Halt new calls to that carrier (automatic)
3. Notify Khalid immediately
4. Investigate carrier signal (post-disclosure? compliance? rate-limit?)
5. Contact carrier to understand block reason
6. Do NOT resume until carrier confirms explicitly

**If hard constraint violation occurs:**
1. Page on-call engineer + Khalid
2. Halt all calls (emergency kill switch)
3. Root-cause analysis (which constraint? why did gate fail?)
4. Review code + logs
5. Patch + re-validate before resuming

**If false escalation >20%:**
1. Alert ops team
2. Investigate pattern (specific carrier? time-of-day? claim type?)
3. Review Agent 3 prompt + re-verification logic
4. Tune thresholds or re-train if needed

---

## References

- Validation run: RUN-LOG-2026-07-10-COMPLETE.md
- Hallucination gates: hallucination_gates.md (6-gate system)
- Operational safety: operational_safety.md (error recovery + escalation)
- Robustness scenarios: R001-R010 (conversation eval)
- Aging rules: Agent 05 call-rules-agent tests
- CARRIER_BLOCK protocol: Agent 05 + dispatch-gate tests
