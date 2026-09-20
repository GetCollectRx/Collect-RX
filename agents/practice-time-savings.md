---
model: claude-haiku-4-5-20251001
---

# CollectRx Practice Time Savings Agent

**Purpose:** Quantify, in hours and dollars, exactly how much time CollectRx saves each dental practice. This is not a vanity metric — it's the primary retention argument and the centerpiece of the ROI case. If a practice questions whether CollectRx is worth $599/month, this agent produces the proof. Run monthly per active practice. Feeds into: ROI Proof, Voice of Customer, Client Acquisition (benchmarks for new prospects).

---

## What We're Measuring

Dental admin staff spend time on insurance follow-up in three ways:

1. **Active hold time** — On hold with a carrier waiting for a rep
2. **Active inquiry time** — Speaking with a carrier rep about a claim
3. **Administrative wrap time** — Logging the outcome, updating the PMS, filing notes

CollectRx replaces (1) and (2) entirely. It also reduces (3) because the transcript and structured outcome are available directly.

**Industry benchmarks:**
- Average hold time per carrier call: 18-25 minutes (Canada Life and RBC are highest)
- Average active inquiry time per claim: 8-12 minutes once connected
- Total time per claim inquiry call: 26-37 minutes
- Source: To be verified by Researcher agent — flag if outdated

---

## Per-Practice Calculation

### Input Data (from call records)

```sql
SELECT
  c.practiceId,
  c.carrierId,
  COUNT(*) AS totalCalls,
  SUM(c.duration) AS totalCallMinutes,
  COUNT(CASE WHEN c.outcome IN ('RESOLVED', 'APPROVED_PENDING_PAYMENT') THEN 1 END) AS resolvedCalls,
  COUNT(CASE WHEN c.outcome = 'DENIED' THEN 1 END) AS deniedCalls,
  AVG(c.duration) AS avgCallDuration
FROM "Call" c
WHERE c.practiceId = [practice_id]
  AND c.completedAt > NOW() - INTERVAL '30 days'
GROUP BY c.practiceId, c.carrierId;
```

### Time Saved Calculation

For each call completed by CollectRx:
- **Hold time saved** = industry average hold time for that carrier (sourced from carrier-ivr-health.md benchmarks)
- **Inquiry time saved** = industry average inquiry time per call
- **Total time saved per call** = hold + inquiry time

```
Total monthly time saved = SUM over all calls of (hold_time_saved + inquiry_time_saved)
```

### Dollar Value of Time Saved

- Average dental admin staff hourly wage (Ontario): ~$22-26/hour (verify via Researcher agent)
- Time saved in hours × hourly wage = dollar value of staff time saved per month

```
Value saved = (total_minutes_saved / 60) × hourly_wage
```

### Net ROI to Practice

```
Net monthly value = value_of_AR_recovered + value_of_time_saved - tier_cost
```

Where `value_of_AR_recovered` comes from the collections-performance agent.

---

## After-Hours Value

CollectRx can run calls during off-hours (configured call window). Any call completed outside the practice's working hours is 100% additional capacity — the practice's staff couldn't have made that call even if they wanted to.

Track:
```sql
SELECT
  COUNT(*) AS afterHoursCalls,
  SUM(duration) AS afterHoursMinutes
FROM "Call" c
WHERE c.practiceId = [practice_id]
  AND c.completedAt > NOW() - INTERVAL '30 days'
  AND (
    EXTRACT(HOUR FROM c.startedAt AT TIME ZONE practice_timezone) < 9
    OR EXTRACT(HOUR FROM c.startedAt AT TIME ZONE practice_timezone) >= 17
    OR EXTRACT(DOW FROM c.startedAt AT TIME ZONE practice_timezone) IN (0, 6)
  );
```

After-hours calls are pure capacity addition — no human equivalent exists. Present this separately as "calls that simply couldn't have happened otherwise."

---

## Carrier-Specific Hold Time Benchmarks

Maintain benchmarks from real call data:

| Carrier | Avg Hold Time (CollectRx measured) | Industry Reported | Last Updated |
|---|---|---|---|
| Sun Life | [from call data] | 18-22 min | [date] |
| Canada Life | [from call data] | 22-28 min | [date] |
| Manulife | [from call data] | 15-20 min | [date] |
| Green Shield | [from call data] | 12-18 min | [date] |
| RBC Insurance | [from call data] | 25-35 min | [date] |
| TELUS AdjudiCare | [from call data] | 10-15 min | [date] |

Update these monthly from actual call duration data. Real data always beats industry estimates.

---

## Monthly Per-Practice Report Format

```
## Practice Time Savings Report — [PRACTICE NAME] — [MONTH YEAR]

### Call Activity
- Total calls handled by CollectRx: [n]
- After-hours calls (couldn't have been made by staff): [n]
- Per carrier: [breakdown]

### Time Saved
- Estimated hold time saved: [n] hours [n] minutes
- Estimated inquiry time saved: [n] hours [n] minutes
- Total staff time freed: [n] hours [n] minutes
- After-hours calls (additional capacity): [n] hours [n] minutes

### Dollar Value of Time Saved
- Staff time freed @ $[wage]/hr: $[amount]
- After-hours capacity (no human equivalent): BONUS (not counted in base ROI)

### AR Recovered (from Collections Performance)
- Total recovered this month: $[amount]
- Claims resolved: [n]
- Outstanding AR reduced by: [%]

### Net ROI This Month
- Value recovered: $[AR recovered]
- Value of time freed: $[time value]
- Total value: $[combined]
- Cost (tier): $[tier price]
- Net: $[total - tier]
- Return on investment: [x]×

### Cumulative Since Onboarding
- Total AR recovered: $[amount]
- Total staff hours freed: [n]
- Total investment: $[amount]
- Cumulative ROI: [x]×
```

---

## How to Run This Agent

```
"Run the CollectRx monthly time savings report for practice [ID/name] for [MONTH YEAR]. Query call records for the period. Calculate time saved using carrier-specific hold time benchmarks. Calculate dollar value using current Ontario admin wage rate. Combine with collections performance data for net ROI. Produce the per-practice report in agents/practice-time-savings.md format."
```
