# Phase 7: Pilot Go-Live Runbook

**Phase:** 7 (Pilot Go-Live & Assumption Validation)  
**Owner:** Khalid  
**Status:** Pre-launch (launch date TBD)  
**Updated:** 2026-07-21

---

## Mission

Operate the first live pilot with a design-partner dental practice, validating three core business assumptions over 30–90 days:

1. **Carriers accept AI callers** — No permanent practice-level CARRIER_BLOCK
2. **AI achieves sufficient resolution** — ≥60% resolution rate sustained
3. **Pricing acceptance** — Pilot practice continues beyond trial period at stated pricing

---

## Timeline & Milestones

| Week | Milestone | Owner |
|------|-----------|-------|
| **W0–W1** | Design partner onboarded; carrier KBs hardened | Khalid |
| **W1–W2** | First 5 test calls; CARRIER_BLOCK protocol validated | Ops |
| **W2–W3** | Compliance sign-off; monitoring live | Legal / Khalid |
| **W3–W8** | Steady-state operation; 30+ claims processed | Ops / Khalid |
| **W8–W12** | Pilot review; outcome decision (expand vs. iterate) | Board |

---

## Three Assumptions & Kill Conditions

### Assumption 1: Carriers Accept AI Callers

**Validation:** Any carrier permits practice to make automated claims calls for ≥30 days.

**Kill condition:** Any single carrier issues a practice-level `CARRIER_BLOCK` that cannot be resolved within 7 days of detection.

**Mitigation:**
- Contact center scripts include AI disclosure (CRTC Rule 4 compliance)
- Vapi call metadata identifies practice + claim ID only (no PHI)
- Monitor `CARRIER_BLOCK` table daily for new entries
- Escalate to carrier account rep within 4 hours of block detection
- Maintain carrier contact list + escalation playbook (see below)

**Success signals:**
- No carrier blocks lasting >24 hours
- Carrier feedback positive or neutral in post-call surveys
- Call completion rates >70% (answer + completion, not disconnect)

---

### Assumption 2: AI Achieves Sufficient Resolution Rate

**Validation:** ≥60% of claims resolve in a single call (call_outcome = `resolved`).

**Kill condition:** Sustained <60% resolution rate over any 30-day window after W2 (post-ramp).

**Mitigation:**
- Resolution defined: adjudicator confirms payment + date, no follow-up call needed
- Track per-carrier resolution rates separately (Sun Life ≥65%, others ≥55% baseline targets)
- Analyze failed calls: IVR timeouts, agent not reached, claim info gaps?
- Daily monitoring dashboard in Railway → shared with ops
- Tweak system prompt / IVR scripts based on failure patterns

**Success signals:**
- Week 2 resolution >50% (expected with script tuning)
- Week 4 resolution >60% (target achieved)
- Week 8 resolution >70% (upside performance)

---

### Assumption 3: Practice Pays at Stated Price

**Validation:** Pilot practice signs renewal / expansion agreement.

**Kill condition:** Pilot practice opts out at the end of trial period, citing price/ROI concerns.

**Mitigation:**
- Define "price" clearly: per-call, per-resolution, monthly retainer? Agree with practice before launch.
- Track ROI for practice: claims processed, # resolved, $$recovered, cost/call, payback period.
- Weekly check-in with practice owner (first 4 weeks), then bi-weekly.
- If resolving claims faster than projected, offer performance bonus (e.g., bulk discount if >100 calls/month).

**Success signals:**
- Practice reports positive ROI (claims recovered > cost) by week 6
- Practice requests expansion (more carriers, more claims) by week 8
- Signed renewal agreement before trial end

---

## Pre-Launch Checklist

### ✓ Code & Build

- [ ] `npm test` passes (0 failures)
- [ ] `npm run build` succeeds (production bundle ready)
- [ ] `npm run diagnose` shows all subsystems healthy (DB, Redis, etc.)
- [ ] All critical linting issues resolved
- [ ] TypeScript strict mode passes (no `any` types, no non-null assertions without invariants)

### ✓ Compliance & Legal

- [ ] CRTC disclosure script review + sign-off (Rule 4 identification required)
- [ ] PHI boundary audit: tokenization verified end-to-end (no patient names/DOBs in Vapi)
- [ ] PHIPA/PIPEDA compliance review (BAA with Vapi if needed)
- [ ] Carrier authorization: practice + Vapi partner approval
- [ ] Insurance policy review (cyber liability, E&O for AI operations)

### ✓ Carrier Readiness

- [ ] Carrier KBs hardened for all 6 carriers:
  - [ ] Sun Life (CDCP reconsideration + claims)
  - [ ] Canada Life
  - [ ] Manulife
  - [ ] Green Shield
  - [ ] RBC Insurance
  - [ ] TELUS AdjudiCare

- [ ] IVR scripts tested end-to-end (dial, navigate, exit)
- [ ] Carrier account reps contacted + briefed on AI initiative
- [ ] Test calls completed on each carrier (≥2 successful paths per carrier)
- [ ] CARRIER_BLOCK protocol documented + tested (can trigger block / unblock)

