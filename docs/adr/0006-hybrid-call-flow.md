# ADR 0006: One audio stream for the hybrid call flow

**Status:** Direction accepted 2026-10-21: option B, staff ending first, subject to the bake-off as the go or no-go. No code until the bake-off passes.
**Date:** 2026-10-18 (decisions recorded 2026-10-21)
**Decides:** where the call audio lives, so hold and pickup can be detected cheaply, the scribe never stops listening, and staff or the agent can join the same call.

## Context

Stage B added the call state machine and segment timing behind `HYBRID_CALL_FLOW`. It records phase changes, but menu and hold boundaries are not observed live today: the only live signals are the staff handoff request and the end-of-call report. The founder has decided that live menu and hold timing ships in the first release (2026-10-18), which pulls the Epic 2 hold listener into the first release.

Product rules this ADR must serve (backlog 2026-10-18):

1. Hold Sentinel and the Claims Scribe run on every call, as a cheap base layer.
2. Hold detection listens for hold phrases, hold music and human pickup. It should not need an AI model on the line.
3. When a rep answers, staff join (Hold Sentinel alone) or the agent speaks (full autonomous, graduated carriers only, ADR 0005). The ending is the only difference.
4. Staff join by conference, never by blind transfer, so the scribe keeps listening and the carrier leg is never dropped by a failed transfer.

Today the whole call runs inside Vapi. Hold_Sentinel and IVR_Navigator are AI agents (estimated about $0.09 and $0.13 per minute in `UNIT_ECONOMICS`; these are repo estimates, not measured). Staff reach the rep by Vapi live control `transfer` (Stage A), after which Vapi is no longer the party in the middle.

## Facts this ADR rests on

Verified against vendor pages on 2026-10-18 unless marked.

| Fact | Source |
|---|---|
| Vapi hosting is $0.05 per minute on the pay-as-you-go package, before telephony, speech and model costs. Concurrency is 4 calls on that package, 10 on Core ($29 per month), 30 on Pro. | vapi.ai/pricing |
| Telephony via Twilio is billed by Twilio: $0.014 per minute outbound, $0.008 inbound. | vapi.ai/pricing |
| Vapi warm transfer modes (message, summary, TwiML, wait for operator) are supported only on Twilio calls. They dial the destination, deliver context, then connect the customer. The docs do not describe a conference. | docs.vapi.ai/tools/transfer-call/warm-transfer |
| "Warm Transfer - Experimental" puts the customer on hold while a transfer assistant calls the destination. The docs do not say whether the original assistant stays, and do not describe a conference. | docs.vapi.ai/calls/assistant-based-warm-transfer |
| Vapi live call control gives a `listenUrl` (WebSocket, binary PCM frames, sample rate not documented) and a `controlUrl` (`say`, `add-message`, `control` mute, `end-call`, `transfer`, `handoff`). | docs.vapi.ai/calls/call-features |
| Vapi orchestration runs in the US, or the EU with the Premier package only. Raw audio is not stored; transcripts and logs are, unless custom storage is used. | docs.vapi.ai/security-and-privacy/data-flow |
| Twilio outbound to the US and Canada is $0.0140 per minute (local and toll free). Conference participants start at $0.0018 per participant per minute. Media Streams are $0.0044 per minute. Recording is $0.0025 per minute. | twilio.com/voice/pricing |
| Twilio conferences support adding a participant by API, `Muted`, `Hold`, and `Coaching` (only the coached party hears the coach). Up to 250 participants. Adding participants is limited to 1 call per second by default. The recording mix region list has no Canadian option (us1, us2, ie1, de1, sg1, br1, au1, jp1). | twilio.com/docs/voice/api/conference-participant |
| A Twilio conference can include a TwiML App participant (`To=app:<APP_SID>`) whose TwiML is `<Connect><Stream>`, giving a bidirectional WebSocket to our server. | Twilio support article 45314613523867 |
| `<Start><Stream>` is unidirectional and the call carries on; `<Connect><Stream>` is bidirectional and blocks later TwiML. Unidirectional tracks: inbound, outbound or both. | twilio.com/docs/voice/twiml/stream |
| Deepgram Nova-3 streaming is $0.0048 per minute (promotional) and $0.0077 regular. No minimums. | deepgram.com/pricing |
| Telnyx conference is $0.002 per participant per minute and media streaming is $0.0035 per minute. Canada voice rates were not published on the pages read. | telnyx.com/pricing/voice-api |

