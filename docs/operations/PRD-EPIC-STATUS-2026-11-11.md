# PRD epic status: build versus "Hybrid Call Flow and Expansion" (Oct 28, 2026)

Date: 2026-11-11. Branch: `claude/upbeat-allen-i7a0te`.

This replaces the framing of `PRODUCT-STATUS-2026-11-11.md`, which audited the app as a dental product. The PRD is the source of truth. Each row below is read from the code, not run, unless it says "tested".

## Bottom line

| Fact | Evidence |
|---|---|
| Zero live calls have completed end to end. | PRD status line; the two twin calls placed stopped at the provider ID prompt. |
| The shipped design is the PRD's Option A (Vapi squads). Option B (own Twilio line, Media Streams, conference join) is not built. | `src/vapi/client.ts` squad dispatch; no conference-join code outside a hold-park engineering test. |
| The bake-off that decides A or B has not run. | PRD "Unknowns to test"; nothing in the repo. |
| Of 7 epics, none is complete. Epic 5 and Epic 7 do not exist. | Table below. |

## Stage A (precedes Epic 1)

| Item | Status | Evidence |
|---|---|---|
| Transfer uses Vapi's documented control URL | Built, not proven live | `transferVapiCall` in `src/vapi/client.ts` reads `controlUrl` from the live call and posts a `transfer` command. The success path cannot be emulated in containment, so it is UNVERIFIED. |
| Live Console takeover targets the call staff selected, scoped to the practice | **Not fixed** | `POST /:practiceId/active/takeover` in `src/server/routes/frontDeskApi.ts` still uses `callAttempt.findFirst({ completedAt: null, claim: { practiceId } })`, the first active call. |
| Vapi dashboard checklist (warm or blind transfer; scribe stays on after transfer) | Not done | Needs Khalid in the Vapi dashboard. |

## Epics

| Epic | PRD requirement | Status | Evidence and gap |
|---|---|---|---|
| 1. One call pipeline | State machine dialing, menu, hold, rep answered, staff or agent, wrap-up; ending chosen by plan plus carrier graduation; segment timing; per-carrier medians | **Partly** | `src/services/arEngine/stateMachine.ts` defines a lifecycle with `Queue_Hold`, projected to the desk vocabulary. No evidence of per-segment timing or per-carrier medians. Ending selection is a squad choice (`getHumanAssistedSquadId`), not a plan-plus-graduation entitlement. |
| 2. Hold layer | Listener on the audio stream detects hold phrases, hold music, human pickup; scripted menu navigation; no AI model on the line during hold | **Partly, wrong design** | `src/webhooks/holdParkAudioStream.ts` is labelled "temporary, engineering test only": an energy heuristic that does not yet discriminate music from speech. The production path keeps a Hold_Sentinel assistant (a model) on the line. Scripted keypress navigation lives in the IVR_Navigator prompt, not in carrier config. |
| 3. Always-on scribe | Scribe on both endings from the same stream | **Partly, unproven** | Claims_Scribe exists in the squad, and `end-of-call-report` and `log_call_outcome` feed outcomes. Whether it hears the staff conversation after a transfer is the PRD's top risk and is untested. |
| 4. Front-desk alert flow | In-app alert with accept button; staff availability; missed-call report; call windows | **Partly (slice 1 built 2026-11-12)** | Built: per-person availability (`staff_presence`, AVAILABLE, BUSY, OFF, stale after 4 hours); the dispatch guard refuses a human-assisted dial unless ready staff exceed calls already open (`NO_STAFF_AVAILABLE`); when a rep answers and nobody is ready the agent gives the reference-number script and the audit log records `missed: no staff available` or `missed: staff busy`; availability control in the Live Console; `GET` and `PUT /api/desk/:practiceId/presence`. Not built: the in-app alert with an accept button, a transfer number per person (the transfer still goes to the one escalation number), pickup targeting and per-person call windows, the missed-call report by day and time. Behavior change: a human-assisted practice with nobody marked available no longer dials. |
| 5. Multiple claims per call | Group by carrier to a cap, per-claim outcomes | **Not started** | No match for claims-per-call logic anywhere in `src`. |
| 6. Metering and cost | Meter calls per location per month; real cost per call by segment; breaker on measured cost | **Partly, wrong unit** | `usagePeriodService.ts` and `tiers.ts` meter minutes with a $0.135 per minute estimate. The PRD wants calls, and measured cost. |
| 7. Practice proof | Hold minutes avoided, staff minutes saved, claims resolved, calls missed because staff were busy | **Not started** | No matching metrics in `src`. The existing dashboards were not verified against these definitions. |

## Cross-cutting PRD requirements

| Requirement | Status |
|---|---|
| Legal rules keyed by carrier-and-line, not "dental" | Fixed 2026-11-12. The NPI-before-dial rule is keyed by line (`src/carriers/lineRequirements.ts`): required for dental and paramedical lines, not demanded elsewhere until payer packs exist. |
| No calls to real carriers during build | Respected. My earlier question about real-carrier probes is withdrawn. |
| Carrier AI-caller terms check as a launch gate | Not started. |
| Vertical lanes on one platform | Types model 7 verticals. Only dental can be dialed. Non-dental claims are dashboard-only (`carrierId other` is skipped by the queue engine and refused by the Vapi client). |
| Claim ingest | **Not in the PRD.** CSV upload works. The AbelDent agent is the only automatic feed, is AbelDent-specific, and is untested. |

## Consequences for earlier work

| Earlier work | Effect |
|---|---|
| Twin and live runner (stage 2) | Still valid as a harness. Today it exercises Option A. Per-carrier hold and pickup scoring transfers to the bake-off, the Vapi-specific parts do not. |
| Self-test and crawl | Valid for the application layer. Journeys must be rewritten around the in-app accept flow once Epic 4 exists. |
| `PRODUCT-STATUS` Phase 1 "prove the call path on the twin" | Wait for the bake-off decision. |

## Decisions for Khalid

1. Run the Option A versus B bake-off before further call-path build, or keep building on the Vapi squads in parallel.
2. Complete the Vapi dashboard checks (warm or blind transfer; scribe after transfer). Nothing else in Epic 3 can be judged before this.
3. Ingest epic: choose a feed approach (separate proposal).
4. Confirm the PRD's open pricing and expiry-rule decisions, which block Epics 4 and 6.
