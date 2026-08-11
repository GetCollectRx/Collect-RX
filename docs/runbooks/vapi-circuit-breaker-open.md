# Runbook: Vapi circuit breaker open

**Severity: Critical.** Covers alert catalog ID `vapi_circuit_open` (`alertCatalog.ts`). While OPEN, **no new carrier calls dispatch for any practice** — this is fleet-wide, not one practice or one carrier.

## Detection

- `dispatchOpsAlert({ alertId: 'vapi_circuit_open', ... })` fires once per OPEN transition from `Collect-RX-main/src/vapi/circuitBreaker.ts`.
- The desk queue engine's own tick-level check (`queueEngine.ts`) logs `[deskQueueEngine] Vapi circuit breaker OPEN — skipping dispatch this tick` and skips the whole tick rather than letting every candidate claim fail individually into its own 15-minute deferral.

## Assessment

1. `GET /api/health/metrics` or `/api/diagnostics` — read `vapiCircuitBreaker`:
   - `state` — should be `OPEN` if this alert fired; check `HALF_OPEN` too (it's mid-recovery-probe).
   - `failureReasons` — breakdown by classification (timeout / 5xx / 4xx / network / unknown) tells you what's actually failing.
   - `nextProbeEligibleAt` — when the breaker will next attempt a HALF_OPEN probe on its own.
   - `consecutiveFailures` / `openCount` — how bad and how repeated.
2. Check Vapi's own status page for a known outage.
3. Check recent deploys to `src/vapi/client.ts` or squad config — did dispatch shape change (new required field, changed timeout) right before this started?
4. Confirm the failure isn't actually a config problem masquerading as a Vapi outage: verify `VAPI_API_KEY` and `VAPI_SQUAD_ID` are current and not rotated/revoked.

## Escalation

- **Page immediately** — this blocks every practice, not one. Treat it with the same urgency as a full API outage.
- If Vapi confirms a real outage on their end, this is expected behavior working correctly (the breaker is doing its job) — communicate that clearly rather than treating the breaker itself as the problem. Downgrade urgency once Vapi's outage is the confirmed cause, but keep watching for the breaker to actually close once they recover.

## Mitigation

- **The breaker self-manages** — it will automatically attempt a HALF_OPEN probe once `nextProbeEligibleAt` passes, and close again after enough consecutive successes. No manual reset is needed or possible by design.
- **If Vapi is confirmed healthy but the breaker won't close:** the problem is almost certainly on this side — check `VAPI_API_KEY`/`VAPI_SQUAD_ID` are correct for the current environment, and check recent deploys to `src/vapi/client.ts` for a request-shape regression that Vapi's API is rejecting as a 4xx (which the breaker's failure classification still counts against it).
- **If Vapi's outage is prolonged:** there is nothing to "fix" on this side beyond waiting — communicate the expected impact (no automated calls) to affected practices rather than attempting a workaround.

## Verification

1. `vapiCircuitBreaker.state` back to `CLOSED` in `/api/health/metrics`.
2. `GET /api/health/metrics`'s `queue` block — `duePendingCount` starts moving again (confirms dispatch actually resumed, not just that the breaker's state flipped).
3. Watch at least one real call dispatch through the live desk view before considering this fully resolved.

## Postmortem

Required. If root-caused to a request-shape regression in `src/vapi/client.ts`, the action items should include what test coverage would have caught it before deploy — the breaker correctly *contained* the failure, but containment isn't prevention.
