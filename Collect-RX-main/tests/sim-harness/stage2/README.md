# Stage 2: Carrier Twin

Stage 1 and the office-day suite prove the CollectRx backend. They cannot prove the call chain, because their fake carrier is built from `carriers/*.json`, which is what the product already believes. Passing against your own beliefs is circular. Stage 2 breaks the circle in two ways.

1. **A phone system we control, served as TwiML** (`carrierTwin.ts`). A Twilio number points its voice webhook at it. The real Vapi squad dials that number with the real prompts, real DTMF handling, real hold detection and real transfer logic. The twin records its own ground-truth timeline: what it played, which keys arrived, when hold began, when a "rep" answered, what the agent said to the rep.
2. **Mutations that depart from what the JSON believes** (`scenarios.ts`): reordered menu digits, an unskippable message, speech-only input, a rejected identifier, a closed line, a drop on hold, a hold line that talks, a voicemail pickup, a rep who asks if they are speaking to a person, a rep from the wrong department, a rep who asks for data the practice never supplied. Six carriers by eleven mutations plus six baselines is 66 scenarios.

Scoring (`scoring.ts`) compares the agent with the twin's timeline, never with the agent's own account.

## What is verified offline today

| Claim | Evidence |
|---|---|
| The twin behaves like a phone system: TwiML shape, key handling, re-prompts, disconnect after too many wrong keys, hold loops, voicemail, drop | `carrierTwin.conformance.test.ts` |
| Control routes need a token; webhooks need a valid Twilio signature; scenario text is XML-escaped; caller digits are never echoed | same file |
| Each mutation catches the bad agent it targets while a careful reference agent passes it | same file, "Mutation sensitivity" in the run report |
| The live runner sends the product's own dial payload with only `customer.number` changed, for all six carriers | `parity.test.ts` |
| The destination can never be a real carrier line, the CDCP line, an emergency number, a malformed number, or anything but `STAGE2_TWIN_NUMBER` | `parity.test.ts` |
| Nothing is placed without `--live`, a spend cap, a per-minute rate and a worst-case cost under the cap | `parity.test.ts` |
| Place, poll and read a call record works, and a record with missing fields aborts the run | `parity.test.ts`, against a local fake |

## What is NOT verified, and why it matters

- **Weak offline sensitivity.** Several mutations (`unskippableMessage`, `speechOnly`, `providerIdRejected`, `afterHours`, `holdDrop`, `repAsksIfRobot`, `repWrongDepartment`, `repAsksExtraPhi`) are caught offline only by an agent that wrongly marks the claim resolved. Their real hazards (pressing keys during a message, looping, claiming to be human, volunteering identifiers) show up only in live runs, in the twin's `key_received`, `silence` and `agent_speech` events. They are scored, but unproven until a live run.
- **Field names of Vapi's call record** come from what the product's webhook normalizer reads, not from Vapi's live API. The strict reader aborts on any missing field, so the first live run fails loudly instead of scoring garbage.
- **Agent-side observations** (when staff transfer was requested, whether the claim was marked resolved) must come from the staging database and webhooks, not from the Vapi record. That wiring is not built; running the live stage without it scores only the twin-observable checks.
- **Thresholds** (pickup to transfer, disclosure delay) are placeholders, marked `UNVERIFIED placeholder` in every result, until the PRD section 5 numbers are supplied.
- **Real carriers.** Nothing here shows how Sun Life or Manulife actually behave. Their IVR maps in `carriers/*.json` were last verified between 2025-02 and 2026-05, with paraphrased prompts and no recordings attached. Closing that needs recorded IVR-only probe calls to the real lines, which carries carrier terms-of-service and CARRIER_BLOCK risk and needs your decision first.

## Running the live stage (needs your decisions and keys)

1. Deploy the twin (`createCarrierTwin`) behind HTTPS and point one Twilio number's voice webhook at `POST /twin/entry`. Set `twilioAuthToken` and `publicBaseUrl` so signatures are enforced, and a long random control token.
2. Set `STAGE2_TWIN_NUMBER` to that number (E.164) and give Vapi a dial-out number and key.
3. For each scenario: `POST /twin/arm`, capture the product payload by running `initiateCall` under the outbound interceptor, `retarget()` it, send with `placeAndWait()`, then read `/twin/events` and score.
4. Set a spend cap first. `planRun` and `authorizeLive` refuse to proceed without one.

The sandbox this was built in has no Twilio or Vapi keys, so steps 1 to 3 have not been run against the real services.
