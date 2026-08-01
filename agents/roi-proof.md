# CollectRx ROI Proof Agent

**Purpose:** Produce a polished, shareable ROI report for each active practice — one that Khalid can send to a practice owner, that a practice can share with their accountant, and that closes doubters on renewal. Also produces benchmark estimates for prospects who want to know what ROI they can expect before signing up. Run monthly for each active practice, and on-demand for sales demos.

---

## The Core Argument

CollectRx is not a cost — it's a revenue recovery tool. The question is never "is the monthly tier price expensive" — it's "how much money did you recover that you would not have recovered otherwise, and how much staff time did it free up." (Current tier pricing: `src/billing/tiers.ts`.)

Every ROI report must answer:
1. How much money did we recover for you this month?
2. How many hours of admin time did your staff not have to spend on hold?
3. What is the dollar value of that time?
4. What did you pay us?
5. What's the net?

If the net is positive (which it should always be if the product is working), the renewal is a financial decision, not a budget decision.

---

## For Active Practices (Monthly)

### Data Sources

Combine outputs from:
- **Practice Time Savings** agent (hours saved, dollar value of time)
- **Collections Performance** agent (AR recovered, claims resolved, aging movement)
- **Tier & Billing Health** agent (what they paid this month, overage if any)

### Report Structure

**Page 1: The Headline Numbers**
```
[PRACTICE NAME]
CollectRx Results — [MONTH YEAR]

💰 AR Recovered: $[amount]
⏱  Admin Hours Freed: [n] hours
📞 Calls Made on Your Behalf: [n] calls
📈 Net ROI This Month: $[recovered + time_value - cost]
```

**Page 2: What We Did**
- Breakdown by carrier (Sun Life: [n] calls, [n] resolved, $[recovered])
- Claims resolved vs. denied vs. escalated vs. pending
- After-hours calls made while your office was closed: [n] calls, [n] hours saved

**Page 3: Aging Movement**
Show the AR aging table before and after the month:
```
Days Outstanding | Start of Month | End of Month | Change
0-30 days        | $[amount]      | $[amount]    | [+/-]
31-60 days       | $[amount]      | $[amount]    | [+/-]
61-90 days       | $[amount]      | $[amount]    | [+/-]
90+ days         | $[amount]      | $[amount]    | [+/-]
```

**Page 4: The Math**
```
What you paid CollectRx: $[tier price]
Value of AR recovered: $[amount]
Value of admin time freed: $[hours × wage]
Total value delivered: $[AR + time]
Net (after CollectRx fee): $[total - tier]
ROI ratio: [x]×

Since you joined [ONBOARDING_DATE]:
Total AR recovered: $[cumulative]
Total admin hours freed: [cumulative]
Total paid to CollectRx: $[cumulative]
Cumulative net: $[cumulative]
```

---

## For Prospects (On-Demand Estimates)

When Client Acquisition is preparing for a demo, generate an estimated ROI report based on practice profile inputs:

**Input parameters:**
- Practice size (number of chairs)
- Estimated monthly AR outstanding (practice provides or estimate from industry benchmarks)
- Primary carriers (which 6 they use, weighted by volume)
- Number of admin staff handling insurance
- Estimated staff wage ($22-26/hr Ontario)

**Output:**
```
## CollectRx ROI Estimate for [Practice Name]
[Prepared for: demo on DATE]

Based on your practice profile, here is what CollectRx typically delivers for practices like yours:

Estimated AR recovered per month: $[range based on practice size]
Estimated admin time freed: [n] hours/month
Dollar value of time freed: $[amount]
Expected total monthly value: $[combined]
CollectRx cost (recommended tier): $[tier]
Expected monthly net: $[value - cost]
Expected ROI ratio: [x]×

This is an estimate. Your actual results will depend on the age of outstanding claims and which carriers are involved. We recommend starting with a 30-day trial — you'll see real numbers in your first month.
```

---

## ROI Benchmarks by Practice Size

Maintain these from actual practice data (update quarterly):

| Practice Size | Avg Monthly AR Recovered | Avg Time Freed | Avg Net ROI |
|---|---|---|---|
| Solo (1-2 chairs) | $[from data] | [n] hrs | $[net] |
| Mid (3-4 chairs) | $[from data] | [n] hrs | $[net] |
| Larger (5+ chairs) | $[from data] | [n] hrs | $[net] |

Until real data is available, note these as estimates and source them from dental billing industry data (route to Researcher agent to verify benchmarks).

---

## Churn Prevention Use

If collections-performance or voice-of-customer flags a practice as "showing low satisfaction" or "considering cancellation," immediately run this agent for that practice. The ROI report is the primary retention tool.

If net ROI is negative (practice paid more than they recovered), this is a product problem, not a sales problem. Flag to:
- Product Manager (is the product failing this practice type?)
- Collections Performance (which claims are not resolving and why?)
- Carrier IVR Health (is a specific carrier dragging down this practice?)

A negative ROI practice will churn. Address the root cause, not just the presentation.

---

## How to Run This Agent

```
"Run the CollectRx monthly ROI proof report for practice [ID/name] for [MONTH YEAR]. Pull data from collections performance and practice time savings agents. Combine with billing data for the period. Produce the full 4-page ROI report in agents/roi-proof.md format. Flag if net ROI is negative — do not send a negative ROI report to a practice; instead escalate to Product Manager."
```

For prospect estimates:
```
"Generate a CollectRx ROI estimate for a prospect with [profile details]. Use the benchmark data in agents/roi-proof.md and practice-time-savings.md. Produce the one-page prospect estimate. Note it as an estimate and invite them to see real numbers in a 30-day trial."
```
