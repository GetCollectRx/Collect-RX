# Pre-call logic gate

Written 2026-11-12 at Khalid's direction: no call is placed, even a test call to him, until the software's logic is sound. The questions I keep asking are the evidence that gaps remain. This file lists them and says how each is closed.

## Principle

A live call proves very little that a contained test cannot, and it costs money and touches real carriers. Everything that can be proven offline is proven offline first. What only a call can show is listed last and tested once, under a spend cap, to numbers Khalid supplies.

## Known gaps

| # | Gap | Evidence | Close it by |
|---|---|---|---|
| 1 | What happens to the claim after a missed handoff is untraced: is it requeued, does it use one of the 3 attempts, can repeated misses hit the attempt limit and flood escalations? | Handler returns the reference-number script and logs; no code path read that changes the queue | Trace in code, then a contained test of three consecutive misses |
| 2 | Handoff edge cases are untested: the tool firing twice, firing after the call ended, firing with no active attempt, the rep hanging up before the transfer | `handleStaffHandoffRequest` has no idempotency guard | Add the guard, test each case against the fake Vapi |
| 3 | Capacity counts people, but transfers go to one escalation number. Two ready people and one phone line means a second simultaneous transfer rings a busy line | `readyStaffCount` against a single `escalationPhoneNumber` | Cap in-flight handoffs at the number of distinct transfer lines, or add a number per person |
| 4 | Three overlapping gates (practice staff hours, per-person presence, the PRD call windows) have no defined interplay | Staff-hours and presence both exist; windows do not | Write one precedence rule, test the combinations |
| 5 | The 5 minute rule is undefined for V1 (see DECISIONS section 2) | Interpretation unconfirmed | Khalid confirms, then build pre-dial confirmation |
| 6 | Overload protections are proposals only: breaker, budget, spaced retries, callback line | DECISIONS section 2 | Build, with contained tests |
| 7 | The rep-on-the-line banner exists only while a browser tab is open. With no tab open, the phone ring is the only signal and nothing escalates | No acknowledge, snooze or escalation (brief gaps 1 and 7) | Build the `desk_alerts` lifecycle |
| 8 | A silent ingest: nothing alerts when no report has been uploaded for days | No stale-upload sweep | Add the sweep and alert |
| 9 | Only Ontario holidays are modelled | `callCalendar.ts` header | Decide scope, or model provincial holidays |
| 10 | Metering is in minutes at an estimated $0.135 per minute, not calls at measured cost | `usagePeriodService.ts`, `tiers.ts` | PRD Epic 6 |
| 11 | Stage 1 simulation still has 14 failing checks, including live refusal detection not triggering the carrier block, and hold time not persisted | Stage 1 report | Fix or consciously defer each, then rerun |
| 12 | Carrier block scope is a product choice that was never made (practice plus organization siblings only) | `checkCarrierBlock` | Khalid decides |
| 13 | The hold detector is not shown to work: it fires on any hold music, and no free detector separates a recording from a person | `bakeoff/RESULTS-*.md` | Pilot shadow mode; not closable offline |
| 14 | The autonomous ending is unchanged and unproven | PRD Epics 1 to 3 | Out of scope for V1 |

## What only a call can show

These are third-party behaviours. They are tested last, once, under a cap.

| Behaviour | Why a test cannot show it |
|---|---|
| Whether the live-call `transfer` command is a blind transfer | Vapi's behaviour, not configuration |
| Whether Claims_Scribe keeps hearing after the transfer | Vapi support reportedly says transcription stops; the learning loop depends on it |
| Whether the control-URL transfer succeeds | The success path cannot be emulated in containment (`assertVapiControlUrl`) |
| What a real carrier's hold audio looks like | No recording is allowed or planned; learned from pilot calls in shadow mode |

## Exit criteria for the first live test call

1. Gaps 1 to 4 closed with contained tests passing.
2. Khalid has confirmed gap 5 and chosen which of gap 6 to build first.
3. The full gate passes and CI is green on the commit that will run.
4. Khalid sets a spend cap and names the two phone numbers.
5. The call goes from the product's number to Khalid's own phones only. No carrier is called.
