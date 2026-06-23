# CollectRx Agent Escalation Contract

Every autonomous agent produces output following `output-schema.json`. The escalation service reads the `severity` field of each run and takes the action defined here — automatically, without human prompting.

---

## Severity Definitions

| Severity | Meaning | Response time |
|---|---|---|
| **CRITICAL** | Imminent or active harm — PHI breach, active CARRIER_BLOCK, confirmed hallucination, compliance violation | Immediate — alert fires before the agent session ends |
| **HIGH** | Risk will materialize within 30 days without action — stale P0 decision, abnormal financial metric, failed queue heartbeat | Same-day — surfaces in morning digest |
| **MEDIUM** | Risk likely within 90 days — IVR deviation, elevated escalation age, sub-threshold outcome drift | Weekly digest |
| **LOW** | Exists but unlikely without a major change — minor terminology drift, low-signal trend | Monthly digest |
| **OK** | No findings. All checks passed. | Logged silently. |

---

## Escalation Actions by Severity

### CRITICAL
1. Push notification to Khalid (immediate, via `PushNotification` tool)
2. Email to `khalidegeh97@gmail.com` with finding ID, domain, description, and exact action required
3. Set `escalated = true` on the `AgentRun` record
4. If domain is `PHI Breach`: trigger `phi-access-log-reviewer` immediately regardless of schedule
5. If domain is `Carrier Block`: trigger `carrier-ivr-health` immediately

Notification format:
```
🔴 CRITICAL — CollectRx Agent Alert
Agent: <agentName>
Finding: <finding.description>
Action required: <finding.action>
Evidence: <finding.evidence>
Run ID: <agentRunId>
```

### HIGH
1. Include in daily morning digest (sent at 07:00 ET)
2. If finding is open for 7+ days without resolution, escalate to CRITICAL on next run

### MEDIUM
1. Include in weekly digest (Monday 08:00 ET)
2. No immediate notification

### LOW / OK
1. Logged to `agent_runs` table only
2. No notification

---

## Daily Morning Digest

Sent at 07:00 ET every weekday to `khalidegeh97@gmail.com`. Contains:
- All CRITICAL findings from the last 24 hours (with escalated flag)
- All HIGH findings from the last 24 hours
- Data quality score from `analytics-pipeline`
- Domain health summary from `risk-radar`
- Any downstream agent triggers that fired overnight

Subject: `CollectRx Daily — [DATE] — [highest severity level]`

---

## Downstream Trigger Rules

When an agent completes, the runtime checks its `downstream` array and fires those agents immediately (not waiting for their normal schedule) if:
- The triggering agent's severity is CRITICAL or HIGH, AND
- The downstream agent has not run in the last 4 hours

Example: `analytics-pipeline` severity CRITICAL → immediately triggers `risk-radar` and `hallucination-detector`.

---

## Override: Human-in-the-Loop Gates

The following actions require Khalid to explicitly confirm before the agent takes them — they are never autonomous:

| Action | Reason |
|---|---|
| Pausing a carrier (`CARRIER_BLOCK`) | Operational impact — all calls to that carrier stop |
| Writing off a claim | Financial — irreversible |
| Submitting a formal appeal | Requires practice-specific documentation |
| Any action touching PHI records directly | PHIPA compliance |

The agent surfaces the recommendation and waits. It does not execute.

---

## Escalation API Endpoint

Agents POST their output to:
```
POST /api/agent-runs
Authorization: Bearer $AGENT_RUNTIME_SECRET
Content-Type: application/json
Body: <AgentRunOutput per output-schema.json>
```

The escalation service fires automatically on write, based on the `severity` field.

To read the latest output from another agent:
```
GET /api/agent-runs/latest/:agentName
```

Returns the most recent `AgentRun` for that agent, including `raw` payload for downstream consumption.
