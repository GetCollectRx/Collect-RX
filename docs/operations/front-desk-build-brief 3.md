# CollectRx — Front Desk Voice Agent Console: Build Brief

**For:** Cursor / Developer Implementation  
**Prepared by:** Khalid Egeh (via Claude Cowork)  
**Date:** 2026-05-24  
**Status:** Ready for Implementation

---

## 0. What This Is

Front desk staff at a dental practice need to monitor and manage the CollectRx Vapi voice agent squad in real time. Right now they have no window into what the agent is doing. This brief adds that window — a Live Console screen — plus the backend infrastructure (WebSocket, Vapi webhooks, call state machine, queue engine, CARRIER_BLOCK) that makes it work.

This is not a new app. It extends the existing Express + React codebase at `src/`.

---

## 1. What Already Exists (Do Not Re-Create)

| What | Where |
|------|-------|
| Express server | `src/api/server.ts` |
| In-memory DB (Maps) | `src/api/db.ts` |
| Auth middleware | `src/api/middleware/authenticate.ts` |
| Practice-scope middleware | `src/api/middleware/authorize.ts` |
| Webhook router (Stripe + SendGrid only) | `src/api/routes/webhooks.ts` |
| Dashboard component | `src/frontend/components/Dashboard.tsx` |
| Role types | `src/types/auth.ts` |

There is currently **no WebSocket server**, **no Vapi webhook handler**, and **no call-related data** in the DB.

---

## 2. Non-Negotiable Business Rules

These rules are hardcoded constraints, not configuration. Violating any of them breaks the product.

1. **PHI Boundary** — PHI (patient names, DOBs, health card numbers) never crosses to Vapi. The Vapi squad receives UUID tokens only. Detokenize on the backend after call completion before displaying to front desk.
2. **CARRIER_BLOCK** — If a carrier detects automation, suspend ALL calls to that carrier immediately — not just the current one. This is the most critical operational rule. Any code that touches call scheduling or Vapi webhooks must check the `CARRIER_BLOCK` flag before proceeding.
3. **Call window** — Calls only Mon–Fri 8am–5pm Eastern. Queue auto-pauses outside this window.
4. **Attempt cap** — Maximum 3 call attempts per claim. 3rd failure → auto-escalate.
5. **Age gates** — Claims under 30 days old: do not enter the queue. Claims over 90 days old: skip AI, route directly to human escalation.
6. **TELUS AdjudiCare** — Identify the underlying TPA from the group number prefix before routing any call. TELUS minimum claim wait is day 21 (vs. day 32 for all other carriers).

---

## 3. New DB Tables

Add these tables to `src/api/db.ts` (in-memory Maps for now, matching the existing pattern). Also add the types in `src/types/`.

### 3a. `calls`

```ts
// src/types/calls.ts
export type CallState =
  | 'idle'
  | 'queued'
  | 'dialing'
  | 'ivr_navigation'
  | 'rep_connected'
  | 'escalating'
  | 'resolving'
  | 'completed'
  | 'failed'
  | 'paused_by_staff'
  | 'carrier_blocked';

export type CallOutcome =
  | 'approved'
  | 'pending_adjudication'
  | 'denied_missing_docs'
  | 'denied_carrier_error'
  | 'voicemail'
  | 'ivr_failure'
  | 'wrong_number'
  | 'human_takeover'
  | 'carrier_blocked';

export type ActiveAgent =
  | 'IVR_Navigator'
  | 'Claims_Agent'
  | 'Escalation_Closer'
  | 'Resolution_Closer';

export interface Call {
  id: string;                      // UUID
  practiceId: string;
  claimId: string;                 // references claim in CollectRx MCP
  claimRef: string;                // e.g. "CRX-4821" — display only
  carrierId: CarrierId;
  attemptNumber: number;           // 1, 2, or 3
  state: CallState;
  activeAgent: ActiveAgent | null;
  vapiCallId: string | null;       // Vapi's call ID, set on call.started
  outcome: CallOutcome | null;
  outcomeNotes: string | null;     // from Vapi transcript parsing
  amountClaimed: number;           // in cents
  startedAt: string | null;        // ISO
  endedAt: string | null;          // ISO
  pausedByStaffAt: string | null;
  pausedByStaffId: string | null;
  takenOverByStaffAt: string | null;
  takenOverByStaffId: string | null;
  createdAt: string;
}
```

