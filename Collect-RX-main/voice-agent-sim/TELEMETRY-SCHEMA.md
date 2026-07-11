# Telemetry Schema & Production Data Pipeline

**Purpose**: Defines all events that flow from voice agent → backend → analytics for monitoring dashboards  
**Audience**: Backend engineers implementing telemetry hooks, analytics team building dashboards  
**Effective date**: Upon staging deploy  

---

## Event Categories & Payloads

### Category 1: Call Lifecycle Events

#### 1.1 `call.initiated`
```json
{
  "event_type": "call.initiated",
  "timestamp": "2026-07-10T14:30:00Z",
  "call_id": "call_abc123",
  "claim_id": "CLM_xyz",
  "practice_id": "practice_001",
  "carrier": "sun_life",
  "agent_id": "IVR_Navigator",
  "call_attempt_number": 1,
  "phone_number": "masked_*****1234",
  "claimed_amount": 500.00,
  "days_since_submission": 45,
  "aging_check_passed": true,
  "carrier_block_status": "active",
  "dispatch_gate_result": "ALLOWED"
}
```

**Purpose**: Validate claim was eligible to be called (aging, CARRIER_BLOCK, amount)  
**Used for**: Aging compliance, dispatch gate audit trail  

---

#### 1.2 `call.ended`
```json
{
  "event_type": "call.ended",
  "timestamp": "2026-07-10T14:42:00Z",
  "call_id": "call_abc123",
  "claim_id": "CLM_xyz",
  "practice_id": "practice_001",
  "carrier": "sun_life",
  "duration_seconds": 720,
  "outcome": "Resolved",
  "claimed_amount": 500.00,
  "approved_amount": 350.00,
  "call_failure_reason": null,
  "iVR_completion_level": 7,
  "rep_interaction": "successful",
  "transcript_length": 2840,
  "recording_id": "rec_xyz",
  "webhook_timestamp_diff_ms": 50
}
```

**Purpose**: Core call outcome; used for escalation logic, revenue tracking, outcome distribution  
**Used for**: Call success rate, revenue projections, carrier health  

---

### Category 2: Safety & Compliance Events

#### 2.1 `carrier_block.triggered`
```json
{
  "event_type": "carrier_block.triggered",
  "timestamp": "2026-07-10T14:35:00Z",
  "carrier": "sun_life",
  "reason": "post_disclosure_hangup",
  "call_id": "call_abc123",
  "claims_affected": 127,
  "automated_response": "HALTED_ALL_CALLS",
  "manual_intervention_required": true,
  "severity": "CRITICAL"
}
```

**Purpose**: Immediate incident trigger; zero-tolerance alert  
**Used for**: PagerDuty page, carrier trust tracking  

---

#### 2.2 `constraint_violation.detected`
```json
{
  "event_type": "constraint_violation.detected",
  "timestamp": "2026-07-10T14:30:00Z",
  "constraint": "AGING_MIN_32_DAYS",
  "claim_id": "CLM_xyz",
  "days_since_submission": 28,
  "stage": "dispatch_gate",
  "severity": "CRITICAL",
  "manual_intervention_required": true,
  "root_cause": "date_calculation_off_by_4_days"
}
```

**Constraints tracked**:
- `AGING_MIN_32_DAYS` — claim called <32 days old
- `AGING_MAX_ESCALATION_75` — claim >75 days not auto-escalated
- `PHI_BOUNDARY` — real SSN/health card in Vapi metadata
- `CARRIER_BLOCK_NOT_RESPECTED` — call made while carrier blocked
- `UNAUTHORIZED_SETTLEMENT` — agent offered settlement without authority

**Used for**: Zero-tolerance incident response  

---

#### 2.3 `hallucination_caught`
```json
{
  "event_type": "hallucination_caught",
  "timestamp": "2026-07-10T14:40:00Z",
  "call_id": "call_abc123",
  "claim_id": "CLM_xyz",
  "gate_name": "source_verification",
  "hallucination_type": "false_reference_number",
  "agent_claim": "Your reference is 123-456-789",
  "webhooks_reference": "123-456-790",
  "outcome_before_catch": "Resolved",
  "outcome_after_catch": "Needs Human Follow-Up",
  "practice_exposure": false
}
```