Not verified, and treated as bake-off questions below: whether a Twilio `<Stream>` can be attached to a conference leg directly, whether the TwiML App participant leg is billed as a call leg, Twilio's Canada-specific rate (the pricing page labels one row "United States and Canada"), whether Vapi bills full hosting during minutes where its model is not called, whether Vapi accepts a SIP call from a Twilio conference with per-call assistant overrides and metadata, and whether Vapi's scribe hears audio after a `transfer`.

## Options

### A. Stay in Vapi, strip the model during hold, tap `listenUrl`

Vapi keeps the call end to end. Hold_Sentinel runs without an LLM turn; our service connects to `listenUrl`, detects hold and pickup, and uses `controlUrl` to act. Staff join by `transfer` or an experimental warm transfer.

- Smallest change to current code (Stage A already uses `controlUrl`).
- Vapi hosting at $0.05 per minute very likely applies to every hold minute even with no model turns. The pricing page does not define what hosting covers, so this is unverified and is a bake-off question.
- Staff join is a transfer, not a conference. The scribe and our tap are on the Vapi leg; what they hear after the carrier is bridged to staff is unverified.
- Concurrency is capped by the Vapi package, and hold is long, so slots are the bottleneck.
- `listenUrl` carries PCM with no documented sample rate; the format must be confirmed.

### B. Own the call on Twilio, put the carrier leg in a conference, use Vapi only for the agent segment

CollectRx dials the carrier from its own Twilio number into a conference. A listener (TwiML App participant with a bidirectional stream, or a stream on the carrier leg) feeds streaming speech recognition and a music and silence detector. No Vapi minutes are used during menu and hold. Scripted keypresses navigate menus from carrier configs, with Vapi or an LLM as fallback only when the menu has drifted. At pickup:

- Staff ending: alert the desk, add the accepting staff member as a participant (browser client or phone). The listener stays as a muted participant, so the scribe keeps listening.
- Agent ending: add a Vapi call as a participant by SIP, with assistant and call metadata set per call. Vapi bills only the agent segment. The listener stays.

This is the only option where menu, hold, pickup, staff join and agent join all share one audio path that we control.

### B-lite. As B, but no conference during hold

A unidirectional `<Start><Stream>` on the carrier leg during menu and hold. At pickup, redirect the live call into a conference and add staff or Vapi. Saves roughly two participant-minutes of conference charge per hold minute. Risk: a mid-call redirect can cause an audible gap or a dropped leg, and it is unverified that the stream survives the redirect. Test it in the bake-off; adopt only if the gap is inaudible and the stream survives.

### C. Vapi warm transfer to staff, keep everything else in Vapi

Use the Twilio-only warm transfer modes so staff hear context before the carrier is connected. Cheapest to build, but the cost per hold minute is the same as A, the transfer drops Vapi out of the middle, and nothing here removes the scribe problem. Staff would still have to answer a phone, not click an in-app accept. Rejected for the hybrid flow; still useful as a fallback for practices with no desktop app.

### D. Telnyx in place of Twilio for B

Telnyx lists a slightly dearer conference ($0.002 against $0.0018 per participant minute) and cheaper streaming ($0.0035 against $0.0044), but Canada outbound rates were not published on the pages read, Vapi's own warm transfer modes need Twilio, and the repo and Stage A tooling assume Twilio. Revisit only if the bake-off shows Twilio telephony cost dominates. Not recommended for the first release.

