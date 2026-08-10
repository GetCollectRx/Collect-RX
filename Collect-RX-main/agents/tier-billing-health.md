# CollectRx Tier & Billing Health Agent

**Purpose:** Monitor Stripe subscriptions, tier usage, overage accumulation, trial conversion pipeline, and unit economics per practice. Run weekly. This is the revenue health check.

---

## Context

Four billing tiers — **source of truth:** `src/billing/tiers.ts` (do not hardcode elsewhere):

| Tier | Price | Minutes | Daily Cap | Overage | Hard Stop |
|---|---|---|---|---|---|
| Trial | $0 | 500/mo | 50/day | None | Yes |
| Core | $799/mo | 1,200/mo | 100/day | $0.25/min | No (soft stop → overage confirm) |
| Growth | $1,999/mo | 2,800/mo | 300/day | $0.25/min | No (soft stop → overage confirm) |
| Scale | $2,499/mo | 4,000/mo | None | $0.20/min | No (soft stop → overage confirm) |

Infrastructure cost: $0.115/min. Paid tiers target ~78–80% gross margin at included minutes.

Warning thresholds (from `WARNINGS` in `tiers.ts`):
- 80% of monthly minutes consumed
- 3 days before billing period resets (combined with high usage)

---

## Weekly Checklist

### Stripe Payment Health

- [ ] Query Stripe for any failed payment intents in the last 7 days. For each failed payment:
  - Practice name
  - Amount
  - Failure reason
  - Whether a retry is scheduled
  - Whether the practice has been notified
- [ ] Any practice with 2+ consecutive failed payments: pause their queue and flag for manual outreach
- [ ] Upcoming renewals in the next 7 days: list practices and amounts. Cross-check that their payment method is valid (not expired).

### Trial Pipeline

- [ ] List all trial practices with: days remaining, minutes used, minutes remaining
- [ ] Practices at >80% of trial minutes or <7 days remaining: flag for conversion outreach
- [ ] Any trial that hit the 500-min hard stop: `hardStopAtLimit: true` means calls are silently stopping. Confirm the practice received an in-app notification and that the `requirePlanUsageAccess` middleware is surfacing this to them.
- [ ] Trial-to-paid conversion rate in the last 30 days

### Overage Accumulation

For Core and Growth tier practices:

- [ ] Any practice that burned >30% of their monthly minutes in a single day (triggers `dailySpendAlertPct` alert at 0.30 in `CALL_TIMEOUTS`)
- [ ] Overage minutes accumulated per practice this billing period
- [ ] Projected end-of-month overage revenue vs. infrastructure cost for that practice

For Scale tier:
- [ ] Scale has no daily cap — monitor for runaway queue behavior (>1,000 minutes in a single day is unusual for one dental practice)
- [ ] Scale overage is $0.20/min (vs $0.25 on Core/Growth); still above $0.115 cost — watch runaway usage more than margin panic.

### Overage Confirmation (from `OVERAGE` settings)

If a practice hits their included minutes:
- [ ] `pauseOnSoftStop: true` — queue should be paused automatically
- [ ] `resumeRequiresPracticeConfirmation: true` — practice must confirm overage billing before resuming
- [ ] `confirmationExpiryHours: 24` — if they don't confirm in 24h, queue stays paused

- [ ] Are any practices stuck in paused state waiting for overage confirmation? List them with time waiting.

### Unit Economics Per Practice

For each active paid practice, compute this billing period:

```
gross_margin = (tier_price + overage_revenue - (minutes_used × $0.115)) / (tier_price + overage_revenue)
```

- [ ] Any practice with gross margin below 50%: flag (Core/Growth should be ~80%)
- [ ] Any practice generating negative gross margin (using more than their tier covers in infra cost): immediate flag

### Stripe Configuration Validation

- [ ] `STRIPE_PRICE_CORE`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE` env vars are set and match actual Stripe product IDs
- [ ] Overage price IDs (`STRIPE_OVERAGE_PRICE_*`) are set for Core, Growth, Scale
- [ ] Stripe Billing (practice SaaS) Checkout / Portal works; Connect / patient pay is out of scope
- [ ] Webhook endpoint `POST /api/webhooks/stripe` is registered in Stripe dashboard and the signing secret matches `STRIPE_WEBHOOK_SECRET`

---

## Alert Thresholds

| Alert | Condition | Action |
|---|---|---|
| Payment failure | Any Stripe payment fails | Notify Khalid immediately |
| Trial hard stop | Trial practice hits 500-min limit | Auto-pause queue; send upgrade email |
| Runaway usage | Any practice burns >500 min in 1 day | Pause queue; investigate |
| Negative gross margin | Practice infra cost > revenue | Review tier assignment |
| Scale tier extreme usage | Scale practice >1,500 min/day | Manual review |
| Overage confirmation stale | Practice hasn't confirmed >12 hours | Send reminder; escalate at 24h |

---

## Revenue Summary Format

```
## Tier & Billing Health — Week of [DATE]

### Revenue at a Glance
- Active paid practices: [n]
- Trial practices: [n] ([n] converting this week)
- MRR (monthly recurring): $[amount]
- Overage revenue (this billing period so far): $[amount]

### Payment Alerts
- Failed payments: [list or "none"]
- Practices at risk of churn (payment issues): [list]

### Trial Pipeline
- Trials expiring in 7 days: [list with minutes remaining]
- Trials at hard stop: [list]
- Trial → Paid conversions (30d): [n]

### Usage Alerts
- Practices at >80% monthly minutes: [list]
- Overage pending confirmation: [list with hours waiting]
- Negative gross margin practices: [list]

### Unit Economics
- Platform gross margin this period: [%]
- Highest-margin practice: [name, margin%]
- Lowest-margin practice: [name, margin%]
```

---

## How to Run This Agent

```
"Run the CollectRx Tier & Billing Health report. Query Stripe for failed payments and upcoming renewals. Query the practice billing and usage tables for minute consumption per practice. Compute gross margins. Work through agents/tier-billing-health.md and produce the weekly report. Flag any negative-margin practices and trial hard stops immediately."
```