### 3b. `call_transcript_lines`

```ts
export interface TranscriptLine {
  id: string;
  callId: string;
  speaker: 'agent' | 'carrier' | 'system';
  agentName: ActiveAgent | null;   // set when speaker = 'agent'
  text: string;
  timestamp: string;               // ISO
}
```

### 3c. `call_queue`

```ts
export interface QueueEntry {
  id: string;
  practiceId: string;
  claimId: string;
  claimRef: string;
  carrierId: CarrierId;
  amountClaimed: number;
  priority: number;                // lower = higher priority; default 100
  attemptsMade: number;
  heldForCarrierBlock: boolean;
  heldReason: string | null;
  scheduledAfter: string | null;   // ISO — don't call before this time
  addedAt: string;
}
```

### 3d. `carrier_blocks`

```ts
export type CarrierId =
  | 'sun_life'
  | 'canada_life'
  | 'manulife'
  | 'green_shield'
  | 'rbc_insurance'
  | 'telus_adjudicare';

export interface CarrierBlock {
  id: string;
  carrierId: CarrierId;
  blockedAt: string;               // ISO
  blockedByCallId: string;
  clearedAt: string | null;
  clearedByStaffId: string | null;
  clearedByStaffAt: string | null;
  reason: string;                  // transcript excerpt that triggered detection
}
```

Add these Maps to `src/api/db.ts`:

```ts
calls: new Map<string, Call>(),
transcriptLines: new Map<string, TranscriptLine>(),
callQueue: new Map<string, QueueEntry>(),
carrierBlocks: new Map<string, CarrierBlock>(),
```

---

## 4. New Backend Files

### 4a. WebSocket Server — `src/api/services/ws.ts`

Wire a WebSocket server into the **existing** Express HTTP server. Do not create a second HTTP server.

```ts
// How to attach — modify src/api/server.ts after app.listen():
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ server: httpServer });
```

The WS server:
- Requires auth on `connection` (check the session cookie; reject unauthenticated connections)
- Scopes all messages to the connecting user's `practiceId` — never broadcast across practices
- Exports a `broadcast(practiceId: string, event: WsEvent)` function used by other services

```ts
// src/types/ws.ts
export type WsEvent =
  | { type: 'call.started';       data: { call: Call } }
  | { type: 'call.state_changed'; data: { callId: string; state: CallState; activeAgent: ActiveAgent | null } }
  | { type: 'transcript.line';    data: TranscriptLine }
  | { type: 'call.ended';         data: { callId: string; outcome: CallOutcome; notes: string | null } }
  | { type: 'queue.updated';      data: { queue: QueueEntry[] } }
  | { type: 'carrier.blocked';    data: { block: CarrierBlock; affectedQueueCount: number } }
  | { type: 'carrier.unblocked';  data: { carrierId: CarrierId } };
```

### 4b. Vapi Webhook Handler — `src/api/routes/webhooks.ts` (extend existing file)

Add a new route to the existing `webhooksRouter`:

```
POST /api/webhooks/vapi
```

**Vapi sends these event types. Handle all of them:**

| Vapi event | Action |
|---|---|
| `call-started` | Create `Call` record, state → `dialing`, broadcast `call.started` |
| `call-ended` | Update state → `completed` or `failed`, set `endedAt`, run outcome classifier, broadcast `call.ended` |
| `transcript` | Append `TranscriptLine`, detect CARRIER_BLOCK signals, broadcast `transcript.line` |
| `function-call` | Agent tool call — handle agent handoffs (update `activeAgent`), broadcast `call.state_changed` |
| `hang` | Emergency hang — treat as `failed`, trigger CARRIER_BLOCK if applicable |

**Vapi webhook verification:** Vapi signs requests with a secret in `config.vapi.webhookSecret`. Verify the `x-vapi-signature` header using HMAC-SHA256. Reject with 403 if verification fails in production. In development, skip if secret is not set.

Add to `src/api/config.ts`:
```ts
vapi: {
  apiKey: process.env.VAPI_API_KEY ?? '',
  webhookSecret: process.env.VAPI_WEBHOOK_SECRET ?? '',
  phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID ?? '',
}
```

**CARRIER_BLOCK detection in transcripts:** Scan each incoming transcript chunk for these phrases (case-insensitive):
```
'automated', 'bot', 'system detected', 'not a live agent',
'cannot process automated', 'fraud detection', 'call flagged'
```
If matched, immediately call `carrierBlockService.block(carrierId, callId, excerpt)`.