**Gates tracked**:
- `source_verification` — Agent claim matches Vapi metadata / webhook data
- `read_back_verification` — Agent read back claim details correctly
- `consistency_cross_check` — Amounts consistent across provider/webhook/agent
- `absence_verification` — Settlement amount only mentioned if authorized
- `authority_boundary` — Agent only mentioned authorized escalation contact
- `webhook_validation` — Outcome matches webhook payload structure

**Used for**: Catch rate, gate effectiveness, hallucination types  

---

### Category 3: Escalation Events

#### 3.1 `escalation_decision.made`
```json
{
  "event_type": "escalation_decision.made",
  "timestamp": "2026-07-10T14:40:00Z",
  "call_id": "call_abc123",
  "claim_id": "CLM_xyz",
  "practice_id": "practice_001",
  "agent_id": "Escalation_Closer",
  "decision": "escalate_to_human",
  "reason": "aging_75_plus",
  "days_since_submission": 82,
  "confidence_score": 0.92,
  "scenario_matched": "R003_aging_plus_75",
  "ground_truth_available": true,
  "ground_truth": "correct_escalation"
}
```

**Reasons tracked**:
- `aging_75_plus` — Hard rule: >75 days requires human
- `conflated_claim` — Multiple claims detected; cannot resolve
- `vague_rep_answer` — Rep would not confirm specifics
- `settlement_pressure` — Rep offered unsustainable settlement
- `timeout` — Call took too long; incomplete info
- `policy_question` — Question outside scope (age limits, ortho waiting periods)
- `cob_complexity` — COB calculation too complex for agent

**Used for**: Escalation accuracy, false positive rate, decision audit trail  

---

#### 3.2 `escalation_outcome.recorded`
```json
{
  "event_type": "escalation_outcome.recorded",
  "timestamp": "2026-07-11T09:30:00Z",
  "escalation_id": "ESC_abc123",
  "claim_id": "CLM_xyz",
  "practice_id": "practice_001",
  "escalation_reason": "aging_75_plus",
  "human_reviewed": true,
  "human_resolution": "Resolved",
  "human_approved_amount": 400.00,
  "vs_agent_outcome": "Resolved",
  "vs_agent_amount": 350.00,
  "variance_dollars": 50.00,
  "variance_percent": 14.3,
  "days_to_resolution": 1
}
```

**Used for**: Human follow-up quality, escalation accuracy, financial variance  

---

### Category 4: False Escalation Detection

#### 4.1 `false_escalation_detected`
```json
{
  "event_type": "false_escalation_detected",
  "timestamp": "2026-07-11T09:30:00Z",
  "escalation_id": "ESC_abc123",
  "claim_id": "CLM_xyz",
  "practice_id": "practice_001",
  "escalation_reason": "vague_rep_answer",
  "initial_outcome": "Needs Human Follow-Up",
  "human_investigation": "Rep was being cautious; claim data complete",
  "could_have_been_resolved": true,
  "recovery_amount": 50.00,
  "scenario_matched": "R008_vague_answer_test"
}
```

**Purpose**: Identify when agent over-escalated (cost inefficiency)  
**Used for**: False escalation rate, Agent 3 (Escalation_Closer) retraining  

---

### Category 5: Data Quality Events

#### 5.1 `outcome_validation.failed`
```json
{
  "event_type": "outcome_validation.failed",
  "timestamp": "2026-07-10T14:42:00Z",
  "call_id": "call_abc123",
  "claim_id": "CLM_xyz",
  "validation_stage": "webhook_outcome_resolver",
  "error_type": "missing_required_field",
  "missing_field": "approved_amount",
  "agent_provided": {
    "outcome": "Resolved",
    "claimed_amount": 500,
    "approved_amount": null
  },
  "fallback_applied": "escalate_to_human",
  "manual_intervention_required": true
}
```

**Used for**: Data quality metrics, webhook validation effectiveness  

---

#### 5.2 `eligibility_estimate_reconciliation`
```json
{
  "event_type": "eligibility_estimate_reconciliation",
  "timestamp": "2026-07-11T08:00:00Z",
  "claim_id": "CLM_xyz",
  "estimate_id": "EST_xyz",
  "practice_id": "practice_001",
  "patient_id": "PAT_xyz_token",
  "carrier": "sun_life",
  "estimated_insurer_pays": 350.00,
  "actual_insurer_pays": 350.00,
  "variance_dollars": 0.00,
  "variance_percent": 0.0,
  "variance_acceptable": true,
  "variance_reason": null
}
```

