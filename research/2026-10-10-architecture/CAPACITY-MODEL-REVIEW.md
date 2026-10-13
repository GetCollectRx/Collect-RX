# Review of the guaranteed calling capacity model (2026-10-13)

Reviewer: Claude, for Khalid. Scope: the "CollectRx guaranteed calling capacity model" dated 2026-10-13. Code checked: `Collect-RX-main/src/billing/tiers.ts`, `Collect-RX-main/src/server/frontDesk/queueEngine.ts`. No code changed.

## Verified against code and arithmetic

| Claim | Result |
|---|---|
| Daily caps 100 (Hold Sentinel, Recovery), 300 (Growth), none (Scale) | Matches tiers.ts |
| Fleet limit 10, reserve 2, carrier limit 5 | Matches queueEngine.ts and tiers.ts |
| COGS breaker 40% throttle, 60% pause of subscription price | Matches COGS_BREAKER |
| Hold Sentinel throttle 1,182 min, pause 1,773 min | Recomputed, correct |
| Recovery 2,367 / 3,551; Growth 5,923 / 8,884 | Recomputed, correct |
| Slot table at 60, 70, 80 percent utilization | Recomputed, correct |
| Revenue, cost, margin figures | Recomputed, correct |
| 100-client revenue $184,900 | Correct only if the 60 small clients are on Recovery ($999). Not stated in the doc |

## Gaps the model misses

1. Payer concentration is the binding limit. Six carriers at 5 simultaneous calls each cap the fleet at 30 concurrent calls, about 11,340 call-minutes per day at 70 percent utilization. The 100-client example needs 21,000 minutes and 62 slots, so it is infeasible on the current carrier set. Route feasibility must be the first gate, not the last.
2. Scale has the same breaker contradiction as Hold Sentinel. Price $2,499 gives throttle at 7,404 min and pause at 11,107 min. A 600 min/day reservation over 20 days is 12,000 min, so it would be paused before month end.
3. Overage workflow is a second hidden stop. Calls pause at included minutes until the practice confirms overage; unconfirmed requests auto-decline after 24 hours. A daily-minutes promise needs standing pre-authorized overage with a spend limit.
4. One call per practice per tick means a single stream carries at most 540 minutes in a nine-hour window, so a 600-minute Scale reservation is impossible until the per-client concurrency ceiling ships.
5. A shared pool of one to three numbers carries risks the model does not weigh: carrier automation detection (CARRIER_BLOCK), spam labelling, and callback attribution to a client. Treat pool size as an assumption to test in a controlled carrier test.
6. 70 percent utilization is an assumption. Hold times are long-tailed and demand clusters in the morning. Recalibrate from observed hourly concurrency before selling the tables.

## Unverified

- Vapi pricing and concurrency terms, Twilio call-start rate and number pricing: the doc's citations, not confirmed (vendor pages unreachable from the sandbox).
- The 45-minute call ceiling and 9-hour window as live settings.

## Recommendation

- Keep the shared-slot principle; resequence the go-live rule to start with payer-route feasibility.
- Fix the breaker to count authorized overage revenue and require pre-authorized overage before any daily-minutes promise.
- Do not sell a fixed daily-minutes figure on Scale until the per-client concurrency ceiling exists and route limits are validated.
- First measurement: log hourly concurrency per carrier from existing calls.