### 4c. CARRIER_BLOCK Service — `src/api/services/carrierBlock.ts`

```ts
export const carrierBlockService = {
  // Called on detection. Atomically:
  // 1. Creates CarrierBlock record
  // 2. Ends the active call immediately (calls Vapi API to hang up)
  // 3. Sets heldForCarrierBlock=true on all queued claims for this carrier
  // 4. Broadcasts carrier.blocked to the practice's WS clients
  block(carrierId: CarrierId, callId: string, reason: string): Promise<void>,

  // Called by front desk UI. Atomically:
  // 1. Sets clearedAt + clearedByStaffId on CarrierBlock
  // 2. Moves held queue entries back to active (heldForCarrierBlock=false)
  // 3. Broadcasts carrier.unblocked
  clear(carrierId: CarrierId, staffId: string): Promise<void>,

  // Returns active block for a carrier, or null
  getActiveBlock(carrierId: CarrierId): CarrierBlock | null,

  // Returns true if any active block exists for this carrier
  isBlocked(carrierId: CarrierId): boolean,
}
```

### 4d. Queue Engine — `src/api/services/queueEngine.ts`

The queue engine is a singleton that runs on a 60-second tick.

```ts
export const queueEngine = {
  start(): void,   // begin the 60s tick
  stop(): void,    // stop the tick (for tests)
  pause(): void,   // front desk pauses queue
  resume(): void,  // front desk resumes queue

  // Add a claim to the queue. Validates business rules before enqueuing:
  // - Rejects if claim age < 30 days
  // - Rejects if claim age > 90 days (routes to escalation instead)
  // - Rejects if carrier is currently blocked
  enqueue(entry: Omit<QueueEntry, 'id' | 'addedAt' | 'attemptsMade'>): Promise<'enqueued' | 'rejected_too_new' | 'rejected_too_old' | 'rejected_blocked'>,

  // Reorder: set priority value on a queue entry
  setPriority(entryId: string, priority: number): void,

  // Remove from queue (front desk manually removes)
  remove(entryId: string): void,
}
```

**Tick logic (runs every 60s):**
1. Check if current time is Mon–Fri 8am–5pm Eastern. If not, do nothing.
2. Check if queue is paused. If so, do nothing.
3. If a call is already active, do nothing (one call at a time).
4. Get the next `QueueEntry` sorted by `priority ASC, addedAt ASC` where `heldForCarrierBlock = false` and `scheduledAfter <= now`.
5. Check `carrierBlockService.isBlocked(entry.carrierId)`. If blocked, skip.
6. Call `vapiService.startCall(entry)`.

Start the queue engine in `src/api/server.ts` after the server starts listening.

### 4e. Vapi Service — `src/api/services/vapiService.ts`

Thin wrapper around the Vapi REST API.

```ts
export const vapiService = {
  // POST https://api.vapi.ai/call/phone
  // Sends tokenized claim data only (claimId UUID, carrierId, amountClaimed)
  // Never sends patient name, DOB, health card number
  startCall(entry: QueueEntry): Promise<{ vapiCallId: string }>,

  // POST https://api.vapi.ai/call/{id}/end
  endCall(vapiCallId: string): Promise<void>,

  // POST https://api.vapi.ai/call/{id}/transfer  (for human takeover)
  // Uses Twilio warm transfer to front desk phone number
  transferToHuman(vapiCallId: string, toPhoneNumber: string): Promise<void>,
}
```

### 4f. Outcome Classifier — `src/api/services/outcomeClassifier.ts`

Maps the Vapi call result + transcript to a structured `CallOutcome`. Called inside the `call-ended` webhook handler.

```ts
export function classifyOutcome(
  vapiEndReason: string,
  transcript: TranscriptLine[]
): { outcome: CallOutcome; notes: string } 
```

Mapping rules:

| Condition | Outcome |
|---|---|
| Vapi end reason contains "completed" AND transcript contains "payment processing" / "approved" / "adjudicated" | `approved` |
| Transcript contains "pending" / "processing" / "21 days" | `pending_adjudication` |
| Transcript contains "voicemail" OR call duration < 30s | `voicemail` |
| Transcript contains "pre-authorization" / "missing" / "documentation required" | `denied_missing_docs` |
| Transcript contains "error" / "incorrect" / "resubmit" | `denied_carrier_error` |
| `activeAgent` never advanced past `IVR_Navigator` | `ivr_failure` |
| `takenOverByStaffId` is set | `human_takeover` |
| `state` was set to `carrier_blocked` | `carrier_blocked` |
| Fallback | `ivr_failure` |