**Purpose**: Post-EOB reconciliation; detect estimation gaps  
**Used for**: Estimate accuracy, carrier-specific variance patterns  

---

### Category 6: Operational Metrics

#### 6.1 `queue_snapshot`
```json
{
  "event_type": "queue_snapshot",
  "timestamp": "2026-07-10T15:00:00Z",
  "practice_id": "practice_001",
  "claims_queued_total": 42,
  "claims_queued_by_age": {
    "0_to_32_days": 0,
    "32_to_75_days": 38,
    "75_plus_days": 4
  },
  "claims_queued_by_carrier": {
    "sun_life": 15,
    "canada_life": 12,
    "manulife": 10,
    "green_shield": 3,
    "rbc": 2,
    "telus_adjudicare": 0
  },
  "total_value_queued": 18500.00,
  "average_claim_age_days": 48
}
```

**Purpose**: Queue health baseline; detect unusual distributions  
**Used for**: Operational dashboard, practice health  

---

## Data Pipeline Architecture

### Flow: Event → Backend → Analytics

```
┌─────────────────────────────────────────────────────────────┐
│ VOICE AGENT CALL                                            │
│ (Vapi squad)                                                │
└──────────┬──────────────────────────────────────────────────┘
           │
           ├─ Call logs → Vapi dashboard
           └─ Call outcome + metadata → Webhook
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ WEBHOOK RECEIVER (src/server/vapi-webhooks/)                │
│ POST /api/vapi/webhook                                      │
│ • Verify x-vapi-secret header                               │
│ • Extract call_id, outcome, amounts, transcript             │
│ • Map to database claim                                      │
└──────────┬──────────────────────────────────────────────────┘
           │
           ├─→ TELEMETRY EMISSION (new)
           │   ├─ call.initiated (at dispatch)
           │   ├─ call.ended (at webhook)
           │   ├─ hallucination_caught (if gate fires)
           │   ├─ constraint_violation.detected (if rule breaks)
           │   └─ escalation_decision.made (if Agent 3 decides)
           │
           └─→ OUTCOME PROCESSING
               ├─ outcome-processor.ts
               │  ├─ Validate critical fields
               │  ├─ Apply eligibility logic
               │  └─ Emit outcome_validation.failed if needed
               │
               └─ POST /api/escalations (if human needed)
                  └─ Emit escalation_outcome.recorded (48h later)
```

---

### Event Sink: ClickHouse Analytics

**Database**: CollectRx ClickHouse (optional local dev, required production)

**Table**: `voice_agent_events`

```sql
CREATE TABLE voice_agent_events (
  timestamp DateTime,
  event_type String,
  call_id String,
  claim_id String,
  practice_id String,
  carrier String,
  outcome String,
  reason String,
  severity Nullable(String),
  amount_claimed Float64 Nullable,
  amount_approved Float64 Nullable,
  duration_seconds Int32 Nullable,
  custom_fields String  -- JSON for extensibility
) ENGINE = MergeTree()
ORDER BY (timestamp, event_type, practice_id)
```

**Partitioning**: Daily (auto-rolled by timestamp)  
**Retention**: 90 days (configurable)  
**Compression**: ZSTD  

---

## Implementation Checklist

### Phase 1: Events & Logging (Week 1)

- [ ] Add telemetry logger utility: `src/services/telemetry/logger.ts`
  - Accepts event type + payload
  - Routes to ClickHouse if `CLICKHOUSE_URL` set, else console.log
  - Handles retries + backoff for failed writes
  - No PHI in payloads (use tokenized IDs only)

- [ ] Add telemetry hooks to: `src/server/vapi-webhooks/index.ts`
  - Log `call.initiated` when claim is dispatched (from dispatch-gate)
  - Log `call.ended` when webhook payload arrives
  - Log `constraint_violation.detected` if aging/CARRIER_BLOCK checks fail
  - Log `outcome_validation.failed` if payload validation fails

- [ ] Add telemetry to outcome processor: `src/server/handlers/outcome-processor.ts`
  - Log `hallucination_caught` for each gate that fires
  - Log `escalation_decision.made` if Agent 3 decides
  - Log `false_escalation_detected` (async, 24h after escalation recorded)

