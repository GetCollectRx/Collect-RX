# Simulation harness Stage 1 run stage1-2026-11-06T16-30-19-088Z

Verdict: **FAIL** (PASS 71, FAIL 18, UNVERIFIED 5, FINDING 16)

## Checks

| # | Step | Components | Check | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Setup | 21 | No real carrier number in synthetic data | PASS | scanned clean CSV for 6 allowlisted carrier numbers; hits=0 |
| 2 | Setup | 21 | Practice is marked synthetic | PASS | SYNTHETIC ONLY Dental Validation 919aac83f6 |
| 3 | Setup | 1 | Synthetic aging report built | PASS | {"0-29":0,"30-59":2971.2200000000003,"60-89":3610.79,"90-119":0,"120+":0} |
| 4 | Setup | 6 | Gap 7 addendum: practice settings carry minimumClaimAgeDays (21 TELUS, 32 others) | FINDING | defaultCarrierConfigs() in practiceSettingsService.ts sets minimumClaimAgeDays, but validateDispatch (src/carriers/adapter.ts) never reads it; the flat 30-day floor is what gates. That is a fifth age number. |
| 5 | 1 Import | 1 | Import pipeline succeeded | PASS | status=success imported=10 failed=0 |
| 6 | 1 Import | 1 | All synthetic claims created | PASS | 10 of 10 |
| 7 | 1 Import | 1 | days_outstanding persisted as supplied by the PMS row | PASS | all match |
| 8 | 1 Import | 1 | Submission-date age computed by claimAge.ts vs supplied value | FINDING | supplied->submission-date age today: 82->210, 65->191, 80->207, 52->180, 88->215, 74->200, 52->178, 60->186, 53->181, 34->162. By design an export that states an age wins (claimAge.ts). The factory anchors dates at 2026-06-30, so without the days_outstanding column every claim would be over 90 days and escalate instead of dial. Whether a stored stated age is re-aged on later syncs is UNVERIFIED. |
| 9 | 1 Import | 1 | Every carrier name mapped to a carrier id | PASS | Sun Life=>sun_life, TELUS AdjudiCare=>telus_adjudicare, Sun Life=>sun_life, Sun Life=>sun_life, RBC=>rbc, TELUS AdjudiCare=>telus_adjudicare, Sun Life=>sun_life, RBC=>rbc, Canada Life=>canada_life, Green Shield=>green_shield |
| 10 | 1 Import | 2 | Zero plaintext synthetic PHI anywhere in the database after import | PASS | scanned all public tables for 30 values |
| 11 | 1 Import | 2 | Gap 9: which vault holds the import tokens | FINDING | src/pii-vault.ts piiVault.detokenize success=true; src/services/pii-vault.ts detokenize throws: [PIIVault] detokenize: unknown token "0506176b-5add-4a75-b1e9-8d98989aba2c" |
| 12 | 2 Prioritize | 4 | Queue order as stored (priority, then scheduledFor) | FINDING | SYN-CLM-EB105-028211[HIGH,age 82,ageScore 156] > SYN-CLM-EB105-694038[HIGH,age 65,ageScore 105] > SYN-CLM-EB105-215552[HIGH,age 80,ageScore 150] > SYN-CLM-EB105-441810[HIGH,age 88,ageScore 174] > SYN-CLM-EB105-333245[HIGH,age 74,ageScore 132] > SYN-CLM-EB105-382208[NORMAL,age 52,ageScore 74] > SYN-CLM-EB105-952411[NORMAL,age 52,ageScore 74] > SYN-CLM-EB105-522927[NORMAL,age 60,ageScore 90] > SYN-CLM-EB105-465215[NORMAL,age 53,ageScore 76] > SYN-CLM-EB105-190277[NORMAL,age 34,ageScore 38] |
| 13 | 2 Triage | 5 | PMS-paid claim closed by triage without a dial | PASS | claim SYN-CLM-EB105-028211 status=RESOLVED TRIAGE_RESOLVED event=true dialed=false |
| 14 | 2 Triage | 5,6 | Remaining claims still proceed to dispatch | PASS | dials this tick=1 |
| 15 | 2 Triage | 5 | CDAnet channel | FINDING | enrolledCdanetClaimStatusAdapter is an explicit no-signal contract adapter; it never resolves a claim (claimStatusProbe.ts header). |
| 16 | 3 Dispatch | 6,9 | Hold Sentinel squad selected | PASS | squadId=sim-hold-sentinel-squad |
| 17 | 3 Dispatch | 8 | Vapi metadata carries no PHI | PASS | metadata keys=claimId,carrierId,patientToken,practiceId; leaks=0 |
| 18 | 3 Dispatch | 8 | PHI present only in ephemeral variableValues | PASS | variableValues PHI values present=3 |
| 19 | 3 Dispatch | 8 | Dial destination | FINDING | payload targets a REAL allowlisted carrier line (+18009619356); the hardcoded allowlist cannot point at a mock, so in Stage 1 interception is the only barrier. Recorded, never sent. |
| 20 | 3 Dispatch | 6 | Idempotency key present on the dial | PASS | Idempotency-Key header=07edfa99-8fe6-4f15-a5be-eaec0854a867:1 expected 07edfa99-8fe6-4f15-a5be-eaec0854a867:1 |
| 21 | 3 Dispatch | 7 | Call attempt starts in the live dialing state | PASS | liveState=dialing activeAgent=IVR_Navigator isHumanAssisted=true |
| 22 | 3 Dispatch | 7 | AR engine state machine (Claim_Queued ...) in the live path | FINDING | src/services/arEngine/stateMachine.ts and reconciler.ts are imported by nothing outside src/services/arEngine/. The live path tracks CallAttempt.liveState instead. Brief Step 3/4 state-machine assertions test unwired code. |
| 23 | 3 Dispatch | 6 | No dial with zero ready staff | FAIL | The practice has no staff presence or availability state, and the dial still went out. runDeskQueueTick has no staff-capacity gate (no availability check in src/server/frontDesk/queueEngine.ts); missed handoffs are handled after pickup by the staff_unavailable script. |
| 24 | 4-7 C1_PAID_IN_FULL | 10 | Fake carrier timeline from carrier config JSON | PASS | 6 IVR steps, hold 1260s, total 1316s |
| 25 | 4-7 C1_PAID_IN_FULL | 12 | status-update accepted | PASS | HTTP 200 |
| 26 | 4-7 C1_PAID_IN_FULL | 9,17 | Pickup handoff transfers this call to the escalation line | PASS | result="HANDOFF INITIATED — staff have been notified and the call is transferring to them now. Stop talking; do not engage further." transfer=/call/sim-call-001/transfer |
| 27 | 4-7 C1_PAID_IN_FULL | 17 | Staff alerted on pickup | PASS | notification "Rep on the line — claim SYN-CLM-EB105-215552" |
| 28 | 4-7 C1_PAID_IN_FULL | 14 | Claims_Scribe outcome logged | PASS | HTTP 200 scenario=CLAIM_PAID |
| 29 | 4-7 C1_PAID_IN_FULL | 12 | End-of-call report accepted | PASS | HTTP 200 body={"received":true} |
| 30 | 4-7 C1_PAID_IN_FULL | 7,11 | Live state sequence Dialing > IVR > Hold > Agent | FAIL | observed final liveState=dialing activeAgent=IVR_Navigator. No IVR or hold transition reaches the attempt: status-update carries no agent, and normalizeVapiWebhook drops analysis.collectrx, so processAgentTransition never runs on native payloads. |
| 31 | 4-7 C1_PAID_IN_FULL | 7,11 | Hold seconds recorded | FAIL | scripted hold 1260s; CallAttempt has no hold-seconds column and nothing persists hold time (prisma/schema.prisma CallAttempt model). |
| 32 | 4-7 C1_PAID_IN_FULL | 9 | No AI speech to the rep | UNVERIFIED | depends on the live Hold_Sentinel and Claims_Scribe prompts on the Vapi dashboard; not observable offline. |
| 33 | 4-7 C1_PAID_IN_FULL | 13 | Stored transcript contains zero synthetic PHI | FAIL | leaked values=1 (patient name survived redaction) |
| 34 | 4-7 C1_PAID_IN_FULL | 13 | Live transcript lines contain zero synthetic PHI | PASS | 0 lines |
| 35 | 4-7 C1_PAID_IN_FULL | 2,21 | Recording deletion requested from Vapi | PASS | 1 delete request(s); Twilio deletion skipped because TWILIO_ACCOUNT_SID is unset in Stage 1 |
| 36 | 4-7 C1_PAID_IN_FULL | 18 | Minutes billed equal ceil(call seconds / 60) | PASS | billed=22 expected=22 (call 1316s) |
| 37 | 4-7 C1_PAID_IN_FULL | 2 | PHI token state after the call | FINDING | token revoked after RESOLVED |
| 38 | 4-7 S014_PARTIAL_PAYER | 10 | Fake carrier timeline from carrier config JSON | PASS | 7 IVR steps, hold 1500s, total 1557s |
| 39 | 4-7 S014_PARTIAL_PAYER | 12 | status-update accepted | PASS | HTTP 200 |
| 40 | 4-7 S014_PARTIAL_PAYER | 9,17 | Pickup handoff transfers this call to the escalation line | PASS | result="HANDOFF INITIATED — staff have been notified and the call is transferring to them now. Stop talking; do not engage further." transfer=/call/sim-call-002/transfer |
| 41 | 4-7 S014_PARTIAL_PAYER | 17 | Staff alerted on pickup | PASS | notification "Rep on the line — claim SYN-CLM-EB105-441810" |
| 42 | 4-7 S014_PARTIAL_PAYER | 14 | Claims_Scribe outcome logged | PASS | HTTP 200 scenario=PARTIAL_PAYMENT |
| 43 | 4-7 S014_PARTIAL_PAYER | 12 | End-of-call report accepted | PASS | HTTP 200 body={"received":true} |
| 44 | 4-7 S014_PARTIAL_PAYER | 7,11 | Live state sequence Dialing > IVR > Hold > Agent | FAIL | observed final liveState=dialing activeAgent=IVR_Navigator. No IVR or hold transition reaches the attempt: status-update carries no agent, and normalizeVapiWebhook drops analysis.collectrx, so processAgentTransition never runs on native payloads. |
| 45 | 4-7 S014_PARTIAL_PAYER | 7,11 | Hold seconds recorded | FAIL | scripted hold 1500s; CallAttempt has no hold-seconds column and nothing persists hold time (prisma/schema.prisma CallAttempt model). |
| 46 | 4-7 S014_PARTIAL_PAYER | 9 | No AI speech to the rep | UNVERIFIED | depends on the live Hold_Sentinel and Claims_Scribe prompts on the Vapi dashboard; not observable offline. |
| 47 | 4-7 S014_PARTIAL_PAYER | 13 | Stored transcript contains zero synthetic PHI | PASS | leaked values=0 |
| 48 | 4-7 S014_PARTIAL_PAYER | 13 | Live transcript lines contain zero synthetic PHI | PASS | 0 lines |
| 49 | 4-7 S014_PARTIAL_PAYER | 2,21 | Recording deletion requested from Vapi | PASS | 1 delete request(s); Twilio deletion skipped because TWILIO_ACCOUNT_SID is unset in Stage 1 |
| 50 | 4-7 S014_PARTIAL_PAYER | 18 | Minutes billed equal ceil(call seconds / 60) | PASS | billed=26 expected=26 (call 1557s) |
| 51 | 4-7 S014_PARTIAL_PAYER | 2 | PHI token state after the call | FINDING | token still valid after ESCALATED |
| 52 | 4-7 DENIED_WITH_CODE | 10 | Fake carrier timeline from carrier config JSON | PASS | 6 IVR steps, hold 1980s, total 2036s |
| 53 | 4-7 DENIED_WITH_CODE | 12 | status-update accepted | PASS | HTTP 200 |
| 54 | 4-7 DENIED_WITH_CODE | 9,17 | Pickup handoff transfers this call to the escalation line | PASS | result="HANDOFF INITIATED — staff have been notified and the call is transferring to them now. Stop talking; do not engage further." transfer=/call/sim-call-003/transfer |
| 55 | 4-7 DENIED_WITH_CODE | 17 | Staff alerted on pickup | PASS | notification "Rep on the line — claim SYN-CLM-EB105-382208" |
| 56 | 4-7 DENIED_WITH_CODE | 14 | Claims_Scribe outcome logged | PASS | HTTP 200 scenario=CLAIM_DENIED |
| 57 | 4-7 DENIED_WITH_CODE | 12 | End-of-call report accepted | PASS | HTTP 200 body={"received":true} |
| 58 | 4-7 DENIED_WITH_CODE | 7,11 | Live state sequence Dialing > IVR > Hold > Agent | FAIL | observed final liveState=dialing activeAgent=IVR_Navigator. No IVR or hold transition reaches the attempt: status-update carries no agent, and normalizeVapiWebhook drops analysis.collectrx, so processAgentTransition never runs on native payloads. |
| 59 | 4-7 DENIED_WITH_CODE | 7,11 | Hold seconds recorded | FAIL | scripted hold 1980s; CallAttempt has no hold-seconds column and nothing persists hold time (prisma/schema.prisma CallAttempt model). |
| 60 | 4-7 DENIED_WITH_CODE | 9 | No AI speech to the rep | UNVERIFIED | depends on the live Hold_Sentinel and Claims_Scribe prompts on the Vapi dashboard; not observable offline. |
| 61 | 4-7 DENIED_WITH_CODE | 13 | Stored transcript contains zero synthetic PHI | FAIL | leaked values=1 (patient name survived redaction) |
| 62 | 4-7 DENIED_WITH_CODE | 13 | Live transcript lines contain zero synthetic PHI | PASS | 0 lines |
| 63 | 4-7 DENIED_WITH_CODE | 2,21 | Recording deletion requested from Vapi | PASS | 1 delete request(s); Twilio deletion skipped because TWILIO_ACCOUNT_SID is unset in Stage 1 |
| 64 | 4-7 DENIED_WITH_CODE | 18 | Minutes billed equal ceil(call seconds / 60) | PASS | billed=34 expected=34 (call 2036s) |
| 65 | 4-7 DENIED_WITH_CODE | 2 | PHI token state after the call | FINDING | token revoked after DENIED |
| 66 | 9 Proof | 18 | Trial daily cap stops dispatch | FINDING | plan gate reason=DAILY_CAP_REACHED after 82 billed minutes. The cap is checked before each dial, not projected, so realistic 15 to 35 minute holds overshoot it; a trial practice gets about two carrier calls a day. Practice moved to the sentinel tier (active) so the remaining scenarios can run. |
| 67 | 4-7 NOT_ON_FILE_RESUBMIT | 10 | Fake carrier timeline from carrier config JSON | PASS | 6 IVR steps, hold 900s, total 948s |
| 68 | 4-7 NOT_ON_FILE_RESUBMIT | 12 | status-update accepted | PASS | HTTP 200 |
| 69 | 4-7 NOT_ON_FILE_RESUBMIT | 9,17 | Pickup handoff transfers this call to the escalation line | PASS | result="HANDOFF INITIATED — staff have been notified and the call is transferring to them now. Stop talking; do not engage further." transfer=/call/sim-call-004/transfer |
| 70 | 4-7 NOT_ON_FILE_RESUBMIT | 17 | Staff alerted on pickup | PASS | notification "Rep on the line — claim SYN-CLM-EB105-952411" |
| 71 | 4-7 NOT_ON_FILE_RESUBMIT | 14 | Claims_Scribe outcome logged | PASS | HTTP 200 scenario=CLAIM_NOT_RECEIVED |
| 72 | 4-7 NOT_ON_FILE_RESUBMIT | 12 | End-of-call report accepted | PASS | HTTP 200 body={"received":true} |
| 73 | 4-7 NOT_ON_FILE_RESUBMIT | 7,11 | Live state sequence Dialing > IVR > Hold > Agent | FAIL | observed final liveState=dialing activeAgent=IVR_Navigator. No IVR or hold transition reaches the attempt: status-update carries no agent, and normalizeVapiWebhook drops analysis.collectrx, so processAgentTransition never runs on native payloads. |
| 74 | 4-7 NOT_ON_FILE_RESUBMIT | 7,11 | Hold seconds recorded | FAIL | scripted hold 900s; CallAttempt has no hold-seconds column and nothing persists hold time (prisma/schema.prisma CallAttempt model). |
| 75 | 4-7 NOT_ON_FILE_RESUBMIT | 9 | No AI speech to the rep | UNVERIFIED | depends on the live Hold_Sentinel and Claims_Scribe prompts on the Vapi dashboard; not observable offline. |
| 76 | 4-7 NOT_ON_FILE_RESUBMIT | 13 | Stored transcript contains zero synthetic PHI | PASS | leaked values=0 |
| 77 | 4-7 NOT_ON_FILE_RESUBMIT | 13 | Live transcript lines contain zero synthetic PHI | PASS | 0 lines |
| 78 | 4-7 NOT_ON_FILE_RESUBMIT | 2,21 | Recording deletion requested from Vapi | PASS | 1 delete request(s); Twilio deletion skipped because TWILIO_ACCOUNT_SID is unset in Stage 1 |
| 79 | 4-7 NOT_ON_FILE_RESUBMIT | 18 | Minutes billed equal ceil(call seconds / 60) | PASS | billed=16 expected=16 (call 948s) |
| 80 | 4-7 NOT_ON_FILE_RESUBMIT | 14 | Resubmit outcome routing | FINDING | CLAIM_NOT_RECEIVED maps to claimStatus ESCALATED in humanAssistedOutcomeResolver.ts (comment: a human, not the retry cadence), but the recovery router sent it back to CALL_CARRIER / IN_QUEUE with a recall. The practice is never told to resubmit, and the next call will hear the same answer. |
| 81 | 4-7 NOT_ON_FILE_RESUBMIT | 2 | PHI token state after the call | FINDING | token still valid after IN_QUEUE |
| 82 | 4-7 ROBOT_REFUSER | 10 | Fake carrier timeline from carrier config JSON | PASS | 7 IVR steps, hold 600s, total 625s |
| 83 | 4-7 ROBOT_REFUSER | 12 | status-update accepted | PASS | HTTP 200 |
| 84 | 4-7 ROBOT_REFUSER | 12,21 | Live refusal phrase triggers CARRIER_BLOCK | FAIL | HTTP 200 body={"received":true,"ignored":true}; block=false. Native Vapi "transcript" messages are dropped by normalizeVapiWebhook (src/webhooks/vapiNormalizer.ts returns null for unhandled types), so the live phrase detector in vapiDeskEvents.ts never sees them. |
| 85 | 4-7 ROBOT_REFUSER | 9,17 | Pickup handoff transfers this call to the escalation line | PASS | result="HANDOFF INITIATED — staff have been notified and the call is transferring to them now. Stop talking; do not engage further." transfer=/call/sim-call-005/transfer |
| 86 | 4-7 ROBOT_REFUSER | 17 | Staff alerted on pickup | PASS | notification "Rep on the line — claim SYN-CLM-EB105-522927" |
| 87 | 4-7 ROBOT_REFUSER | 14 | Claims_Scribe outcome logged | PASS | HTTP 200 scenario=UNCLEAR |
| 88 | 4-7 ROBOT_REFUSER | 12 | End-of-call report accepted | PASS | HTTP 200 body={"received":true} |
| 89 | 4-7 ROBOT_REFUSER | 7,11 | Live state sequence Dialing > IVR > Hold > Agent | FAIL | observed final liveState=dialing activeAgent=IVR_Navigator. No IVR or hold transition reaches the attempt: status-update carries no agent, and normalizeVapiWebhook drops analysis.collectrx, so processAgentTransition never runs on native payloads. |
| 90 | 4-7 ROBOT_REFUSER | 7,11 | Hold seconds recorded | FAIL | scripted hold 600s; CallAttempt has no hold-seconds column and nothing persists hold time (prisma/schema.prisma CallAttempt model). |
| 91 | 4-7 ROBOT_REFUSER | 9 | No AI speech to the rep | UNVERIFIED | depends on the live Hold_Sentinel and Claims_Scribe prompts on the Vapi dashboard; not observable offline. |
| 92 | 4-7 ROBOT_REFUSER | 13 | Stored transcript contains zero synthetic PHI | PASS | leaked values=0 |
| 93 | 4-7 ROBOT_REFUSER | 13 | Live transcript lines contain zero synthetic PHI | PASS | 0 lines |
| 94 | 4-7 ROBOT_REFUSER | 2,21 | Recording deletion requested from Vapi | PASS | 1 delete request(s); Twilio deletion skipped because TWILIO_ACCOUNT_SID is unset in Stage 1 |
| 95 | 4-7 ROBOT_REFUSER | 18 | Minutes billed equal ceil(call seconds / 60) | PASS | billed=11 expected=11 (call 625s) |
| 96 | 4-7 ROBOT_REFUSER | 2 | PHI token state after the call | FINDING | token revoked after ESCALATED |
| 97 | Gap 3 | 17 | Takeover targets the selected call (B) | PASS | staff selected B; transfer went to /call/sim-concurrent-b/transfer. frontDeskApi.ts:345 uses findFirst with no selection; pause (:277) and end-call (:318) share the pattern. |
| 98 | Gap 4 | 8 | Transfer method in use | FINDING | transferVapiCall POSTs /call/{id}/transfer (src/vapi/client.ts:597). Whether this matches the PRD Stage A control-URL method is UNVERIFIED until the PRD arrives. |
| 99 | 8 Learning | 16 | Gap 1: webhook skips lesson extraction for staff-handled calls | FINDING | Anthropic requests during webhook processing=0; gate at src/webhooks/vapi.ts:623 (!callAttempt.isHumanAssisted). Extraction below is invoked directly (decision D2). |
| 100 | 8 Learning | 16,21 | Transcript sent to the extraction model contains zero synthetic PHI | FAIL | leaked values in outbound LLM request=1 |
| 101 | 8 Learning | 16 | Lessons land PROPOSED | PASS | stored=2 statuses=PROPOSED,PROPOSED |
| 102 | 8 Learning | 16 | Identifier filter drops a lesson containing a date | PASS | date lesson stored=false |
| 103 | 8 Learning | 16 | Identifier filter drops a lesson containing a patient name | FAIL | name lesson stored=true. containsIdentifierLikeContent (carrierLessons.ts) only matches 6+ digit runs and ISO dates; names reach PROPOSED and only human review stops them. |
| 104 | 8 Learning | 16 | Only APPROVED navigation lessons inject into IVR instructions | PASS | before approval injected=false; after=true |
| 105 | 8 Learning | 16 | Zero lessons is accepted for a routine call | PASS | stored=0 |
| 106 | 9 Proof | 19 | Staff minutes saved matches the run-log hold arithmetic | FAIL | dashboard=90 min (5 calls x 18 fixed); run log hold=104.0 min. getTimeSaved (insurance-analytics.ts) uses a constant, not measured hold time. |
| 107 | 9 Proof | 19 | Hold minutes avoided metric | FAIL | No hold-minutes-avoided metric exists in server code; nothing to compare against the run log. |
| 108 | 9 Proof | 18 | Calls counted against the tier allowance | PASS | usagePeriod minutesConsumed=109 callsCompleted=5; sum of attempt minutesBilled=109 |
| 109 | 3 Dispatch | 6,21 | CARRIER_BLOCK respected at dispatch (no dial to blocked carrier) | PASS | blocked rbc; queue entries held by applyCarrierBlock=1; top candidate queue status=BLOCKED; dials to it this tick=0; other dials=0 |
| 110 | Teardown | all | Teardown left no synthetic data behind | PASS | full-database scan for practice, claim, attempt markers and synthetic PHI: 0 rows |

