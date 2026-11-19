# ADR 0004: Product tiers unlock features by plan

**Status:** Accepted (founder decision)
**Date:** 2026-10-06

## Context

ADR 0003 made Hold Sentinel the V1 product. The code, though, offered every feature on every plan: eligibility checks, denial evidence, underpayment recovery and the autonomous squad were all open on any tier, and the cheapest paid tier was $799. The founder does not want everything offered or available right away. The product should open up in stages.

## Decision

Three stages. Features open only through a paid upgrade (no usage-based or time-based unlocks).

| Stage | Plan (tier id) | Price | Includes |
|---|---|---|---|
| 1 | Hold Sentinel (`sentinel`), and the 30-day trial | $399/month, 1,000 min, $0.25/min overage | Calls through Hold Sentinel with staff handoff, reference number capture on a missed handoff, aged AR dashboard, CSV import, **CDCP tools** (predetermination and reconsideration tracking, denial work on CDCP claims) |
| 2 | Recovery (`core`; Growth and Scale are larger sizes of it) | $799 / $1,999 / $2,499 | Everything in stage 1, plus pre-visit eligibility for private carriers (calls and TELUS Tx23), denial evidence and resubmission tracking on non-CDCP claims, underpayment recovery |
| 3 | Autonomous | Not on any plan | The AI speaks with the rep. Opens per carrier only after the graduation criteria in ADR 0003 are met |

CDCP sits in stage 1 because it is the entry point: practices feel that pain now.

## How it is enforced

- Plan membership lives in one file, `Collect-RX-main/src/billing/entitlements.ts`. An org-billed practice gets the organization's plan (`src/server/plans/practiceEntitlements.ts`).
- Enforcement is at the server, not only in the UI:
  - Claim calls (`queueEngine.ts`) and pre-visit calls (`preVisitDispatch.ts`) use Hold Sentinel unless the plan includes autonomous calling. No plan does, so the practice setting alone cannot reach the autonomous squad.
  - Private-carrier eligibility is not queued (`appointmentVerification.ts`) and is skipped at dispatch with `not_in_plan` before any PHI is read (`preVisitDispatch.ts`).
  - Denial evidence routes return 403 on non-CDCP claims, and underpayment routes return 403, without the Recovery plan (`src/routes/insurance.ts`).
  - Saving settings with Hold Sentinel turned off stores it as on when the plan has no autonomous calling. It is rewritten rather than rejected, so practices that saved `false` before plans existed can still save other settings.
- Background detection (denial evidence items, underpayment cases found on import) still runs on every plan. The data is there when a practice upgrades, and it feeds carrier learning. Only the tools to work it are locked.
- The Billing page lists what the plan includes and which plan opens the rest. The Settings toggle is locked while autonomous calling is on no plan.

## Pricing notes

- $399 with 1,000 minutes, not 1,200. Delivery cost is metered at $0.135/min. At 1,200 minutes the COGS breaker's 40% throttle line ($159.60) would trip at minute 1,182, before the pool ran out. At 1,000 minutes, in-plan cost is $135, which is under the line.
- Gross margin is about 63% at full use, against about 80% on Recovery. This is the thin-margin trade the founder accepted in exchange for carrier-behaviour data.
- Core keeps its tier id `core` (Stripe price env `STRIPE_PRICE_CORE`, existing subscriptions) and is renamed "Recovery" for display only.

## Operator steps before selling Hold Sentinel

1. Create a $399 CAD recurring Price in Stripe and set `STRIPE_PRICE_SENTINEL` (optionally `STRIPE_OVERAGE_PRICE_SENTINEL`). Until then the plan does not appear in the catalog.
2. Run `prisma migrate deploy` (adds `sentinel` to the `BillingTier` enum).
3. Checkout now defaults to Hold Sentinel when no plan is chosen. Set `SUBSCRIPTION_DEFAULT_PLAN_ID` to override.

## Consequences

- Practices on Recovery today lose nothing.
- Trial practices see the stage 1 feature set, so the trial demonstrates the product they would first buy.
- Adding a feature to a stage is a one-line change in `TIER_FEATURES`, but every new feature also needs a server-side check where it is used.