### E. Self-hosted media server (for example SIP trunk to a self-run bridge)

Lowest unit cost at scale and full control of residency, but it moves reliability, security patching and carrier interop onto a one-founder team. Out of scope for the first release.

## Cost per hold minute

Assumptions: Twilio outbound $0.014, conference participant $0.0018, Media Streams $0.0044, Deepgram streaming $0.0048 to $0.0077, Vapi hosting $0.05. B counts two participants (carrier leg and the listener). All figures are list prices in USD and exclude recording ($0.0025 if enabled), phone number rental and the agent segment.

| Option | Per hold minute | 20 min hold | 30 min hold |
|---|---|---|---|
| Today (Hold_Sentinel as an AI agent, repo estimate) | about $0.09 | $1.80 | $2.70 |
| A. Vapi, model stripped | $0.069 to $0.072 | $1.38 to $1.43 | $2.06 to $2.15 |
| B. Own Twilio with conference and listener | $0.027 to $0.030 | $0.54 to $0.59 | $0.80 to $0.89 |
| B-lite. Own Twilio, conference at pickup | $0.023 to $0.026 | $0.46 to $0.52 | $0.70 to $0.78 |

B is about 60 percent cheaper than A per hold minute at list price, because A pays Vapi hosting on every minute. Currency is USD; the plan price is CAD, so convert before putting this in a margin model. The agent segment costs the same in every option (Vapi hosting, speech, model, voice) except B adds the SIP leg into Vapi, whose rate is not yet known.

## Pickup detection delay

