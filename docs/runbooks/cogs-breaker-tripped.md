# Runbook: Practice delivery-cost breaker tripped

**Severity: High.** Covers alert catalog ID `cogs_breaker` (`alertCatalog.ts`). This directly stops a paying practice's automated carrier calls — treat it as customer-facing, not purely internal.

## Detection

- `evaluateCogsBreaker()` (`Collect-RX-main/src/server/plans/usagePeriodService.ts`) compares month-to-date delivery cost (`minutesConsumed * UNIT_ECONOMICS.costPerMinute`) against the practice's subscription price. Crossing `COGS_BREAKER.pauseAtPctOfPrice` pauses all calling for that practice (`callsPaused: true`, `callsPausedReason: 'cogs_breaker'`) and dispatches this alert. Crossing the lower `throttleAtPctOfPrice` threshold first throttles to essential-only (high/urgent priority claims) dispatch without pausing entirely — that's a quieter warning sign, not this alert.

## Assessment

1. Identify the practice from the alert's `source` field (`source: practice.id`) and `detail` (minutes consumed, tier).
2. Check the practice's usage: `GET` the practice's usage/billing view, or query `UsagePeriod` for the current cycle — is the spend legitimate (a genuine backlog of claims, or unusually long carrier holds), or does it look anomalous (a bug causing runaway redialing, a claim stuck in a retry loop)?
3. If anomalous: check `CallAttempt` durations for this practice's recent calls — an unusually high average duration or attempt count per claim points to a navigation/hold-detection bug (`Hold_Sentinel` not handing off correctly, IVR navigation looping) rather than genuine carrier call volume.
4. Confirm the practice's tier and whether this is expected given their plan (`billing/tiers.ts`) — a trial or low tier practice with genuinely high claim volume may just need a tier upgrade, not a bug fix.

## Escalation

- Not an infrastructure page — this is a billing/product signal, not a system failure. Route to whoever owns billing/customer success, with the practice ID and usage detail from the alert.
- Escalate to engineering only if the usage pattern looks like a bug (anomalous call durations/loops) rather than genuine volume.

## Mitigation

- **Legitimate high usage, right tier already:** discuss a tier upgrade with the practice so their minute pool matches their actual claim volume — this is the intended outcome of the breaker, not something to "fix" by clearing the pause.
- **Legitimate high usage, needs urgent resumption before the upgrade conversation completes:** clear the pause manually — update the practice's `callsPaused`/`callsPausedReason` fields (or use whatever admin action wraps this, if one exists) — but only as a bridge, with a clear follow-up to actually resolve the tier mismatch. The breaker will re-trip at the same threshold if usage keeps climbing without a tier change.
- **Anomalous usage (bug):** fix the underlying navigation/hold-detection issue first. Do not just clear the pause — it will trip again immediately and mask the real problem, and the practice's actual cost exposure keeps growing until the bug is fixed.
- **Natural resolution:** the pause also clears automatically at the next billing cycle reset (`startNewBillingCycle()`), if you're comfortable waiting rather than manually resuming.

## Verification

1. Confirm `callsPaused: false` for the practice (via the same admin view/query used to detect the pause).
2. Watch the next scheduled call for that practice dispatch successfully.
3. If a bug was the cause, verify with a handful of subsequent calls that durations/attempt counts are back to normal before considering it resolved.

## Postmortem

Required only if the trip was caused by a bug (anomalous usage) rather than genuine practice volume. A tier-upgrade resolution doesn't need one — it's the system working as intended.