## Scenarios

| Scenario | Persona | Carrier | Expected | Observed | Status |
|---|---|---|---|---|---|
| C1_PAID_IN_FULL | C1 By-the-Book Provider Service Rep | sun_life | claim RESOLVED | claim RESOLVED; attempt outcome RESOLVED. | PASS |
| S014_PARTIAL_PAYER | Partial-Payer (S014 partial payment) | rbc | claim ESCALATED | claim ESCALATED; attempt outcome RESOLVED. Scribe scenario=PARTIAL_PAYMENT; attempt outcome is RESOLVED (CallOutcome has no partial value). | PASS |
| DENIED_WITH_CODE | C2 Overloaded Call-Center Rep | sun_life | claim DENIED | claim DENIED; attempt outcome DENIED. | PASS |
| NOT_ON_FILE_RESUBMIT | C3 Veteran Helpful Rep | sun_life | claim ESCALATED | claim IN_QUEUE; attempt outcome PENDING. | FAIL |
| ROBOT_REFUSER | Robot-Refuser | rbc | CARRIER_BLOCK applied to carrier | block=false attempt outcome=ESCALATED carrierBlockDetected=false. humanAssistedOutcomeResolver.ts hard-codes carrierBlockDetected=false. | FAIL |

## Notes

- Stage 1 is offline: no audio, no Vapi, no carrier. Pickup timing, hold detection and scribe-after-transfer cannot be measured here (gaps 2 and 11).
- Section 5 thresholds, Stage A and Option B are UNVERIFIED until the PRD is supplied (decision D9).
- Factory limits days_outstanding to 32 to 88, so the 0-29, 90-119 and 120+ buckets are empty. The under-30 and over-90 gates are therefore not exercised in this run.
- Dispatch gates observed before any dial: voiceAgentEnabled (default false, VOICE_AGENT_DISABLED) and, per carrier, a Billing Agent Authorization Letter flag plus a provider number (CARRIER_NOT_AUTHORIZED). The synthetic practice sets all three in settings, as onboarding would.
- Spend: $0. Outbound requests intercepted: 18 (Vapi stub 11, Anthropic stub 2, recording-delete stub 5, blocked 0). Non-local node http(s) attempts blocked: 0.
- Teardown does not remove the payload-free webhook delivery ledger rows (body hashes only) or the global queue lease row; neither holds synthetic identifiers.
