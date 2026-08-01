# CollectRx Analytics Pipeline Agent

**Purpose:** Ensure the data that flows into every analytics agent is accurate, complete, and trustworthy. A practice time savings report built on bad data is worse than no report — it destroys trust. This agent is the data quality gate for the entire analytics stack. Run daily. Flag any data integrity issues before they propagate into customer-facing reports.

---

## The Analytics Dependency Graph

Every analytics agent depends on accurate source data:

```
Database (PostgreSQL)
  ↓
Call records ──────────────────→ Collections Performance
                                  Practice Time Savings
                                  ROI Proof
                                  Call Quality Scorer
                                  Hallucination Detector
                                  Post-Call Debrief
                                  Escalation Triage
                                  Carrier IVR Health

Stripe billing records ────────→ Tier & Billing Health
                                  ROI Proof

PHI access logs ───────────────→ PHI Access Log Reviewer

Vapi transcripts ──────────────→ Call Quality Scorer
                                  Hallucination Detector
                                  Post-Call Debrief
                                  Voice Agent Trainer
```

If any source is corrupt, incomplete, or delayed, every downstream agent is compromised.

---

## Daily Data Quality Checks

### 1. Call Record Completeness

```sql
-- Calls with missing required fields
SELECT
  ca.id,
  ic.practice_id,
  ic.carrier_id,
  ca.claim_id,
  ca.outcome,
  ca.initiated_at,
  ca.completed_at,
  ca.duration_seconds,
  ca.vapi_call_id
FROM call_attempts ca
JOIN insurance_claims ic ON ic.id = ca.claim_id
WHERE ca.completed_at > NOW() - INTERVAL '24 hours'
  AND (
    ca.outcome IS NULL
    OR ca.duration_seconds IS NULL
    OR ca.vapi_call_id IS NULL
    OR ca.initiated_at IS NULL
    OR ca.completed_at IS NULL
  );
```

Any row returned here is a broken call record. Flag for investigation.

### 2. Outcome Distribution Sanity Check

If outcomes are outside expected ranges, something is wrong with either the calls or the recording logic:

```sql
SELECT
  outcome,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS pct
FROM call_attempts
WHERE completed_at > NOW() - INTERVAL '7 days'
GROUP BY outcome
ORDER BY count DESC;
```

Expected approximate ranges (flag if significantly outside), using the real `CallOutcome` enum (`RESOLVED`, `PENDING`, `DENIED`, `ESCALATED`, `BLOCK_DETECTED`, `FAILED`, `NO_ANSWER`, `HUNG_UP`):
- RESOLVED: 30-50%
- PENDING: 15-25%
- DENIED: 10-20%
- ESCALATED: 5-15%
- FAILED: 5-15%
- NO_ANSWER: 3-10%
- HUNG_UP: 2-8%
- BLOCK_DETECTED: 0-2% (anything higher is a crisis)

If RESOLVED is >70%, the anti-hallucination gate may be failing.
If FAILED is >30%, a carrier has changed their IVR.
If BLOCK_DETECTED is >5%, production is in jeopardy.

### 3. Vapi Transcript Availability

Every completed call should have a retrievable transcript. Check:
- How many calls in the last 24 hours have `vapiCallId` but no transcript available via Vapi API?
- If >10% of calls are missing transcripts, Vapi API may have an issue

Log transcript availability rate daily.

### 4. Financial Data Consistency

Recovered dollars live on `claim_recovery_events.amount_recovered_cents`, not on the call record itself — join through `claim_id`:

```sql
-- Recovery events with a positive amount whose triggering call wasn't RESOLVED
SELECT cre.id, ca.outcome, cre.amount_recovered_cents, cre.claim_id
FROM claim_recovery_events cre
JOIN call_attempts ca ON ca.claim_id = cre.claim_id
WHERE cre.amount_recovered_cents > 0
  AND ca.outcome != 'RESOLVED'
  AND cre.created_at > NOW() - INTERVAL '24 hours';

-- RESOLVED calls with no matching recovery event (may be valid but worth flagging)
SELECT ca.id, ca.outcome, ca.claim_id
FROM call_attempts ca
LEFT JOIN claim_recovery_events cre ON cre.claim_id = ca.claim_id
WHERE ca.outcome = 'RESOLVED'
  AND cre.id IS NULL
  AND ca.completed_at > NOW() - INTERVAL '24 hours';
```

