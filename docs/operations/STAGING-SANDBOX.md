# Live staging sandbox

The `collect-rx-staging` Fly app runs the real product as a contained sandbox: two synthetic dental practices, the real queue engine scheduling calls in the real Mon to Fri, 8am to 5pm Eastern window, and a carrier simulator that plays each call in real time. Calls show up in the real UI exactly as a practice sees them.

Code: `Collect-RX-main/src/server/sandbox/`. Config: `Collect-RX-main/fly.staging.toml`.

## What is real and what is simulated

| Part | In the sandbox |
|---|---|
| UI, logins, claims import, queue engine, call rules, CARRIER_BLOCK, billing caps, webhooks, outcome processing, scribe, redaction, notifications | The real product code, unchanged |
| Vapi | Replaced by an in-process stand-in for Vapi's API (create call, read call, control URL, delete recording). The product's own Vapi client talks to it |
| The carrier | A simulator plays each call: phone menu (from `carriers/*.json`), 15 to 40 minutes of hold, the rep, and the outcome. It sends the same signed server messages Vapi would to the real webhook route |
| Practice staff (Hold Sentinel) | Played by the simulator after the product transfers the call |
| Audio, speech recognition, real carrier behaviour | Not simulated. Nothing here tests phone menu recognition, audio quality or how real carriers react |

## Safety

- `SANDBOX_MODE=1` blocks every outbound HTTP request to a host other than the process itself (`fetch`, `http`, `https`). Vapi, Twilio, SendGrid, Stripe, Anthropic and any other service are unreachable whatever keys are set.
- The process refuses to start if Vapi is not pointed at the in-process stand-in, or if a live Stripe key is set.
- The stand-in Vapi API answers loopback connections only; requests through Fly's proxy get 404.
- All data is synthetic: invented names and identifiers, fictional 555-01xx phone numbers, practices named `SYNTHETIC ...`.

## Practices and logins

| Practice | Mode | Owner | Front desk |
|---|---|---|---|
| SYNTHETIC Sandbox Dental (Hold Sentinel) | Hold Sentinel | `owner.holdsentinel@sandbox.collectrx.test` | `frontdesk.holdsentinel@sandbox.collectrx.test` |
| SYNTHETIC Sandbox Dental (Autonomous) | Autonomous (Scale plan, Hold Sentinel off) | `owner.autonomous@sandbox.collectrx.test` | `frontdesk.autonomous@sandbox.collectrx.test` |

The password for all four is the Fly secret `SANDBOX_LOGIN_PASSWORD` (12 characters or more):

```
fly secrets set -a collect-rx-staging SANDBOX_LOGIN_PASSWORD='<choose one>'
```

Until it is set the logins exist but cannot sign in. Autonomous calling needs PR #167 (autonomous on the Scale plan); without it the second practice also dials in Hold Sentinel mode.

The owner sees Dashboard, Claims, Analytics and the results page. The front desk sees the Live Console, where active calls, the queue and carrier blocks appear.

## Scenarios and results

Each practice gets one claim per playable scenario in `validation-lab/registry/scenarios.json` (the 248-scenario registry). Claim numbers carry the scenario: `SBX-<scenarioId>-<seq>`. Scenarios in the `dispatch`, `ops` and pilot-only harnesses are not phone calls and are not played.

The simulator maps each scenario's expected outcome (or, when that text is not specific, its carrier persona) to how the rep behaves: paid, partial, denied, not covered, maximum reached, processing, not received, documents needed, automation refusal, callback, technical failure or unclear.

Every finished call is scored about 20 seconds after it ends:

- the product reached the expected state (claim status, attempt outcome, or CARRIER_BLOCK for a refusal);
- the stored transcript does not contain the patient's name;
- a Hold Sentinel call that reached a rep was transferred to staff.

Results: signed in as a practice owner, open `/api/sandbox/results/page` (JSON at `/api/sandbox/results`). Results are kept in the audit log (`sandbox.scenario_result`) with no patient details.

## Operating it

- **Calls only run Mon to Fri, 8am to 5pm Eastern.** Outside that window the queue waits, as in production.
- **CARRIER_BLOCK stops a carrier until staff resume it.** Refusal scenarios block their carrier, and every later call to that carrier waits until someone resumes it in the Live Console. This is the product's real behaviour.
- **Calls take real time.** One practice works through its claims one call at a time, so a full pass takes several business days.
- **Restarts and deploys** resume calls that were in progress; events already past are not replayed, and an overdue call is ended at once.
- **Reset to a clean slate:** change `SANDBOX_RESET_TOKEN` in `fly.staging.toml` to a new value and deploy. On the next boot the database is wiped once and the practices are recreated. The reset only runs on the `collect-rx-staging` app.
- **Turn the sandbox off:** remove `SANDBOX_MODE` from `fly.staging.toml` and deploy.

## Findings from the first local run (2026-11-07)

Run locally at 60 times speed against a fresh database: both practices, real import, real queue, real webhooks.

| Finding | Evidence |
|---|---|
| Autonomous calls: a rep saying "That claim was paid in full ... by direct deposit" is not recognised as paid. The outcome is HUNG_UP ("manual review recommended") and the claim goes back into the call queue. The classifier only matches fixed phrases such as "payment issued", "eft processed" or "claim has been paid". | Scenario OF-canada_life; `src/outcome/processor.ts` legacy phrases and `RESOLUTION_PATTERNS` |
| Autonomous calls: a rep who gives conflicting statuses and defers to a supervisor is classified HUNG_UP and requeued, not escalated to staff. | Scenarios OJ-manulife, T005 |
| Hold Sentinel calls passed every check in the run: transfer, scribe outcome, claim status, redaction. | 4 of 4 scored calls |
| Automation refusals triggered CARRIER_BLOCK in both modes. | 2 carrier blocks |