Pickup is the moment a human carrier rep starts speaking after hold. Delay is measured from the first speech sample of the rep to the desk alert (or the agent's first word).

| Option | What sets the delay | Expected |
|---|---|---|
| A | `listenUrl` frames plus streaming recognition plus our logic, then `controlUrl` round trip | Not measured. Unknown framing and buffering on `listenUrl` |
| B | Twilio stream frames (20 ms mulaw) plus streaming recognition plus our logic, then a participant add (1 per second API default) | Not measured. Participant add must not be the slow step |

No delay figure is claimed in this ADR. The bake-off measures it. The founder set the target on 2026-10-21: the desk alert within 2 seconds of rep speech onset, met on 95 percent of bake-off pickups. See "Pickup timing and the rep's wait" for the trade-off this creates with false pickups.

False pickups are the larger risk than delay. Hold audio contains speech ("your call is important to us", position in queue). The detector must separate recorded announcements from a live rep: phrase list per carrier, music and silence transitions, prompt cadence, and a second check (rep speech that does not match a known recorded phrase). A false pickup pings staff for nothing; a missed pickup loses the rep and the hold.

## How staff join

Conference, not blind transfer.

- The carrier leg sits in a conference from the start (B) or from pickup (B-lite).
- The desk alert has an accept button. On accept the server adds the staff member as a participant: a browser or desktop client leg (Twilio Voice SDK, to be confirmed) or the staff phone as a fallback.
- The listener and the scribe remain as muted participants. Staff can leave and rejoin without ending the carrier leg; ending the conference when staff hang up must be an explicit choice, not the default `endConferenceOnExit` behavior.
- If nobody accepts inside the window, the existing standing rule applies (ADR 0003): the agent captures a reference number with the fixed disclosure, the call ends politely, the claim is requeued and a "missed: staff busy" event is logged.
- Under A the equivalent is `transfer`, which removes Vapi from the middle and leaves the scribe's post-transfer audio unverified.

## How the scribe keeps listening

The scribe is a consumer of the single audio stream, not a participant in the conversation. Under B, the listener's transcript feeds the scribe through every phase: menu, hold, staff conversation, agent conversation, wrap-up. This removes the current rule that Claims_Scribe runs only in human-assisted mode (backlog Epic 3) and lets graduation counts (ADR 0005) include both endings. Under A the scribe depends on what Vapi still hears after a transfer, which is the unverified item above.

## Dashboard and configuration changes

Written as a checklist for Khalid. Nothing here has been changed.

| Where | Change if B is chosen |
|---|---|
| Twilio console | A TwiML App for the listener participant; a voice webhook and status callback on the dial number; a SIP domain or credential list that lets the conference reach Vapi; enable the geo permission for Canada; confirm the account's outbound CPS and raise it with a Business Profile if needed. |
| Vapi dashboard | Keep the agent assistants (Claims_Agent, Escalation_Closer, Resolution_Closer). Remove IVR_Navigator and Hold_Sentinel from the squads on the hybrid path. Add a SIP phone number for inbound agent legs. Set the concurrency package for agent minutes only. |
| Server | New `HYBRID_CALL_FLOW` sub-flags (listener, conference, agent leg); a WebSocket endpoint for streams that validates Twilio's signature and a per-call token; carrier menu scripts moved into carrier configs. |
| Desk (front desk) | Rep-on-the-line alert, accept button, availability status, missed-call report (Epic 4). |
| Stripe and Fly.io | None for the first release. Fly.io needs a WebSocket-capable route and enough memory for concurrent streams, to be sized from the bake-off. |

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Data residency and PHIPA | Twilio's recording mix regions have no Canadian option; Vapi runs in the US, or the EU on Premier. Audio during hold carries no patient data, but IVR keypress entry of member IDs and the staff or agent conversation do. | Counsel review before any live practice. Send keypresses by server-side DTMF and never log digits. Do not record by default. Document the US processing in the privacy notice. This risk exists today under Vapi and Twilio; B does not widen it, but it does add our own stream endpoint to the PHI boundary. |
| Recording and disclosure | A conference with a listener that transcribes is a recording for disclosure purposes. | Keep the canonical CRTC disclosure at agent speech and in the practice terms; legal review of the scribe running during staff calls. |
| Mid-call audio gap (B-lite) | A redirect could be heard by the rep. | Bake-off gate; fall back to B. |
| Participant add latency and rate | One participant add per second by default. | Pre-warm the conference and the Vapi SIP leg at pickup start; request a higher CPS. |
| SIP into Vapi unverified | Per-call assistant overrides, metadata and call control over a conference-bridged SIP leg are not confirmed. | First bake-off test; if it fails, the agent ending stays on the current Vapi path and only the staff ending moves to B. |
| Carrier detection (CARRIER_BLOCK) | Any change in how the call is placed (new caller ID, different audio path) could change how carriers treat it. | No real carrier calls until approved. Pilot on one carrier through the same numbers already in use. |
| Operating burden | B puts a media path in our hands. | Keep it thin: Twilio carries the audio, we run a stream consumer and a decision loop. Not option E. |
| Concurrency | Vapi caps concurrent calls; hold is long. | B removes hold from Vapi, so Vapi slots serve only agent segments. |

## Recommendation

Adopt **B** for the first release, with **B-lite** as a bake-off variant and **A** as the fallback.

1. B is the only option that delivers live menu, hold and pickup timing on a path we control, keeps the scribe listening through both endings, and lets staff join by conference.
2. B is about 60 percent cheaper per hold minute than A at list price (about $0.03 against $0.07), and the absolute gap grows with hold length.
3. Staged delivery: move the staff ending to B first, because it needs no agent leg and autonomous calling is off by default (ADR 0005). Keep the agent ending on the current Vapi path until the SIP-into-Vapi test passes, then move it.
4. If the bake-off fails on pickup delay, false pickups or the SIP test, fall back to A, which still gives live timing through `listenUrl`.

Founder decisions taken 2026-10-21: B approved as the direction (staff ending first, subject to the bake-off), 2 second alert target, and the agent ending stays on the Vapi path for the first release.

## Bake-off test plan

No real carrier is called at any point. Inputs are recorded and synthetic audio played from our own Twilio numbers or injected directly into the listener.

**Corpus** (synthetic, no patient data, no real carrier audio):

- 100 scripted calls across four carrier styles, each with a menu, 3 to 30 minutes of hold with announcements and music, and a pickup by a scripted human voice at a known second. Voices and accents vary.
- 200 hold announcements written to sound like a person ("thank you for holding, this is Sam", queue position updates, callback offers).
- 100 hours of replayed hold audio with no pickup, run through the detector faster than real time; 10 of those hours also run in real time through the Twilio path.
- Hard cases in the 100 calls: long silence, music with speech overlay, a rep who speaks over the music, a menu that changed, a rep who says only "hello".

**What is measured, per option (A, B, B-lite):**

| Metric | How | Pass for B |
|---|---|---|
| Cost per hold minute | Vendor usage records for a 30 minute call, divided by hold minutes | At or below $0.035 |
| Pickup detection delay | Timestamp of scripted rep onset against desk alert (or agent first word) | 95 percent within 2 seconds, on at least 100 scripted pickups |
| False pickups (pass or fail) | Alerts with no rep speaking, per 100 hold hours of replayed audio; and on 200 recorded announcements that sound like a person | At most 1 per 100 hold hours, and at most 2 percent of the 200 announcements |
| Missed pickups (pass or fail) | Rep speech with no alert, across 100 scripted pickups | 0 of 100 (a clean 0 of 100 only bounds the true miss rate below about 3 percent at 95 percent confidence) |
| Rep wait for staff | Pickup to staff audible, when staff accept at the earliest and at the limit | Within the rep-wait limit on 95 percent of runs |
| Menu navigation | Scripted keypresses reach the hold queue without the model | 4 of 4 carrier styles; drift falls back correctly |
| Staff join | Accept to audible on the call | Under 3 seconds; carrier hears no gap |
| Scribe continuity | Transcript has no gap across join, leave and rejoin | No gap over 1 second |
| Agent join (B only) | SIP leg answered by Vapi with correct assistant and metadata | Works, with call control intact |
| Concurrency | 20 simultaneous synthetic calls | No dropped streams |

**Steps for Khalid by hand:** see `docs/operations/ADR-0006-BAKEOFF-SETUP-CHECKLIST.md`. Khalid runs it; nothing in Twilio or Vapi has been changed by Claude.

**Go or no-go:** B proceeds only if every pass or fail row above passes and the four unverified items resolve favorably (SIP from a Twilio conference into Vapi with per-call settings and control; a stream on a conference leg; Vapi billing for model-idle minutes, which only affects option A; whether the scribe hears after a transfer, which only affects option A). If B fails, stop and return with option A.

**Exit:** a written comparison with the measured table, and the chosen option recorded in the change log below.

## Pickup timing and the rep's wait

**Detection budget.** Two seconds from rep speech onset to desk alert is tight against false pickups: separating a live rep from a recorded announcement usually needs more than a word or two of audio. Two designs to test, in this order:

1. **Single alert at 2 seconds** from a classifier that decides on the first 2 seconds of post-hold speech.
2. **Two-stage alert:** a tentative "possible rep" cue at 2 seconds (staff get ready, nothing is claimed), then a confirmed alert once the classifier is sure. Meets the 2 second target for the cue while protecting the false-pickup threshold.

The bake-off plots the delay-versus-false-pickup curve for both and reports which meets both thresholds.

**Rep-wait limit.** This is how long a live rep waits, after speaking, for staff to be audible before the missed-call path runs (standing rule, ADR 0003: the agent gets a reference number, the call ends politely, the claim is requeued, "missed: staff busy" is logged). No evidence exists yet for how long Canadian carrier reps will wait, so these are proposals to be tested with scripted reps only.

| Limit | Effect | Trade-off |
|---|---|---|
| 20 seconds | Fewer rep hang-ups; more missed calls and requeues | Staff must be at the desk |
| 30 seconds (recommended default) | Time for one accept click and a join; tolerable pause on a real call | Needs per-practice override and measurement from the first live pilot |
| 45 seconds | Fewer missed calls | A long silent wait is the likeliest trigger for a rep to hang up or suspect automation |

Make the limit a per-practice setting with 30 seconds as the default, and record every missed call with the wait it reached.

**What the rep hears while waiting.** Options only; none is built. Choosing is the founder's decision.

| Option | What it is | Cost and risk |
|---|---|---|
| 1. Silence | Nothing is played | Simplest and keeps the rule that the AI never speaks to a rep. Reps may think the line dropped. |
| 2. Fixed line | A short pre-recorded line, for example "One moment please, connecting you to the practice" | A second exception to the rule that the AI never speaks to the rep (the first is the missed-handoff script). Any automated speech to the rep probably brings the CRTC disclosure with it, which a connecting line is too short to carry; counsel must say whether the line needs it. Also raises automation visibility (CARRIER_BLOCK). |
| 3. Neutral hold audio | Brief non-speech hold music or a soft tone played to the rep | No speech, so no new exception and no disclosure question on its face (counsel to confirm). Matches what reps already hear when they put a caller on hold. Cost: a held conference participant is expected to be cut out of the mix, so the scribe would likely hear a gap of up to the limit (to be confirmed in the bake-off). |

Recommendation for the founder to decide: option 1 for the bake-off baseline, option 3 as the variant to test, option 2 not built unless counsel clears the disclosure question. Not built either way until the founder chooses.

## Agent ending: structured outcome and graduation

Confirmed in code on 2026-10-21:

- Graduation counts (`loadCarrierGraduationStats`) read `HumanAssistedCallLog` rows by carrier and window only. They do not look at who handled the call.
- A row is written whenever any assistant calls `log_call_outcome` (`handleLogCallOutcome` in `src/webhooks/vapi.ts`), keyed by `vapiCallId`. So an agent call counts toward graduation only if the agent assistants have that tool in the Vapi dashboard, which is not verified from the repo.
- The autonomous squad's own outcome pipeline writes `call_attempts` outcome and carrier lessons, not `HumanAssistedCallLog` (the source comment says this is deliberate).

Consequences and the plan, not built:

1. Add a nullable ending column to `HumanAssistedCallLog` (staff or agent), filled from the call attempt's `callEnding`, so both endings log in one place and can be told apart.
2. Graduation entry thresholds must count staff-ending rows only. Counting the agent's own calls would let a carrier's agent evidence graduate itself.
3. Count agent-ending rows separately as post-graduation monitoring (suspicion rate, unresolved rate), with a path to suspend a carrier.
4. Dashboard step for Khalid: confirm Claims_Agent, Escalation_Closer and Resolution_Closer each have the `log_call_outcome` tool and the same schema, including `staff_unavailable`.

## Open items

| Item | State |
|---|---|
| Data residency and PHIPA | Gate before the first live practice. Twilio has no Canadian recording region and Vapi runs in the US (EU on Premier). Counsel review required. No action now. |
| Rep audio during the staff wait | Founder decision pending: options 1 to 3 above. |
| Rep-wait limit | Proposed 30 seconds, per practice; to be validated in the pilot. |
| Agent ending outcome logging | Design above; Vapi dashboard tool check needed. |
| Recording and disclosure | Counsel to confirm the scribe transcribing staff calls and any speech played to the rep. |
| Twilio Canada rate, SIP into Vapi, stream on a conference leg | Bake-off questions. |

## Consequences

- With the flag off, nothing changes.
- Stage B's schema, state machine and medians already accept these signals; the listener becomes the first live source for menu and hold boundaries.
- Stage D (Epic 2) is scoped by this ADR but not started. No code is written until the founder approves.

## Change log

| Date | Change |
|---|---|
| 2026-10-18 | Proposed |
| 2026-10-21 | Founder: B approved as the direction with staff ending first, subject to the bake-off. Pickup alert target set to 2 seconds. False and missed pickups made pass or fail. Agent ending stays on the Vapi path for the first release. Residency recorded as a gate before the first live practice. |
