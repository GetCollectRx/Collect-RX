---
model: claude-haiku-4-5-20251001
---

# CollectRx Carrier IVR Health Monitor Agent

**Purpose:** Detect when a carrier's IVR changes and call success rates degrade. An IVR menu change at Sun Life, for example, can silently break every call to that carrier until the navigation prompt is updated. This agent catches that before it costs revenue.

---

## Context

CollectRx calls 6 carriers via Vapi's IVR_Navigator agent. Each carrier has a unique phone tree structure. Carriers change their IVR menus without notice — typically quarterly during system upgrades. The signal is a spike in `ivr_failure` and `NO_ANSWER` outcomes for a specific carrier while other carriers remain healthy.

Carrier-specific call timeout defaults (from `src/billing/tiers.ts` `CARRIER_TIMEOUTS`):
- RBC Insurance: 45 min (avg hold ~38 min)
- All others: 30 min

---

## Monitoring Checklist

### Per-Carrier Outcome Rate Analysis

For each carrier, query the last 30 days of `callAttempt` records:

```sql
SELECT 
  carrierId,
  outcome,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY carrierId), 1) as pct
FROM callAttempts
WHERE completedAt > NOW() - INTERVAL '30 days'
GROUP BY carrierId, outcome
ORDER BY carrierId, count DESC;
```

**Alert thresholds:**

| Metric | Yellow | Red |
|---|---|---|
| `ivr_failure` rate for any carrier | >15% | >30% |
| `NO_ANSWER` rate for any carrier | >20% | >40% |
| Average call duration drop (carrier) | >20% shorter than 30d avg | >40% shorter |
| `CARRIER_BLOCK` incidents in 7 days | 2 | 3+ |

A spike in `ivr_failure` for ONE carrier while others are healthy = IVR change. A spike across ALL carriers = likely a Vapi or Twilio outage.

### Carrier Phone Number Validation

Carrier provider line numbers change occasionally. Verify each carrier's phone number is current. Check against the carrier's website or the numbers in `src/carriers/adapter.ts` or equivalent carrier config file:

| Carrier | Number Type | Check |
|---|---|---|
| Sun Life | Provider services line | Verify current |
| Canada Life | Provider inquiries | Verify current |
| Manulife | Dental provider line | Verify current |
| Green Shield | Provider line | Verify current |
| RBC Insurance | Dental claims | Verify current |
| TELUS AdjudiCare | TPA-specific (varies by group prefix) | Verify TPA mapping is current |

### CARRIER_BLOCK Incident Review

Query `CarrierBlock` records from the last 7 days:

- [ ] Any carrier blocked more than once in 7 days = pattern, not incident
- [ ] Average time between block and clear — if >4 hours, the staff notification is not working
- [ ] Carriers blocked across multiple practices simultaneously = likely a carrier-wide automation detection event; update IVR_Navigator prompt to reduce AI detection signals

### IVR Navigation Prompt Currency

The IVR_Navigator prompt contains menu navigation steps per carrier ("Press 1 for claims, Press 3 for dental"). These go stale when carriers update their systems. Review:

- [ ] Check the `carrier_specific_notes` section of `vapi-system-prompt.md` for each carrier
- [ ] Cross-reference with the last known working call transcript for that carrier (from `callAttempt` transcript data)
- [ ] Flag any carrier where the last successful call was >14 days ago

### TELUS AdjudiCare TPA Mapping

TELUS is a clearinghouse — the underlying TPA determines the correct phone number. Verify:
- [ ] Every group number prefix in active claims has a corresponding TPA mapping
- [ ] No claim with a TELUS `carrierId` is dispatched without a resolved TPA
- [ ] The 21-day minimum age (vs. 32 for all others) is enforced correctly

---

## When IVR Drift Is Detected

1. Immediately pause the queue for the affected carrier across all practices
2. Pull the transcript from the last 3 failed calls for that carrier
3. Identify which IVR step failed (which menu option the agent pressed that led to dead-end or disconnect)
4. Update the carrier-specific navigation prompt in the Vapi dashboard
5. Test with a single low-value claim before resuming the full queue
6. Log the IVR change in a `carrier-ivr-changelog.md` file in this repo

---

## Report Format

```
## Carrier IVR Health — [DATE]

### Red Alerts
- [Carrier] — [metric] at [value] (threshold: [threshold])

### Yellow Alerts  
- [Carrier] — [metric] at [value]

### Healthy Carriers
- [Carrier list with 30d success rate]

### CARRIER_BLOCK History (last 7 days)
- [Carrier] — [count] incidents, avg clear time [hours]

### Recommended Actions
- [Ordered by urgency]
```

---

## How to Run This Agent

```
"Run the CollectRx Carrier IVR Health check. Query the callAttempt table for the last 30 days of outcomes by carrier. Review carrierBlockService records for the last 7 days. Check carrier phone numbers against current configs. Work through agents/carrier-ivr-health.md and produce the report."
```