After classification, update the `Call` record and — if outcome is `denied_missing_docs`, `denied_carrier_error`, or attempt 3 failed — create an escalation via the CollectRx MCP `resolve_escalation` endpoint.

### 4g. New API Routes — `src/api/routes/calls.ts`

Mount at `src/api/server.ts` as `/api/calls`.

```
GET  /api/calls/:practiceId/active          → current active call + transcript
GET  /api/calls/:practiceId/queue           → ordered queue entries
GET  /api/calls/:practiceId/history         → paginated call history
POST /api/calls/:practiceId/queue/pause     → pause the queue
POST /api/calls/:practiceId/queue/resume    → resume the queue
POST /api/calls/:practiceId/queue/:id/priority  → { priority: number }
DELETE /api/calls/:practiceId/queue/:id     → remove from queue

POST /api/calls/:practiceId/active/pause-agent    → pause active Vapi call
POST /api/calls/:practiceId/active/end-call       → end active Vapi call
POST /api/calls/:practiceId/active/takeover       → { phoneNumber: string } → warm transfer

GET  /api/calls/:practiceId/carriers/status       → all 6 carriers + block status
POST /api/calls/:practiceId/carriers/:id/unblock  → clear a CARRIER_BLOCK (staff only)
```

All routes: `authenticate` + `authorizePractice` middleware. Role check: `front_desk` and `practice_owner` only.

---

## 5. Frontend — New Components

The front desk UI adds three new top-level views to the existing React app. The existing `Dashboard.tsx` is shown to `practice_owner`. Front desk lands on `LiveConsole` as their home screen.

### 5a. Role-Based Routing

In the app's router (wherever tab/page switching currently lives), add a role check:

```ts
// If role === 'front_desk', default route → /console
// If role === 'practice_owner', default route → /dashboard (existing)
// front_desk cannot navigate to /dashboard, /analytics, or /settings
```

### 5b. `LiveConsole.tsx` — `src/frontend/components/LiveConsole.tsx`

This is the front desk's home screen. Three columns:

**Left sidebar (fixed width ~220px):**
- Carrier status grid: 6 carriers, each showing `Open` / `On call` / `⛔ Blocked`. Clicking a blocked carrier opens the block detail modal.
- Call queue list: ordered entries showing claimRef, carrier, amount. Priority up/down buttons. A "Queue Paused" badge + Pause/Resume toggle button.

**Center (flex-1):**
- If a call is active: the active call card (see below).
- If no call is active: an idle state showing next scheduled call and queue count.

**Active call card contains:**
1. Header: carrier badge, claimRef, amount, attempt number (e.g. "Attempt 1 of 3"), live call duration timer.
2. Agent squad progress bar: four steps (`IVR_Navigator → Claims_Agent → Escalation_Closer → Resolution_Closer`). Current agent highlighted, completed steps marked with ✓.
3. Live transcript feed: scrolling list of `TranscriptLine` items, styled by speaker — agent lines in blue, carrier lines in purple, system events in grey italic.
4. Intervention row: `[⏸ Pause Agent]` `[📵 End Call]` `[📞 Take Over Call]` `[🔊 Listen]` `[📄 View Claim]`.
5. Takeover panel (shown after clicking Take Over): phone number input + `[Transfer Now]` button + `[Cancel]`.

**CARRIER_BLOCK alert (full-width, above all content when active):**  
Red banner showing carrier name, "All calls to this carrier suspended", number of claims moved to hold, and a `[Review & Clear]` button. The alert persists until staff explicitly clears it.

**WebSocket connection:** Connect on mount. Reconnect with exponential backoff (500ms, 1s, 2s, 4s, cap 30s). Handle all `WsEvent` types:
- `call.started` → show active call card, start timer
- `call.state_changed` → update squad progress bar + call state
- `transcript.line` → append to transcript feed (auto-scroll to bottom)
- `call.ended` → show outcome, clear active call card after 3s, trigger queue refresh
- `queue.updated` → refresh queue sidebar
- `carrier.blocked` → show CARRIER_BLOCK alert, refresh carrier status grid
- `carrier.unblocked` → dismiss alert, refresh