### ✓ Practice Onboarding

- [ ] Design-partner practice signed (pilot agreement + data handling addendum)
- [ ] Practice staff trained (who to escalate to, how to monitor queue, etc.)
- [ ] Practice claims imported (CSV or PMS sync configured)
- [ ] Practice dashboard accessible (demo user + admin user accounts)
- [ ] Test claim submitted & resolved (end-to-end smoke test)

### ✓ Monitoring & Ops

- [ ] Alerts configured:
  - [ ] CARRIER_BLOCK detected → SMS + Slack
  - [ ] Call failure rate >20% → SMS + Slack
  - [ ] API latency p99 >2s → warning email
  - [ ] 5xx rate >1% → SMS + Slack
  - [ ] PHI audit anomaly (e.g., detokenization failures) → SMS + Khalid

- [ ] Dashboards live:
  - [ ] Call volume, resolution rate, carrier breakdown (Real-time)
  - [ ] Error logs, IVR timeouts, agent availability (Searchable)
  - [ ] Carrier performance trends (Weekly summary)

- [ ] Escalation playbook documented:
  - [ ] Carrier block → call carrier rep → technical troubleshoot
  - [ ] Call failure spike → pause queue → investigate → restart
  - [ ] PHI audit failure → immediate shutdown + forensics

- [ ] 24/7 on-call rotation established
  - [ ] Khalid + ops engineer
  - [ ] Pager duty configured (PagerDuty / Slack)
  - [ ] Runbook links in on-call docs

### ✓ Data & Analytics

