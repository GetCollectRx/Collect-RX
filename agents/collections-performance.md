# CollectRx Collections Performance Analyst Agent

**Purpose:** Answer the only question that matters — is this product collecting money? Tracks recovery rate, AR aging movement, per-practice ROI, and unit economics. Run weekly. The output is what you show prospects and what tells you which practices to prioritize for retention.

---

## Context

CollectRx's value proposition: recover dental insurance AR that would otherwise sit unpaid. The unit of success is dollars recovered relative to dollars claimed and minutes burned. This agent tracks that across all practices.

Unit cost per minute: $0.115 (Vapi + GPT + Deepgram + TTS + Twilio + Railway)
Gross margins per tier (from `src/billing/tiers.ts`):
- Trial: no margin (acquisition)
- Core: 82%
- Growth: 80%
- Scale: 43%

---

## Performance Metrics to Compute

### Platform-Level (All Practices)

| Metric | Query | Alert |
|---|---|---|
| Total AR recovered (30d) | Sum of `amountClaimed` where outcome = `CLAIM_PAID` or `RESOLVED` | Track week-over-week |
| Recovery rate | Claims resolved / claims attempted | Flag if <60% |
| Avg calls to resolution | Avg `attemptNumber` at resolution | Flag if >2.1 |
| Avg days from claim creation to resolution | Flag if >45 days |
| CARRIER_BLOCK impact | $ held due to carrier blocks | Flag if >$10k |
| Trial-to-paid conversion | Practices that converted from trial in last 30d | Track |

### Per-Practice

For each practice, compute:

```
Practice ROI = ($ recovered) / (minutes burned × $0.115)
```

A practice with ROI < 5x is underperforming — either their claim quality is low, their carrier mix is hard, or they need intervention.

Report the bottom 20% of practices by ROI. These are churn risks.

### AR Aging Movement

Compare the distribution of `daysSinceSubmitted` across all active claims at 30-day intervals:

- Current (0-30d): should decrease over time as claims resolve
- 31-60d: acceptable
- 61-90d: yellow alert — these need to resolve or escalate soon
- 90+d: red alert — auto-escalation should have fired; check if queue engine missed these

Flag: any claim >90 days that is still in `PENDING` queue status (should have been escalated).

### Carrier Performance Ranking

Rank all 6 carriers by:
1. Recovery rate (% of claims resolved as `CLAIM_PAID`)
2. Average calls to resolution
3. Average hold time (minutes per call)

This tells you which carriers are profitable to call and which are burning minutes for low returns.

### Revenue at Risk

Sum the `amountClaimed` for all claims in:
- `PENDING` queue status (awaiting call)
- `ESCALATED` status (awaiting human resolution)
- `CARRIER_BLOCKED` held status

This is the dollars currently in the pipeline. Report weekly trend.

---

## Unit Economics Health

Compute per practice per billing period:

```
Minutes used: from usage tracking
Minutes included in tier: from tiers.ts
Overage minutes: max(0, minutes_used - includedMinutes)
Overage revenue: overageMinutes × overageRatePerMinute
Total revenue: tierPrice + overageRevenue
Infrastructure cost: minutesUsed × $0.115
Gross margin: (revenue - cost) / revenue
```

Flag:
- Any practice where gross margin is negative (burning more than charged)
- Scale tier practices with >7,000 minutes used (overage at $0.20/min, 43% base margin — watch carefully)
- Trial practices at >80% of 500-minute limit (approaching hard stop — need conversion outreach)

---

## Weekly Report Format

```
## CollectRx Collections Performance — Week of [DATE]

### Platform Summary
- Total AR recovered (7d): $[amount]
- Total AR recovered (30d): $[amount]  
- Recovery rate: [%]
- Avg calls to resolution: [n]
- Revenue at risk (pipeline): $[amount]

### Carrier Rankings (best → worst recovery rate)
1. [Carrier] — [%] recovery, [n] avg calls
...

### Practice Performance
- Top 3 (by ROI): [list]
- Bottom 3 (by ROI / churn risk): [list]
- Practices approaching trial hard stop: [list]

### AR Aging Alerts
- Claims >90d still in queue: [count] ($[amount])
- Claims 61-90d (escalate soon): [count] ($[amount])

### Unit Economics
- Practices with negative gross margin: [list]
- Scale tier overage exposure: $[amount]
```

---

## How to Run This Agent

```
"Run the CollectRx Collections Performance report. Query callAttempt, insuranceClaim, and practice billing tables. Compute recovery rate, per-practice ROI, AR aging distribution, and unit economics per tier. Use agents/collections-performance.md as the report template. Flag any practice with negative gross margin or >90d claims still in queue."
```