- [ ] Add telemetry to escalation handler: `src/server/handlers/escalation-outcome.ts`
  - Log `escalation_outcome.recorded` when human response comes back
  - Compare agent outcome vs human outcome, log variance

### Phase 2: Analytics Connection (Week 2)

- [ ] Set up ClickHouse integration
  - Create table schema (DDL above)
  - Test write pipeline: event → logger → ClickHouse
  - Verify data flow with manual test call

- [ ] Add queue snapshot job: `src/services/telemetry/queue-snapshot.ts`
  - Run every hour on the hour
  - Emit `queue_snapshot` event with current claim distribution
  - Wire into BullMQ scheduler (if using) or Express cron

### Phase 3: Dashboard (Week 3)

- [ ] Build home dashboard: `src/api/dashboards/home.ts` → React UI
  - Real-time CARRIER_BLOCK status (per carrier)
  - 4-hour false escalation rate
  - Last 20 constraint violations (if any)
  - Hallucination catch count (rolling 24h)

- [ ] Build metrics dashboard: `src/api/dashboards/metrics.ts`
  - Robustness scenarios (R001-R010) pass/fail per scenario
  - Escalation confusion matrix (true positive, false positive, missed)
  - Hallucination catch by gate type
  - Aging compliance: histogram of claim ages in queue
  - Carrier health: success rate per carrier

- [ ] Build operational dashboard: `src/api/dashboards/operations.ts`
  - Queue status: total, by age bucket, by carrier
  - Call timing: avg duration, IVR nav time, rep transfer time
  - Errors: failed calls, timeouts, disconnects (hourly)
  - Practice impact: call volume, escalation rate

### Phase 4: Alerting (Week 4)

- [ ] Wire PagerDuty for CRITICAL events
  - Trigger: ANY `carrier_block.triggered` event
  - Trigger: ANY `constraint_violation.detected` event
  - Escalate to Khalid if not acknowledged in 5 min

- [ ] Wire Slack for WARNING events
  - Channel: `#voice-agent-alerts`
  - Trigger: false escalation rate >15% in 1-hour window
  - Trigger: `hallucination_caught` rate >1/hour

- [ ] Wire email backup
  - On-call team receives email for CRITICAL (PagerDuty backup)

---

## Measurement During Staging (2 Weeks)

| Metric | Target | Measurement Method | Decision |
|--------|--------|-------------------|----------|
| CARRIER_BLOCK events | 0 | Query: `event_type = 'carrier_block.triggered'` | If >0: investigate + pause carrier calls |
| Constraint violations | 0 | Query: `event_type = 'constraint_violation.detected'` | If ANY: halt all calls (emergency) |
| False escalation rate | <10% | Compare R001-R010 outcomes to ground truth | If >10%: tune Agent 3 prompt |
| Hallucination catch rate | 100% | Query: `event_type = 'hallucination_caught'` | Any escape: review gate logic |
| Escalation accuracy | 95%+ | Compare agent decision to human resolution | If <95%: review R003/R008/R012 scenarios |
| Aging compliance | 100% | Histogram of claim ages in queue | Any <32 days called: emergency fix |
| Call success rate | >80% | Calls reaching live rep / total calls | If <80%: IVR research needed |

---

## Event Retention & Compliance

**Retention Policy**:
- Events: 90 days in ClickHouse (hot analysis)
- Archive: Older events moved to cold storage (S3/GCS) for compliance audit
- Deletion: No deletion (permanent audit log)

**PHI Compliance**:
- All events use tokenized IDs (practice_id, claim_id, patient_id_token)
- No real names, SSNs, health cards in event payloads
- Amounts (claimed, approved) are OK — they're financial, not PHI
- Transcript/recording IDs are OK — they're pointers, not content

**Access Control**:
- Dashboard: Khalid + ops team only (authentication via JWT)
- ClickHouse raw queries: Khalid + data team only
- PagerDuty alerts: On-call engineer (rotation)
- Slack alerts: #voice-agent-alerts (public channel for ops)

---

## Extensibility

New events can be added by:
1. Adding event type to schema above
2. Calling telemetry logger: `log(event_type, payload)`
3. Dashboard queries automatically pick up new fields (ClickHouse schema inference)

No redeployment needed for new events.

---

## References

- MONITORING-SPEC.md (alert thresholds, dashboard requirements)
- src/services/telemetry/ (implementation target)
- .env (CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DB)