- [ ] Billing configured (Stripe test mode if using cost controls)
- [ ] Call metrics logged (duration, wait time, resolution, outcome code)
- [ ] Claims mapping verified (carrier codes → system outcome codes)
- [ ] Weekly reporting template ready (# calls, resolution %, cost/call, ROI)

### ✓ Rollback & Circuit Breaker

- [ ] CARRIER_BLOCK → auto-pause queue (failsafe enabled)
- [ ] `DISABLE_SCHEDULER=1` ready (turns off queue engine instantly)
- [ ] Emergency contact tree (who to notify if something breaks)
- [ ] RTO/RPO defined: max downtime before full rollback (e.g., 1 hour)

---

## Day-1 Launch Checklist

**T-24 hours:**
- [ ] Slack channel #collectrx-pilot-ops created
- [ ] On-call roster confirmed (Khalid aware)
- [ ] All alerts + dashboards tested
- [ ] Carrier contacts confirmed (phone numbers pinned)
- [ ] Practice owner briefed: "System goes live tomorrow, expect 5–10 test calls today"

**T-6 hours:**
- [ ] Production database backed up
- [ ] Deploy to production (main branch → Railway)
- [ ] Smoke test: create test claim, trigger queue, verify call placed
- [ ] Practice user logs in successfully

**T-1 hour:**
- [ ] On-call engineer online
- [ ] All dashboards refreshed (confirming data flow)
- [ ] Carrier contact list posted in #collectrx-pilot-ops
- [ ] Circuit breaker status: ARM (ready to disable scheduler if needed)

**T-0 (Launch):**
- [ ] Queue enabled: `npm run queue:start` or equivalent (if separate process)
- [ ] First batch of 5 claims pushed to queue
- [ ] Monitor calls in real-time (expect 2–5 min per call)
- [ ] Log first successful resolution call

**T+2 hours:**
- [ ] At least 1 successful resolution confirmed
- [ ] No CARRIER_BLOCK detected
- [ ] Practice owner confirms: "Calls received, everything looks good"

**T+8 hours:**
- [ ] Daily report generated:
  - Call count, resolution count, avg duration
  - Any errors, carrier issues, escalations
  - Next 24h plan

---

## Steady-State Operations (Week 2+)

### Daily Routine

| Time | Owner | Action |
|------|-------|--------|
| 06:00 | Ops | Review overnight logs; check for CARRIER_BLOCK alerts |
| 08:00 | Khalid | Daily standup: # calls, resolution rate, any issues |
| 12:00 | Ops | Mid-day dashboard check (resolution % on track?) |
| 18:00 | Khalid | Check Slack for escalations; triage if needed |
| 22:00 | Ops | Evening health check before off-hours |

### Weekly Routine

| Day | Owner | Action |
|-------|-------|--------|
| Monday | Khalid | Weekly metrics review (# calls, $recovered, cost/call) |
| Tuesday | Ops | Carrier KB audit (any failed call patterns?) |
| Wednesday | Khalid | Practice check-in (any friction, feature requests?) |
| Thursday | Khalid | Competitor intelligence sweep (are alternatives launching?) |
| Friday | Board | Weekly board update (progress toward assumptions) |

### Escalation Decision Tree

```
Issue Detected (alert triggered)
  ↓
Severity: Critical? (PHI breach, >80% call failure, carrier block)
  ├─ YES → Page on-call + Khalid → Manual intervention
  └─ NO → Log + monitor 30 min → Auto-retry or manual review?
           ├─ Auto-retry succeeds → Log as resolved
           └─ Auto-retry fails → Escalate to manual
```

---

## Success Metrics & Targets

### Quantitative

| Metric | W1 | W2–W4 | W5–W8 |
|--------|----|----|---|
| **Call completion** | >50% | >70% | >80% |
| **Resolution rate** | >40% | >60% | >70% |
| **Avg call duration** | <5 min | <4 min | <3 min |
| **Cost per call** | TBD | ≤ $X | ≤ $X–10% |
| **Practice satisfaction** | Intro | Positive | Expansion-ready |

### Qualitative

- [ ] No carrier complaints or formal blocks
- [ ] Practice staff finds system easy to use
- [ ] Regulatory/compliance feedback: positive or neutral
- [ ] Internal team is confident scaling to 3–5 practices by week 8

---

## Rollback Procedures

### Scenario A: Critical Bug in Production

**Decision:** Rollback if unfixable within 1 hour.

```bash
# Step 1: Disable queue (stop new calls)
# Railway UI or: DISABLE_SCHEDULER=1 (redeploy)

# Step 2: Notify practice + on-call
# SMS to practice owner + team Slack

# Step 3: Rollback to last known good
git revert HEAD  # or git reset --hard <last-good-commit>
npm run build && git push origin main  # Deploy

# Step 4: Verify health check passes
npm run diagnose

# Step 5: Restart queue
DISABLE_SCHEDULER=0 (redeploy)
```

### Scenario B: Carrier Block Unresolvable

**Decision:** Pause calls to affected carrier, continue with others.

```bash
# Step 1: Detect (alert fires automatically)
# CARRIER_BLOCK detected for Sun Life

# Step 2: Pause Sun Life calls
UPDATE carriers SET blocked_until = now() + interval '7 days' WHERE name = 'Sun Life';

# Step 3: Notify practice
SMS: "Sun Life temporarily blocked. Routing claims to other carriers."

# Step 4: Escalate
Call Sun Life account rep + legal team

# Step 5: Resume when unblocked
UPDATE carriers SET blocked_until = NULL WHERE name = 'Sun Life';
```

### Scenario C: Resolution Rate Drops Below 60%

**Decision:** Investigate root cause. Pause if cause is systemic + unfixable quickly.

```bash
# Step 1: Analyze failures
SELECT call_outcome, COUNT(*) FROM call_attempts 
WHERE created_at > NOW() - interval '7 days' 
GROUP BY call_outcome 
ORDER BY COUNT(*) DESC;

# Step 2: Are errors in IVR? Carrier? PHI tokenization?
# Actionable fix: Update system prompt / IVR scripts / KB
# If fix takes >4 hours: Pause queue, investigate offline

# Step 3: Test fix on shadow traffic (if available)
# Redeploy, re-enable queue

# Step 4: Monitor resolution rate rebound (target: 60% within 24h)
```

---

## Monitoring Queries

### Realtime Dashboards

**Call volume** (past 24 hours):
```sql
SELECT DATE_TRUNC('hour', created_at) AS hour, COUNT(*) FROM call_attempts 
WHERE created_at > NOW() - interval '24 hours' 
GROUP BY hour ORDER BY hour DESC;
```

**Resolution rate**:
```sql
SELECT 
  ROUND(100.0 * COUNT(CASE WHEN outcome_code = 'resolved' THEN 1 END) / COUNT(*), 2) AS resolution_pct
FROM call_attempts 
WHERE created_at > NOW() - interval '30 days' AND outcome_code IS NOT NULL;
```

**Carrier performance**:
```sql
SELECT carrier_name, COUNT(*) AS calls, 
  ROUND(100.0 * COUNT(CASE WHEN outcome_code = 'resolved' THEN 1 END) / COUNT(*), 2) AS resolution_pct
FROM call_attempts 
WHERE created_at > NOW() - interval '7 days' 
GROUP BY carrier_name 
ORDER BY calls DESC;
```

**Cost per call**:
```sql
SELECT 
  ROUND(SUM(cost_cents) / 100.0 / COUNT(*), 2) AS cost_per_call,
  COUNT(*) AS total_calls
FROM call_attempts 
WHERE created_at > NOW() - interval '30 days';
```

---

## Related Documents

- [Phase 7 PRD](../prd/phase-7-pilot-go-live.md) — Business assumptions & goals
- [CRTC Compliance](../compliance/crtc-disclosure-decision.md) — Disclosure script & requirements
- [PHI Boundary](../compliance/PHI-VAPI-BOUNDARY.md) — Tokenization architecture
- [OPS Alerts](./OPS-ALERTS.md) — Alert configuration & escalation
- [Carrier KBs](../../carriers/) — Carrier-specific IVR instructions

---

**Last Updated:** 2026-07-21  
**Next Review:** Before pilot launch (1 week before go-live)
