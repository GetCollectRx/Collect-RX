# ADR 0005: Autonomous calling graduates per carrier

**Status:** Accepted (founder direction 2026-10-17: build toward the full insurance tool)
**Date:** 2026-10-17

## Context

ADR 0003 made Hold Sentinel the entry product and kept the autonomous squad (Claims_Agent, Escalation_Closer, Resolution_Closer) built but switched off. It left one item open: what evidence lets a carrier move from staff-handled calls to calls where CollectRx speaks with the rep. ADR 0004 then put autonomous calling on no plan.

The founder has decided the full tool, where CollectRx completes the call, is the product to build toward. That needs a switch that turns autonomy on safely, one carrier at a time, based on what Claims_Scribe has actually observed.

## Decision

Autonomous calling for a claim requires all four:

1. **Plan.** The practice's plan is listed in `AUTONOMOUS_PLAN_TIERS` (unset by default, so no plan).
2. **Practice setting.** The practice has not kept Hold Sentinel on (`humanAssistedMode`).
3. **Evidence.** The carrier passes every check below on staff-handled calls from the last 90 days.
4. **Approval.** The founder has named the carrier in `AUTONOMOUS_APPROVED_CARRIERS`.

Missing any one keeps the call on Hold Sentinel. Evidence makes a carrier eligible; approval makes it live.

| Check | Starting threshold | Why |
|---|---|---|
| Staff-handled calls logged | at least 50 | Enough calls to see the carrier's common paths |
| Reference number captured | at least 90% of calls | The scribe reliably gets the field every outcome depends on |
| Calls with unresolved fields | at most 15% | The conversation is predictable enough to script |
| Rep suspicion of automation | at most 2% | Carrier tolerance; protects against CARRIER_BLOCK |
| Playbook categories covered | at least 3 of 5 | Synthesized carrier profiles span enough situations |

Thresholds live in `DEFAULT_GRADUATION_CRITERIA` (`Collect-RX-main/src/server/learning/autonomyGraduation.ts`). Change them there and record the change below.

## How it is enforced

- `isCarrierGraduated()` is checked at dispatch in `queueEngine.ts` (claim calls) and `preVisitDispatch.ts` (pre-visit calls), and passed to `effectiveHumanAssisted()` in `src/billing/entitlements.ts`.
- It fails closed: an unapproved carrier returns false without a query, and any query error returns false.
- Results are cached for 10 minutes so dispatch does not run five counts per dial.
- The evidence query reads counts only (no log row content), with RLS bypass because it aggregates across practices.
- `GET /api/admin/autonomy-graduation` shows every carrier's counts, rates, failed checks and approval status. Platform developers only, because the figures derive from other practices' calls.

## Operator steps to open the first carrier

1. Run Hold Sentinel calls until a carrier's evidence passes (check the admin endpoint).
2. Review that carrier's synthesized profiles and a sample of its call summaries.
3. Set `AUTONOMOUS_PLAN_TIERS` (for example `core,growth,scale`) and `AUTONOMOUS_APPROVED_CARRIERS=<carrier>` on the server.
4. Watch the first autonomous calls in the live console; staff takeover stays available.

## Consequences

- With the env vars unset, behaviour is unchanged: every call stays on Hold Sentinel.
- Autonomy can open on Sun Life before Manulife, matching where the evidence is.
- Removing a carrier from `AUTONOMOUS_APPROVED_CARRIERS` returns it to Hold Sentinel within the 10-minute cache window.

## Change log

| Date | Change |
|---|---|
| 2026-10-17 | Initial thresholds |