### 5. PHI Log Completeness

Every detokenization event must have a corresponding PHI access log:

```sql
SELECT COUNT(*) AS detokenize_events FROM phi_access_events
WHERE operation LIKE 'detokenize_%'
  AND created_at > NOW() - INTERVAL '24 hours';

-- Compare to actual detokenize calls — should match
-- If count is zero and calls are running, PHI audit logging is broken
```

### 6. Queue Engine Heartbeat

There is no dedicated queue-engine heartbeat table. Use the most recent `call_queue` row touch as a proxy — if the engine is running during call-window hours, it should be updating rows regularly (dispatching, deferring, or completing them):

```sql
-- Most recent queue engine activity
SELECT MAX(updated_at) AS last_processed FROM call_queue
WHERE updated_at > NOW() - INTERVAL '2 hours';
```

If no activity in 2 hours during call window hours, the queue engine may be down — but also check whether the queue is simply empty (no claims currently eligible for dispatch) before alerting, since an empty queue produces the same null result.

### 7. Stripe Sync

Verify billing data is current:
- Last Stripe event processed: should be within 24 hours
- Any failed Stripe webhooks: flag for billing health agent

---

## Data Quality Score

Each daily run produces a score:

| Check | Weight | Pass Criteria |
|---|---|---|
| Call record completeness | 25% | <1% missing fields |
| Outcome distribution | 20% | Within expected ranges |
| Transcript availability | 20% | >90% retrievable |
| Financial consistency | 15% | Zero amount/outcome mismatches |
| PHI log completeness | 10% | All detokenize events logged |
| Queue heartbeat | 5% | Active during call window |
| Stripe sync | 5% | Events current within 24h |

A score <80% means downstream analytics reports should be marked "DATA QUALITY CAUTION" until resolved.

---

## Alert Thresholds

| Issue | Threshold | Action |
|---|---|---|
| Missing call records | >5% | Alert Khalid; pause analytics reports |
| BLOCK_DETECTED rate | >5% in 7 days | Immediate alert; trigger carrier IVR health |
| RESOLVED rate | >70% | Anti-hallucination gate may be failing; alert |
| Transcript unavailability | >10% | Vapi API issue; alert |
| Queue heartbeat gap | >2 hours in call window | Queue engine down; alert |
| PHI log gap | Any | Immediate compliance alert |

---

## Daily Report Format

```
## Analytics Pipeline Health — [DATE]

### Data Quality Score: [X/100]

### Check Results
| Check | Status | Details |
|---|---|---|
| Call record completeness | ✅/⚠️/🔴 | [n] missing fields out of [n] calls |
| Outcome distribution | ✅/⚠️/🔴 | [distribution vs. expected] |
| Transcript availability | ✅/⚠️/🔴 | [n]% retrievable |
| Financial consistency | ✅/⚠️/🔴 | [n] mismatches |
| PHI log completeness | ✅/⚠️/🔴 | [n] gaps |
| Queue heartbeat | ✅/⚠️/🔴 | Last: [time] |
| Stripe sync | ✅/⚠️/🔴 | Last event: [time] |

### Alerts
- [Any threshold breaches requiring action]

### Analytics Agent Safety Status
- Safe to run: [list agents cleared]
- Hold until fixed: [list agents blocked by data quality]
```

---

## How to Run This Agent

```
"Run the CollectRx analytics pipeline health check for [DATE]. Execute all 7 data quality checks against the production database. Calculate the daily quality score. Flag any threshold breaches. Produce the daily report and list which analytics agents are safe to run vs. blocked due to data quality issues."
```
