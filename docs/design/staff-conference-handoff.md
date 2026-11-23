# Staff conference handoff (V1 Hold Sentinel): plan

**Status:** Plan for review. Nothing here changes production until a default-off flag is enabled.
**Branch:** feat/staff-conference-handoff
**Related:** ADR 0003, docs/compliance/crtc-disclosure-decision.md, docs/compliance/PHI-VAPI-BOUNDARY.md

## Problem (verified in code)

1. `request_staff_handoff` calls `transferVapiCall` (src/vapi/client.ts): POST /call/{id}/transfer with a number only.
   Vapi documents blind as the default, and a transfer to a number ends the Vapi call. The "Scribe keeps listening"
   comment in src/webhooks/vapi.ts is unverified and probably false.
2. Sequencing bug: `processCallEnded` (src/server/vapi/vapiWebhook.ts) runs when the Vapi call ends, which is the
   moment of handoff. For human-assisted calls it looks up `HumanAssistedCallLog` by vapiCallId and, if none exists
   yet, falls back to payload-based outcome resolution over IVR/hold audio only. Any log written after the staff
   conversation arrives too late and the claim outcome is already decided.

## Target design

Carrier rep, practice staff, and a silent listener share one per-call Twilio conference. Nothing is recorded or
stored. One structured outcome is written keyed by the original vapiCallId.

## Architecture decision: how the listener attaches (both avoid the shared-number correlation problem)

**P1 (recommended): Twilio Real-Time Transcription.** Start transcription on the carrier and staff legs by CallSid
(REST `Calls/{CallSid}/Transcriptions` or `<Start><Transcription>`). Transcript events arrive at our webhook keyed by
CallSid; hold them in memory, and when the conference ends run Claude extraction (same schema as `log_call_outcome`),
scrub, write `HumanAssistedCallLog`, discard the transcript. No Vapi Scribe leg and no audio stored.

**P2 (fallback): Vapi Scribe over SIP.** Twilio adds `sip:<scribe>@sip.vapi.ai` to the conference with an
`X-Handoff-Id` header. Vapi extracts X- headers and can send them in an `assistant-request`, so our server returns the
Scribe config for that exact handoff. Keeps Claims_Scribe and `log_call_outcome` unchanged.

Both need: per-call conference name, Twilio REST credentials, staff leg added by REST.

## Phases

**Phase 0: safe changes, no telephony (build first)**
- Flag `STAFF_CONFERENCE_HANDOFF_ENABLED` (default off); legacy transfer stays the default path.
- Fix sequencing: for `isHumanAssisted` calls ended by handoff, defer outcome resolution until the log arrives or a
  timeout passes, and re-resolve when a late log arrives (idempotent via existing `recoveryApplied` guard).
- Scrub step on `callSummary` and `repName` before save; unit tests with names, DOBs, member IDs.
- Practice consent flag for the silent listener (settings + onboarding copy); counsel signs off wording.
- Staff post-call outcome form (writes `HumanAssistedCallLog`): data flows even if the audio path slips.
- Correct the misleading "warm transfer" comments.

**Phase 1: conference spike (flagged; test phone as staff)**
- Move carrier leg into `handoff-<id>` via Twilio REST on the Vapi call's CallSid; add staff leg.
- Measure: audio gap, both-way audio, Vapi `endedReason` produced, no retry consumed, no CARRIER_BLOCK trigger.
- Check: does Twilio transcription work on conference legs (docs do not say).

**Phase 2: listener (P1, else P2)** per spike results; end-to-end test; concurrency test with two simultaneous handoffs.

**Phase 3: pilot hardening:** staff no-answer fallback (keep carrier on hold music, missed-handoff script), timeouts,
conference cleanup, alerts, per-carrier metrics.

## Test setup (needs approval before any live call or deploy)
- Staff phone: test number via env/config, never committed. Carrier rep: a second number.
- Pass: both parties hear each other; listener silent; exactly one log with the right vapiCallId; claim status and
  retry count correct; no audio or transcript persisted.
