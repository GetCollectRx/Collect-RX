# Bake-off setup checklist (ADR 0006)

Audience: Khalid. Claude changed nothing in Twilio, Vapi, Stripe or Fly.io. Every "create" or "set" below is for you to do. Console labels may differ from these names; where a step depends on a field name I have not read from the vendor page, it says so.

Purpose: measure options A, B and B-lite from ADR 0006 and decide go or no-go for option B. No real carrier is called at any point.

## 0. Rules for the whole bake-off

| Rule | Detail |
|---|---|
| No real carriers | Every dialed number is a number you own. Do not dial a carrier line, even once. |
| No PHI | Recordings and scripts use invented names, invented member numbers and invented claim details only. |
| No secrets in chat | Do not paste Twilio Auth Tokens, API keys or Vapi keys into any chat or commit. Put them only in the staging environment. SIDs and phone numbers are fine to share. |
| Isolated accounts | Use a Twilio subaccount and, if your Vapi plan allows, a separate Vapi organization, so production numbers, squads and keys are untouched. |
| Cost cap | Set a Twilio usage trigger before the first call (step 2.6). |

## 1. Decision needed before this checklist can be completed

The bake-off cannot measure anything without a throwaway test harness: a small listener that receives the audio stream, a detector, and a script that places the simulated calls and records timestamps. You said Stage D build stays on hold until the bake-off passes, so I will not write any harness code without your explicit approval. Tell me if you approve a throwaway harness in a separate `bakeoff/` folder that production code never imports. Without it, this checklist can be run only as far as step 3.

## 2. Twilio (subaccount `collectrx-bakeoff`)

| Step | Action | Done when |
|---|---|---|
| 2.1 | Create a subaccount named `collectrx-bakeoff`. Use its SID and Auth Token only in staging. | Subaccount visible in the console |
| 2.2 | Enable the Canada geo permission for voice on the subaccount (Voice, Geo permissions) | Canada calls allowed |
| 2.3 | Buy 2 Canadian local numbers on the subaccount: one **dialer** number (calls out), one **simulator** number (answers like a carrier) | Both numbers listed |
| 2.4 | Simulator number voice webhook: a TwiML Bin that plays a corpus recording, then hangs up. Use one bin per scripted call, or a small function that picks the recording by called number or a query value. | A test call to the simulator plays the recording |
| 2.5 | Create a TwiML App named `bakeoff-listener`. Its Voice URL points to the staging server's listener route and returns `<Connect><Stream>` with a `wss` URL (no query string; use custom `<Parameter>` values). The staging route does not exist yet and arrives with the harness. | TwiML App SID recorded |
| 2.6 | Add a usage trigger on the subaccount: alert at US$50 and at US$100 of total spend | Trigger visible |
| 2.7 | Confirm the account's outbound calls-per-second limit (Twilio's default for adding conference participants is 1 per second); note the value | Value recorded |
| 2.8 | Create a SIP domain on the subaccount for the Vapi leg test (option B agent join): one credential list, voice URL left empty | SIP domain URI recorded |

Twilio facts this relies on: participant add API and 1 per second default, conference TwiML App participant with `<Connect><Stream>`, `<Start><Stream>` and `<Connect><Stream>` behavior (ADR 0006 sources).

## 3. Vapi (separate org if available)

| Step | Action | Done when |
|---|---|---|
| 3.1 | Create a test assistant that is a copy of Claims_Agent with no production tools, no real webhook URL (point it at a request bin or the staging server), and a prompt that contains no real practice or patient data | Test assistant ID recorded |
| 3.2 | Create a Vapi SIP phone number for inbound agent legs, per Vapi's SIP docs (docs.vapi.ai/advanced/sip). I have not read the exact field names; confirm them on that page. Record the SIP URI. | SIP URI recorded |
| 3.3 | Confirm what your Vapi package's concurrency limit is (the public pay-as-you-go limit is 4 calls) | Number recorded |
| 3.4 | For option A only: a test Twilio number imported into Vapi, with `monitorPlan.controlEnabled` on the test assistant | `listenUrl` and `controlUrl` present on a test call |
| 3.5 | Give the test assistant the `log_call_outcome` tool with the same schema as production, including the `staff_unavailable` scenario | Tool visible on the assistant |

## 4. Recordings and audio needed

All synthetic. No audio from any real carrier or real call.

| Set | Count | Contents |
|---|---|---|
| Scripted calls | 100 | Menu prompt, 3 to 30 minutes of hold with announcements and music, one pickup by a scripted human at a known second. Four carrier-style menus (25 each). Vary voices and accents. |
| Hard cases inside the 100 | 20 | Long silence; music with speech overlay; a rep who speaks over music; a menu that changed; a rep who says only "hello" |
| Human-sounding announcements | 200 | Short recordings of the kind "thank you for holding, this is Sam", queue position updates, callback offers. Written as announcements, not as people. |
| Hold-only replay | 100 hours | Hold audio with no pickup, for offline false-pickup testing. Looped royalty-free or self-generated music with announcements at random intervals. |
| Ground truth file | 1 | For every call: the second of pickup (or none), the second of each announcement |

How to produce: text-to-speech voices for speech, royalty-free or self-composed music (record the licence), and a script that stitches them and writes the ground truth file. I can write that stitching script once you approve the harness (section 1).

## 5. Measurements to capture per run

Time of rep onset (ground truth), time of desk alert, time staff audible after accept, any audio gap length on the carrier leg at staff join, transcript gaps across join and rejoin, vendor usage records for each call, and the cost per hold minute computed from those records.

## 6. Cost estimate

Estimates only, at list price (ADR 0006): about US$0.03 per hold minute on option B. 1,000 scripted minutes is about US$30. 10 real-time hours of replay is about US$18. Agent-leg tests and Vapi minutes are extra and not yet priced. Suggested ceiling: US$100 for the whole bake-off, enforced by the step 2.6 triggers.

## 7. Stop conditions and cleanup

| Condition | Action |
|---|---|
| Spend reaches the ceiling | Stop, release nothing, report |
| Any real carrier number is dialed by mistake | Stop all calls, tell Claude, log the event |
| Any PHI-like data appears in a recording or log | Stop, delete it, report |
| Bake-off ends | Release the two numbers, delete the subaccount's TwiML App and SIP domain, delete test Vapi assistant and numbers, revoke the subaccount token |

## 8. What to send back

Twilio subaccount SID, dialer and simulator numbers, TwiML App SID, SIP domain URI, Vapi test assistant ID, Vapi SIP URI, Vapi concurrency limit, and the outbound CPS value. No tokens or keys.
