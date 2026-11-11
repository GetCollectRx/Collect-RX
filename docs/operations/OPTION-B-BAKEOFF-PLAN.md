# Option A versus Option B bake-off: plan

Status: PLAN for Khalid's approval. Written 2026-11-11. No call placed, nothing spent, nothing deployed.

Source: the PRD "Hybrid Call Flow and Expansion", sections "Architecture decisions and bake-off" and the pass thresholds in it. Thresholds are starting figures set before live data.

## Question the bake-off answers

Can one audio stream stay up for the whole call, with a cheap hold listener and an always-on scribe, with staff joining as conference participants (Option B), or must the build stay on Vapi squads with a model stripped during hold (Option A)?

## Rules (from the PRD)

Throwaway harness on its own branch, spend cap, synthetic data only, teardown at the end, secret scan before any push, no calls to real carriers.

## Key cost finding

The PRD asks for at most 1 false pickup per 100 hold hours. At the PRD's own listener cost ($0.0261 USD per minute) 100 hold hours is about 6,000 minutes, roughly **$157 USD** if measured live. That is the wrong way to measure it.

| Measure | Cheap way |
|---|---|
| False pickups on hold audio (per 100 hold hours) | Run the detector offline on a synthetic hold-audio corpus (music loops, hold announcements, queue messages). No telephony cost. |
| False pickups on human-sounding announcements (at most 2% of 200) | Same, offline, with synthetic announcement clips. |
| Detection latency and missed pickups (95% within 2 seconds, 0 of 100 missed) | Offline on scripted pickup clips first. Live only for the telephony-path latency. |
| Rep wait within limit | Needs the live path, using our own twin as the far end. |
| Option B cost per hold minute at or under $0.035 | Read from the vendors' bills after a small live run, not from estimates. |

## The four unknowns, each as a small live test

| Unknown | Test | Pass signal | Rough spend (estimate) |
|---|---|---|---|
| SIP from a Twilio conference into Vapi | One conference with a Vapi assistant dialled in over SIP | Assistant hears and speaks in the conference | under $1 |
| Streaming media on a conference leg | Media Stream attached to one participant leg | Audio frames arrive at the listener with the leg's audio only | under $1 |
| Vapi billing while the model is idle | Park an assistant for 10 minutes, read the invoice line | Idle minutes billed at telephony rate, not model rate, or the opposite | about $2 |
| Scribe audio after a transfer | Transfer a call and check whether the transcript continues | Transcript continues past the transfer | under $1, and a Vapi dashboard check |

Estimated total for the live part: about $5 to $10 (an estimate, not a measurement). I will not place any call until Khalid sets the cap.

## Phases

1. Offline: build the audio corpus and a detector evaluation harness. No spend. Reuses the scoring ideas in the Stage 2 twin.
2. Live unknowns: the four tests above, behind the spend cap.
3. Live path: twin as the far end, 20 scripted pickups, measure latency and rep wait.
4. Report: the PRD thresholds against results, with every unmeasured row marked UNVERIFIED.

## Needs from Khalid

| Item | Why |
|---|---|
| A spend cap for the live part | Standing rule: no live calls without a cap he sets. |
| A Twilio credential for a throwaway number | The earlier API key is slated for revocation. Provided through the credential form, never pasted in chat. |
| The Vapi dashboard checks (warm or blind transfer, scribe after transfer) | Unknown 4 and Stage A. |
| Approval to place the live calls | Each live call is real spend. |

## Parallel Vapi squad build

Both tracks run. Squad work continues under the PRD epics (alert flow, call windows, metering in calls, practice proof). Anything that depends on the stream design (Epics 2 and 3) is built behind an interface so either option can plug in.