### 5c. `CallHistory.tsx` — `src/frontend/components/CallHistory.tsx`

Paginated table of past calls. Columns: outcome badge, claimRef, carrier, amount, timestamp, duration, which agent resolved it, action buttons.

Action buttons per row:
- `[📄 Transcript]` → opens transcript modal
- `[🔊 Recording]` → opens Vapi recording URL in new tab (show only if recording URL exists)
- `[Retry Now]` — shown only for `voicemail` outcome — re-enqueues the claim at top priority
- `[▶ Unpause]` — shown only for `paused_by_staff` state
- `[View Escalation]` — shown only for `denied_*` outcomes

Filters: carrier dropdown, outcome dropdown, date range.

### 5d. Carrier Block Detail Modal

Shown when staff clicks a blocked carrier in the sidebar or the CARRIER_BLOCK alert.

Contents:
- Carrier name + block timestamp
- Transcript excerpt that triggered detection (highlight the flagged phrase)
- Number of claims currently held
- `[Clear Block & Resume Calls]` button → calls `POST /api/calls/:practiceId/carriers/:id/unblock` → dismisses modal

---

## 6. Environment Variables to Add

```env
VAPI_API_KEY=
VAPI_WEBHOOK_SECRET=
VAPI_PHONE_NUMBER_ID=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

Add all to `src/api/config.ts` under `config.vapi` and `config.twilio`. Never log these values.

---

## 7. Build Order

Implement in this order. Each step unblocks the next.

1. **Types** — add `src/types/calls.ts` and `src/types/ws.ts` and extend `src/api/db.ts` with new Maps.
2. **Config** — add Vapi + Twilio keys to `src/api/config.ts`.
3. **CARRIER_BLOCK service** — `src/api/services/carrierBlock.ts`. No external dependencies, easy to test in isolation.
4. **Vapi service** — `src/api/services/vapiService.ts`. Thin HTTP wrapper.
5. **Queue engine** — `src/api/services/queueEngine.ts`. Depends on carrierBlock + vapiService.
6. **Outcome classifier** — `src/api/services/outcomeClassifier.ts`. Pure function, no dependencies.
7. **WebSocket server** — `src/api/services/ws.ts`. Attach to HTTP server in `server.ts`.
8. **Vapi webhook handler** — extend `src/api/routes/webhooks.ts`. Depends on all services + WS.
9. **Calls API routes** — `src/api/routes/calls.ts`. Mount in `server.ts`.
10. **Frontend: role-based routing** — modify existing router.
11. **Frontend: `LiveConsole.tsx`** — build with mock WS data first, wire real WS last.
12. **Frontend: `CallHistory.tsx`** — straightforward data table.
13. **Frontend: Carrier Block Modal** — component used by LiveConsole.

---

## 8. What Front Desk Cannot See or Do

These must be enforced at both the API layer (middleware role check) and the UI layer (routes simply don't render for `front_desk`):

- `/dashboard` — the existing analytics dashboard (practice_owner only)
- Aging report, carrier performance stats
- Practice settings / configuration
- Queue `build` and `run` controls (platform_admin break-glass only)
- Any data from other practices

The nav for a `front_desk` session has exactly three items: **Console**, **History**, and their **Profile/Logout**. Nothing else renders.

---

## 9. Testing Checklist

Before marking any service complete, verify:

- [ ] CARRIER_BLOCK: trigger detection mid-call → active call ends, queue entries for that carrier move to held, WS alert fires, other carriers unaffected
- [ ] Queue engine: claim < 30 days → rejected; claim > 90 days → escalation, not queue
- [ ] Queue engine: outside 8am–5pm ET → tick fires but no call starts
- [ ] PHI boundary: log Vapi API request body → confirm no patient name, DOB, or health card number present
- [ ] WebSocket: disconnect mid-call → reconnect → state resumes correctly from DB (not from memory)
- [ ] Attempt cap: simulate 3 failures on same claim → escalation created, claim removed from queue
- [ ] Human takeover: `POST /active/takeover` → Vapi gets transfer request, call logged as `human_takeover`
- [ ] Role gate: `front_desk` JWT hitting `/dashboard` → 403

---

*End of brief. Questions → Khalid Egeh (khalidegeh97@gmail.com)*
