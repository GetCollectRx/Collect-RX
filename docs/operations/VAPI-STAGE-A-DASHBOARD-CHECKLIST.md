# Vapi dashboard checklist for the staff transfer fix (Stage A)

Audience: Khalid. Nothing here was changed by the engineering agent. Every step is read-only unless it says "set".

## What changed in code

| Before | After |
|---|---|
| `transferVapiCall()` POSTed to `/call/{id}/transfer`, an endpoint Vapi does not document | It reads `monitor.controlUrl` from `GET /call/{id}` and POSTs `{"type":"transfer","destination":{"type":"number","number":"+1..."}}` to that URL, as Vapi documents for live call control |
| Live Console takeover acted on the practice's first active call | Takeover acts on the call staff selected (`callId` or `vapiCallId`), scoped to the practice. With no selection it only proceeds if exactly one call is live |

The control URL only exists if live control is enabled for the call. Enable it one of two ways (pick one, staging first):

1. Server side: set `VAPI_LIVE_CONTROL_ENABLED=true`. The call request then carries `assistantOverrides.monitorPlan.controlEnabled = true`.
2. Dashboard side: set `monitorPlan.controlEnabled` to true on each assistant in the human-assisted squad.

## Evidence status

| Claim | Status | Source |
|---|---|---|
| Transfer message shape and `monitor.controlUrl` on the call object | Documented | Vapi call features guide and API reference |
| `monitorPlan.controlEnabled` is the opt-in | Documented in the assistant schema, no default stated | Vapi API reference, assistants |
| A control-URL transfer with this payload works | One community report says yes; Vapi support bot said it "may not be supported or documented for live calls" | Vapi support thread |
| Vapi can answer HTTP 200 with a schema error in the body | Reported once in the same thread | Vapi support thread |
| Transcription and recording stop after a transfer | Not in Vapi's docs. Vapi support staff say Vapi "no longer controls or records the post-transfer segment" | Vapi support thread on recording after transfer |
| Whether a control-URL transfer is warm or blind | Not documented. The payload has no `transferPlan` field | n/a |

Treat the last three rows as UNVERIFIED until the test call below is done.

## Checks to run in the dashboard

| # | Where | What to check | Why it matters |
|---|---|---|---|
| 1 | Squads | Open the squad whose ID matches `VAPI_HUMAN_ASSISTED_SQUAD_ID` on the server. If that variable is unset, the code uses a hardcoded fallback ID (`getHumanAssistedSquadId()` in `src/vapi/client.ts`). Confirm the squad exists and its members are IVR_Navigator, Hold_Sentinel, Claims_Scribe | The human-assisted squad is defined only in the dashboard, not in this repo |
| 2 | Each member assistant | Is `monitorPlan.controlEnabled` true. Is `controlAuthenticationEnabled` true. If it is, the control POST needs credentials the code does not send, and the transfer will fail with `rejected` | Without control enabled there is no control URL |
| 3 | Each member assistant | Does any member hold a built-in Transfer Call tool, and if so which `transferPlan.mode` (blind-transfer or a warm-transfer variant) | `request_staff_handoff` is a server tool that calls the backend, so the Vapi tool setting only matters if a member also has its own transfer tool |
| 4 | Claims_Scribe | Its prompt is not in this repo. Save a copy of it. Note whether it stays on the call after staff are connected | ADR 0005 evidence depends on the scribe hearing the rep conversation |
| 5 | Tool `log_call_outcome` | Schema accepts scenario `staff_unavailable` (ADR 0003 standing rule) | Missed handoff logging |
| 6 | The assistant that receives the `request_staff_handoff` result | May speak the returned script (ADR 0003 standing rule) | Reference number capture on a missed handoff |

## Test call (never a carrier)

Use a test assistant or squad and a phone you control. Do not point this at a carrier number.

1. Staging only: set `VAPI_LIVE_CONTROL_ENABLED=true`.
2. Start a call to your own phone. In Vapi, open Logs, then Calls, and confirm the call object shows `monitor.controlUrl`.
3. From the Live Console, take over with a second phone you control.
4. In the Vapi call log record:
   - whether the staff phone rang and connected;
   - the ended reason (`assistant-forwarded-call` means Vapi started the transfer, not that it completed);
   - whether the call stayed open on Vapi after staff connected;
   - whether transcript lines continue after the connection (this answers whether Claims_Scribe keeps listening);
   - whether the transfer felt warm (the assistant introduced the call) or blind.
5. Send the results back. Stage C of the hybrid plan depends on the transcript answer in step 4.

## Rollback

Unset `VAPI_LIVE_CONTROL_ENABLED`. New calls stop requesting a control URL. Takeover then returns 502 "Could not transfer the call. It is still active." and the call continues untouched.
