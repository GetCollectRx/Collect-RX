# CollectRx — Full Platform Build Brief (All Personas)

**For:** Cursor / Developer Implementation  
**Prepared by:** Khalid Egeh (via Claude Cowork)  
**Date:** 2026-05-24  
**Status:** Authoritative — supersedes `front-desk-build-brief.md` and `practice-owner-build-brief.md`

---

## 0. What This Is

CollectRx is an AI-driven dental insurance collections platform. A squad of four Vapi voice agents calls Canadian insurance carriers on behalf of dental practices — navigating IVRs, speaking with reps, and resolving outstanding claims. Humans interact with the system for oversight, escalations, configuration, and reporting.

This brief specifies everything that needs to be built: backend infrastructure, all five role-based UIs, and the logic that connects them. It is written for a developer working in Cursor and assumes familiarity with the existing codebase.

### The Five Personas

| Role | Who | Scope | Phase |
|------|-----|-------|-------|
| `front_desk` | Reception / admin staff | Own practice | Now |
| `practice_owner` | Dentist / business owner | Own practice | Now |
| `auditor` | Accountant / investor / compliance | Granted practices (read-only) | Now |
| `billing_ops_manager` | HQ-level supervisor | All practices | Phase 2 (build now, activate on expansion) |
| `platform_admin` | Technical steward | All practices (with grants) | Phase 2 (build now, activate on expansion) |

---

## 1. What Already Exists — Do Not Re-Create

| What | Where | Notes |
|------|-------|-------|
| Express server | `src/api/server.ts` | Add to it, don't replace |
| In-memory DB (Maps) | `src/api/db.ts` | Add new Maps |
| Auth middleware | `src/api/middleware/authenticate.ts` | Update role strings |
| Practice-scope middleware | `src/api/middleware/authorize.ts` | Update role strings |
| Joi validation middleware | `src/api/middleware/validate.ts` | Add new schemas |
| Webhook router (Stripe + SendGrid) | `src/api/routes/webhooks.ts` | Add Vapi route here |
| Practices router | `src/api/routes/practices.ts` | Add new routes here |
| Patients router | `src/api/routes/patients.ts` | No changes needed |
| Auth router | `src/api/routes/auth.ts` | Update role strings |
| Dashboard component | `src/frontend/components/Dashboard.tsx` | Wire to real data |
| Practice type | `src/types/practice.ts` | Extend |
| Auth/role types | `src/types/auth.ts` | Replace role enum |
| Config | `src/api/config.ts` | Add Vapi + Twilio |

**There is currently no WebSocket server, no Vapi webhook handler, no call-related data, and no role-specific routing in the frontend.**

---

## 2. Non-Negotiable Business Rules

Hardcoded constraints. Every service and route that touches calls or queue must enforce these.

1. **PHI Boundary** — PHI (patient names, DOBs, health card numbers) never reaches Vapi. The squad receives UUID tokens only. Detokenize on the backend after call completion. Never log PHI in any service that touches Vapi.

2. **CARRIER_BLOCK** — If a carrier detects automation, suspend ALL calls to that carrier immediately — not just the current call. This is the most critical operational safety rule. Any code path that touches call scheduling or Vapi must check `carrierBlockService.isBlocked(carrierId)` before proceeding.

3. **Call window** — Calls only Mon–Fri 8am–5pm Eastern. Queue engine does not fire outside this window. Practice owners can narrow this window in settings but cannot widen it.

4. **Attempt cap** — Maximum 3 call attempts per claim. After the 3rd failure, auto-escalate. Never retry beyond 3.

5. **Age gates** — Claims under 30 days: reject from queue. Claims over 90 days: skip AI, route directly to human escalation. TELUS AdjudiCare exception: minimum age is 21 days (vs. 32 for all other carriers).

6. **TELUS identification** — Before routing any call to TELUS AdjudiCare, identify the underlying TPA from the group number prefix via the practice's `telusTpaMappings` config. Do not call TELUS without this step.

7. **Privacy-first admin access** — Platform admins cannot access individual claim or patient-level data at a practice unless the practice owner has explicitly granted access via a `platform_admin_practice_grants` record.

---

## 3. Role System — Align This First

**Update `src/types/auth.ts` completely:**

```ts
export type UserRole =
  | 'front_desk'            // was 'staff'
  | 'practice_owner'        // was 'practice_admin'
  | 'auditor'               // new
  | 'billing_ops_manager'   // new — Phase 2
  | 'platform_admin';       // unchanged

export interface JWTPayload {
  userId: string;
  role: UserRole;
  practiceId: string | null; // null for billing_ops_manager, platform_admin
}

export interface LoginRequest {
  practiceId: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  practiceId: string;
  practiceName: string;
  role: UserRole;
}
```

Find-and-replace across the entire codebase:
- `'practice_admin'` → `'practice_owner'`
- `'staff'` → `'front_desk'`

Files to update: `authenticate.ts`, `authorize.ts`, `auth.ts` (route), `seed.ts` (if present).

### Access Control Matrix

Legend: ✅ Full · 👁 Read-only · 🏥 Own practice · 🔐 With grant · 🚨 Break-glass · ❌ None

| Resource | `front_desk` | `practice_owner` | `auditor` | `billing_ops_manager` | `platform_admin` |
|---|:---:|:---:|:---:|:---:|:---:|
| `list_claims` | 🏥 | 🏥 | ❌ | 👁 All | 🔐 |
| `get_claim` | 🏥 | 🏥 | ❌ | 👁 All | 🔐 |
| `pause_claim` | 🏥 | 🏥 | ❌ | ✅ All | 🔐 |
| `unpause_claim` | 🏥 | 🏥 | ❌ | ✅ All | 🔐 |
| `list_escalations` | 🏥 | 🏥 | ❌ | ✅ All | 🔐 |
| `resolve_escalation` | 🏥 | 🏥 | ❌ | ✅ All | 🔐 |
| `get_aging_report` | ❌ | 🏥 | 👁 (scoped) | ✅ All | ✅ All |
| `get_carrier_stats` | ❌ | 🏥 | 👁 (scoped) | ✅ All | ✅ All |
| `get_queue_stats` | ❌ | 🏥 | 👁 (scoped) | ✅ All | ✅ All |
| `update_practice` | ❌ | 🏥 | ❌ | ❌ | ✅ All |
| `list_practices` | ❌ | ❌ | ❌ | 👁 All | 👁 All |
| `build_queue` | ❌ | ❌ | ❌ | ❌ | 🚨 |
| `run_queue` | ❌ | ❌ | ❌ | ❌ | 🚨 |
| Live Console | ✅ | ❌ | ❌ | ❌ | ❌ |
| Practice Settings | ❌ | ✅ | ❌ | ❌ | ✅ All |

---

## 4. Database — New Types and Maps

### 4a. New Types File — `src/types/calls.ts`

```ts
export type CarrierId =
  | 'sun_life'
  | 'canada_life'
  | 'manulife'
  | 'green_shield'
  | 'rbc_insurance'
  | 'telus_adjudicare';

export const CARRIER_NAMES: Record<CarrierId, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc_insurance: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
};

export const CARRIER_MIN_AGE_DAYS: Record<CarrierId, number> = {
  sun_life: 32, canada_life: 32, manulife: 32,
  green_shield: 32, rbc_insurance: 32,
  telus_adjudicare: 21,  // TELUS exception
};

export type CallState =
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
  id: string;
  practiceId: string;
  claimId: string;
  claimRef: string;              // e.g. "CRX-4821" — display label
  carrierId: CarrierId;
  attemptNumber: number;         // 1 | 2 | 3
  state: CallState;
  activeAgent: ActiveAgent | null;
  vapiCallId: string | null;
  outcome: CallOutcome | null;
  outcomeNotes: string | null;
  amountClaimed: number;         // cents
  startedAt: string | null;
  endedAt: string | null;
  pausedByStaffAt: string | null;
  pausedByStaffId: string | null;
  takenOverByStaffAt: string | null;
  takenOverByStaffId: string | null;
  createdAt: string;
}

export interface TranscriptLine {
  id: string;
  callId: string;
  speaker: 'agent' | 'carrier' | 'system';
  agentName: ActiveAgent | null;
  text: string;
  timestamp: string;
}

export interface QueueEntry {
  id: string;
  practiceId: string;
  claimId: string;
  claimRef: string;
  carrierId: CarrierId;
  amountClaimed: number;         // cents
  priority: number;              // lower = higher; default 100
  attemptsMade: number;
  heldForCarrierBlock: boolean;
  heldReason: string | null;
  scheduledAfter: string | null; // ISO — do not call before this
  addedAt: string;
}

export type EscalationResolution =
  | 'resolved'
  | 'appealing'
  | 'written_off'
  | 'paused_for_review';

export interface Escalation {
  id: string;
  practiceId: string;
  callId: string;
  claimId: string;
  claimRef: string;
  carrierId: CarrierId;
  amountClaimed: number;         // cents
  reason: string;
  status: 'open' | 'resolved';
  resolution: EscalationResolution | null;
  resolvedByStaffId: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
}

export interface CarrierBlock {
  id: string;
  practiceId: string;
  carrierId: CarrierId;
  blockedAt: string;
  blockedByCallId: string;
  clearedAt: string | null;
  clearedByStaffId: string | null;
  reason: string;                // transcript excerpt
}
```

### 4b. New Types File — `src/types/ws.ts`

```ts
import type { Call, CallState, ActiveAgent, CallOutcome, TranscriptLine, QueueEntry, CarrierBlock, CarrierId } from './calls';

export type WsEvent =
  | { type: 'call.started';       data: { call: Call } }
  | { type: 'call.state_changed'; data: { callId: string; state: CallState; activeAgent: ActiveAgent | null } }
  | { type: 'transcript.line';    data: TranscriptLine }
  | { type: 'call.ended';         data: { callId: string; outcome: CallOutcome; notes: string | null } }
  | { type: 'queue.updated';      data: { queue: QueueEntry[] } }
  | { type: 'carrier.blocked';    data: { block: CarrierBlock; affectedQueueCount: number } }
  | { type: 'carrier.unblocked';  data: { carrierId: CarrierId } };
```

### 4c. Extend `src/types/practice.ts`

```ts
import type { CarrierId } from './calls';

// Extend existing PracticeSettings:
export interface CarrierConfig {
  carrierId: CarrierId;
  enabled: boolean;
  minimumClaimAgeDays: number;  // min 21 for TELUS, min 32 for others
  maxAttempts: number;          // 1–3
  callWindowStart: string;      // 'HH:MM' Eastern, cannot be before '08:00'
  callWindowEnd: string;        // 'HH:MM' Eastern, cannot be after '17:00'
  notes: string;
}

export interface PracticeSettings {
  // Existing — keep
  emailsEnabled: boolean;
  automationEnabled: boolean;
  sendFromPracticeEmail: boolean;
  // New — voice agent
  voiceAgentEnabled: boolean;
  carrierConfigs: CarrierConfig[];
  callWindowStart: string;           // practice default: '08:00'
  callWindowEnd: string;             // practice default: '17:00'
  escalationPhoneNumber: string;     // Twilio warm transfer target
  telusTpaMappings: Record<string, string>; // group prefix → TPA name
}

// Add to DashboardResponse:
export interface QueueStats {
  queued: number;
  held: number;
  isPaused: boolean;
  isWithinCallWindow: boolean;
  activeCall: Pick<Call, 'id' | 'claimRef' | 'carrierId' | 'activeAgent' | 'startedAt'> | null;
  resolvedToday: number;
}

export interface AgingBucket {
  label: 'Current' | '31–60' | '61–90' | '90+';
  totalAmount: number;   // cents
  claimCount: number;
  percentOfTotal: number;
}

export interface CarrierAgingRow {
  carrierId: CarrierId;
  carrierName: string;
  current: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
}

export interface CarrierStatRow {
  carrierId: CarrierId;
  carrierName: string;
  totalClaims: number;
  successRate: number;
  avgCallDurationSeconds: number;
  avgAttempts: number;
  topDenialReason: string | null;
  trend: 'improving' | 'declining' | 'stable';
}
```

### 4d. Extend `src/api/db.ts`

Add these Maps:

```ts
import type { Call, TranscriptLine, QueueEntry, Escalation, CarrierBlock } from '../types/calls';

// Add to the db object:
calls:           new Map<string, Call>(),
transcriptLines: new Map<string, TranscriptLine>(),
callQueue:       new Map<string, QueueEntry>(),
escalations:     new Map<string, Escalation>(),
carrierBlocks:   new Map<string, CarrierBlock>(),
```

Also add a new grant table for platform admin claim access:

```ts
// In src/api/db.ts
platformAdminGrants: new Map<string, {
  id: string;
  adminId: string;
  practiceId: string;
  grantedByOwnerId: string;
  grantedAt: string;
}>(),

// And auditor scope:
auditorGrants: new Map<string, {
  id: string;
  auditorId: string;
  practiceId: string;        // or 'all' for all-practices auditor
  grantedAt: string;
}>(),
```

---

## 5. Config — Add to `src/api/config.ts`

```ts
vapi: {
  apiKey:         process.env.VAPI_API_KEY         ?? '',
  webhookSecret:  process.env.VAPI_WEBHOOK_SECRET  ?? '',
  phoneNumberId:  process.env.VAPI_PHONE_NUMBER_ID ?? '',
},
twilio: {
  accountSid:  process.env.TWILIO_ACCOUNT_SID  ?? '',
  authToken:   process.env.TWILIO_AUTH_TOKEN   ?? '',
  fromNumber:  process.env.TWILIO_FROM_NUMBER  ?? '',
},
```

Add to `.env`:
```
VAPI_API_KEY=
VAPI_WEBHOOK_SECRET=
VAPI_PHONE_NUMBER_ID=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

Never log these values.

---

## 6. Shared Backend Services

### 6a. WebSocket Server — `src/api/services/ws.ts`

Attach to the existing HTTP server in `src/api/server.ts`. Do not create a second server.

```ts
// In server.ts, after app.listen():
import { WebSocketServer } from 'ws';
import { initWss } from './services/ws';
const httpServer = app.listen(config.port, ...);
initWss(httpServer);
```

The WS service:
- Authenticates the connecting user by reading their session cookie/JWT on `connection`. Reject unauthenticated connections with code 4001.
- Stores connected clients keyed by `practiceId`. `billing_ops_manager` and `platform_admin` clients receive events for all practices.
- Exports `broadcast(practiceId: string, event: WsEvent): void` — sends to all clients scoped to that practice, plus any cross-practice roles.
- Client reconnect is the frontend's responsibility (exponential backoff: 500ms → 1s → 2s → 4s, cap 30s).

### 6b. Vapi Service — `src/api/services/vapiService.ts`

Thin wrapper around the Vapi REST API.

```ts
export const vapiService = {
  // POST https://api.vapi.ai/call/phone
  // IMPORTANT: only send tokenized data — claimId UUID, carrierId, amountClaimed
  // Never include patient name, DOB, or health card number
  startCall(entry: QueueEntry): Promise<{ vapiCallId: string }>,

  // POST https://api.vapi.ai/call/{vapiCallId}/end
  endCall(vapiCallId: string): Promise<void>,

  // Twilio warm transfer to front desk escalation number
  // Vapi holds the carrier line during transfer
  transferToHuman(vapiCallId: string, toPhoneNumber: string): Promise<void>,
}
```

### 6c. CARRIER_BLOCK Service — `src/api/services/carrierBlock.ts`

```ts
export const carrierBlockService = {
  // Called on automation detection. Atomically:
  // 1. Creates CarrierBlock record in db.carrierBlocks
  // 2. Ends the active Vapi call immediately
  // 3. Sets heldForCarrierBlock=true + heldReason on all queued entries for this carrier
  // 4. Broadcasts carrier.blocked to all clients scoped to this practice
  block(practiceId: string, carrierId: CarrierId, callId: string, reason: string): Promise<void>,

  // Called when staff clears the block. Atomically:
  // 1. Sets clearedAt + clearedByStaffId on CarrierBlock record
  // 2. Resets heldForCarrierBlock=false on held queue entries for this carrier
  // 3. Broadcasts carrier.unblocked
  clear(practiceId: string, carrierId: CarrierId, staffId: string): Promise<void>,

  isBlocked(practiceId: string, carrierId: CarrierId): boolean,
  getActiveBlock(practiceId: string, carrierId: CarrierId): CarrierBlock | null,
}
```

### 6d. Queue Engine — `src/api/services/queueEngine.ts`

Singleton. Runs on a 60-second tick. Start it in `server.ts` after the server starts listening.

```ts
export const queueEngine = {
  start(): void,
  stop(): void,   // for tests
  pause(practiceId: string): void,
  resume(practiceId: string): void,

  // Validates all business rules before adding to queue:
  // - Rejects if claim age < CARRIER_MIN_AGE_DAYS[carrierId]
  // - Rejects if claim age > 90 days (creates Escalation instead)
  // - Rejects if carrier is blocked for this practice
  enqueue(entry: Omit<QueueEntry, 'id' | 'addedAt' | 'attemptsMade'>):
    Promise<'enqueued' | 'rejected_too_new' | 'escalated_too_old' | 'rejected_blocked'>,

  setPriority(entryId: string, priority: number): void,
  remove(entryId: string): void,
}
```

**Tick logic:**
1. For each practice with queued entries:
   a. Check if current time is Mon–Fri within practice `callWindowStart`–`callWindowEnd` Eastern. If not, skip.
   b. Check if queue is paused for this practice. If so, skip.
   c. Check if a call is already active for this practice. If so, skip (one call at a time per practice).
   d. Get next entry: `heldForCarrierBlock = false`, `scheduledAfter <= now`, sorted by `priority ASC, addedAt ASC`.
   e. Check `carrierBlockService.isBlocked(practiceId, carrierId)`. If blocked, move to held and skip.
   f. Call `vapiService.startCall(entry)`.

### 6e. Outcome Classifier — `src/api/services/outcomeClassifier.ts`

Pure function. No side effects.

```ts
export function classifyOutcome(
  vapiEndReason: string,
  transcript: TranscriptLine[],
  call: Call
): { outcome: CallOutcome; notes: string }
```

Classification rules (evaluate in order, first match wins):

| Condition | Outcome |
|-----------|---------|
| `call.takenOverByStaffId` is set | `human_takeover` |
| `call.state === 'carrier_blocked'` | `carrier_blocked` |
| Transcript contains "payment processing" / "approved" / "adjudicated" | `approved` |
| Transcript contains "pending" / "processing" / "under review" | `pending_adjudication` |
| Transcript contains "pre-authorization" / "missing documentation" / "additional info" | `denied_missing_docs` |
| Transcript contains "error" / "incorrect" / "resubmit" / "invalid" | `denied_carrier_error` |
| Call duration < 30s OR transcript contains "voicemail" / "leave a message" | `voicemail` |
| `activeAgent` never advanced past `IVR_Navigator` | `ivr_failure` |
| Transcript contains "wrong number" / "not a dental" | `wrong_number` |
| Fallback | `ivr_failure` |

After classifying, create an `Escalation` record if outcome is `denied_missing_docs`, `denied_carrier_error`, or if `attemptNumber === 3` and outcome is not `approved`.

### 6f. Vapi Webhook Handler — extend `src/api/routes/webhooks.ts`

```
POST /api/webhooks/vapi
```

Verify the `x-vapi-signature` HMAC-SHA256 header against `config.vapi.webhookSecret`. Reject 403 in production if verification fails.

| Vapi event | Handler action |
|---|---|
| `call-started` | Create `Call` record (state: `dialing`), broadcast `call.started` |
| `transcript` | Append `TranscriptLine`, scan for CARRIER_BLOCK phrases (see below), broadcast `transcript.line` |
| `function-call` where fn = `agent_handoff` | Update `call.activeAgent`, update `call.state`, broadcast `call.state_changed` |
| `call-ended` | Update state → `completed`/`failed`, run `classifyOutcome`, update outcome, broadcast `call.ended` |
| `hang` | Treat as `failed`, trigger CARRIER_BLOCK if active agent signalled it |

**CARRIER_BLOCK detection phrases** (case-insensitive, scan every transcript line):
```
'automated call', 'bot detected', 'system detected', 'not a live agent',
'cannot process automated', 'fraud detection', 'call has been flagged',
'robocall', 'automated system'
```
On match: call `carrierBlockService.block(...)` immediately. Do not wait for `call-ended`.

---

## 7. API Routes

All routes require `authenticate` middleware. Scope enforcement is noted per route.

### 7a. Calls — new file `src/api/routes/calls.ts`, mount at `/api/calls`

```
GET    /:practiceId/active                → active call + last 50 transcript lines
GET    /:practiceId/queue                 → ordered queue entries (excl. held)
GET    /:practiceId/queue/held            → carrier-blocked held entries
GET    /:practiceId/history               → paginated call history (?page&limit&carrierId&outcome)
GET    /:practiceId/escalations           → escalations (?status=open|resolved)
PUT    /:practiceId/escalations/:id       → { resolution, notes } — update escalation

POST   /:practiceId/queue/pause           → pause queue engine for this practice
POST   /:practiceId/queue/resume          → resume queue engine
PATCH  /:practiceId/queue/:id/priority    → { priority: number }
DELETE /:practiceId/queue/:id             → remove from queue

POST   /:practiceId/active/pause-agent    → pause active Vapi call
POST   /:practiceId/active/end-call       → end active Vapi call
POST   /:practiceId/active/takeover       → { phoneNumber } → warm Twilio transfer

GET    /:practiceId/carriers              → all 6 carriers + block status for this practice
POST   /:practiceId/carriers/:id/unblock  → clear CARRIER_BLOCK (staff clears)
```

**Role gates:**
- `/active/*` (intervention routes): `front_desk` and `practice_owner` only
- `/queue/pause`, `/queue/resume`: `front_desk` and `practice_owner` only
- `PUT /escalations/:id`: `front_desk`, `practice_owner`, `billing_ops_manager`
- All GET routes: all roles except `auditor`

For `billing_ops_manager`, drop the `authorizePractice` middleware and allow cross-practice reads.

### 7b. Reports — add to `src/api/routes/practices.ts`

```
GET /:practiceId/reports/aging     → AgingBucket[] + CarrierAgingRow[] (?timeframe=30d|90d|all)
GET /:practiceId/reports/carriers  → CarrierStatRow[] + CarrierBlock[] history
GET /:practiceId/reports/queue     → QueueStats (snapshot, not real-time)
```

**Role gates:** `practice_owner`, `auditor` (scoped), `billing_ops_manager`, `platform_admin`.  
`front_desk`: 403 on all report routes.

For `auditor`: check `db.auditorGrants` before returning data. If the auditor's grant is for a specific practice, enforce it. If grant is `'all'`, allow.

**Aging report computation:** Group calls by `carrierId` and compute `daysBetween(call.createdAt, now)`. Bucket assignments: 0–30 → Current, 31–60, 61–90, 91+ → 90+. Include all calls with `outcome` of `null` (pending), `pending_adjudication`, or `denied_*`. Exclude `approved`, `written_off`.

**Carrier stats trend:** Compare success rate for the practice in the last 30 days vs. the 30 days before. `> +3%` → `improving`, `< -3%` → `declining`, else `stable`.

### 7c. Settings — add to `src/api/routes/practices.ts`

```
GET /:practiceId/settings           → full PracticeSettings (excl. stripeConnectAccountId)
PUT /:practiceId/settings           → update PracticeSettings
```

**Role gates:** GET: `practice_owner`, `platform_admin`. PUT: `practice_owner` (own practice only), `platform_admin` (any practice).

**PUT validation** (add `schemas.updateSettings` to `validate.ts`):
- `callWindowStart` must be ≥ `'08:00'` and < `callWindowEnd`
- `callWindowEnd` must be ≤ `'17:00'`
- Each `CarrierConfig.minimumClaimAgeDays`: ≥ 21 for `telus_adjudicare`, ≥ 32 for all others
- `escalationPhoneNumber`: valid E.164 format (`/^\+[1-9]\d{7,14}$/`)
- `maxAttempts`: 1–3

### 7d. Platform Admin — new file `src/api/routes/admin.ts`, mount at `/api/admin`

```
GET    /practices                         → all practices (name, id, plan, voiceAgentEnabled)
GET    /practices/:practiceId             → full practice detail
PUT    /practices/:practiceId/settings    → update any practice settings
GET    /practices/:practiceId/grants      → list platform_admin_practice_grants for this practice
POST   /practices/:practiceId/grants      → { adminId } — grant claim access (must be called by practice_owner)
DELETE /practices/:practiceId/grants/:id  → revoke a grant

GET    /queue/stats                       → queue stats across all practices
POST   /queue/build                       → break-glass build_queue (requires { reason: string })
POST   /queue/run                         → break-glass run_queue (requires { reason: string })

GET    /users                             → all users
POST   /users                             → create user { email, role, practiceId? }
DELETE /users/:id                         → deactivate user
```

**Role gate:** All routes: `platform_admin` only.  
Break-glass routes (`/queue/build`, `/queue/run`): log to an audit table with `adminId`, `action`, `reason`, `performedAt`. Notify practice owners of affected practices via email.

Platform admin claim access: before any route that reads claims for a specific practice, check `db.platformAdminGrants` for a record matching `(adminId, practiceId)`. If no grant exists, return 403 with `{ error: 'Claim access not granted for this practice. Request access from the practice owner.' }`.

### 7e. Billing Ops Manager — add cross-practice variants

The `billing_ops_manager` uses the same routes as `practice_owner` but without `authorizePractice` scoping. Implement this via a middleware check: if `req.user.role === 'billing_ops_manager'`, skip practice scope enforcement and allow cross-practice reads.

Add one new route:
```
GET /api/reports/portfolio    → cross-practice summary (aging + carrier + queue per practice)
```
Returns an array of `{ practice: PracticePublic, aging: AgingBucket[], queueStats: QueueStats, topCarrierIssue: string | null }` for all practices. `billing_ops_manager` only.

---

## 8. Frontend — Per-Persona UIs

### Shared: Role-Based Routing

In the app's router, redirect on login based on role:

```ts
const HOME_ROUTE: Record<UserRole, string> = {
  front_desk:           '/console',
  practice_owner:       '/dashboard',
  auditor:              '/reports/aging',
  billing_ops_manager:  '/portfolio',
  platform_admin:       '/admin',
};
```

Route guards: a route component checks `useAuth().role` and redirects if the user's role is not in the route's allowed list. Implement as a `<ProtectedRoute allowedRoles={[...]} />` wrapper.

---

### 8.1 Front Desk — `role: 'front_desk'`

**Nav items:** Console · History · Escalations · Profile

#### `LiveConsole.tsx` — `/console` (home screen)

Three-column layout:

**Left sidebar (~220px):**
- Carrier status grid: 6 carriers. Each: name + `Open` / `On call` / `⛔ Blocked` badge. Clicking a blocked carrier opens the Carrier Block Modal.
- Call queue list: sorted by priority. Each row: claimRef, carrier, amount. Priority ↑/↓ buttons. Pause / Resume queue toggle.

**Center (flex-1):**
If active call:
1. Header: carrier badge · claimRef · amount · attempt number · live duration timer (tick every second from `call.startedAt`)
2. Squad progress bar: four steps `IVR_Navigator → Claims_Agent → Escalation_Closer → Resolution_Closer`. Completed = green ✓. Active = blue highlight. Pending = grey.
3. Live transcript: scrolling list of `TranscriptLine`. Agent lines blue. Carrier lines purple. System lines grey italic. Auto-scroll to bottom on new line. Cap display at 200 lines.
4. Intervention row: `[⏸ Pause Agent]` `[📵 End Call]` `[📞 Take Over]` `[🔊 Listen]` `[📄 View Claim]`
5. Takeover panel (shown after Take Over click): phone number input prefilled from `practice.settings.escalationPhoneNumber` · `[Transfer Now]` · `[Cancel]`

If no active call:
- Idle card: next scheduled claim + queue count + time until next call window opens (if outside hours).

**Full-width CARRIER_BLOCK alert** (rendered above everything when active):
- Red banner: carrier name · "All calls suspended" · affected claim count · `[Review & Clear]`
- Persists until staff explicitly clears it via the modal.

**WebSocket events to handle:**
- `call.started` → show active call card, start timer
- `call.state_changed` → update squad progress
- `transcript.line` → append to feed
- `call.ended` → show outcome chip, clear card after 3s, refresh queue sidebar
- `queue.updated` → refresh queue sidebar
- `carrier.blocked` → show alert, refresh carrier grid
- `carrier.unblocked` → dismiss alert, refresh carrier grid

Connect on mount. Reconnect with exponential backoff (500ms → 1s → 2s → 4s, cap 30s).

#### `CallHistory.tsx` — `/history`

Paginated table. Columns: outcome badge · claimRef · carrier · amount · date/time · duration · agent that resolved · actions.

Actions per row:
- `[📄 Transcript]` → modal showing full transcript
- `[🔊 Recording]` → open Vapi recording URL in new tab (only if URL exists)
- `[Retry Now]` → for `voicemail` outcome: re-enqueue at priority 1
- `[▶ Unpause]` → for `paused_by_staff` state

Filters: carrier dropdown · outcome dropdown · date range.

#### `Escalations.tsx` — `/escalations`

List of open escalations for this practice. Columns: claimRef · carrier · reason · raised date · status.

Action per row: `[Resolve]` → modal with resolution notes input + `[Mark Resolved]`.

For `front_desk` the resolution options are just: free-text notes + confirm. No appeal / write-off decision.

#### Carrier Block Modal (shared component)

Shown from the sidebar or the CARRIER_BLOCK alert.
- Carrier name · block timestamp
- Transcript excerpt (highlight the flagged phrase in red)
- Number of claims currently held
- `[Clear Block & Resume Calls]` → `POST /api/calls/:practiceId/carriers/:id/unblock` → dismiss modal

---

### 8.2 Practice Owner — `role: 'practice_owner'`

**Nav items:** Dashboard · Aging Report · Carrier Stats · Escalations · Settings · Profile

#### `Dashboard.tsx` — `/dashboard` (existing, wire to real data)

Replace all static arrays at the top of the component with `useEffect` + `fetch` calls:

- Metrics row → `GET /api/practices/:practiceId/dashboard`
- Recent Calls panel → `GET /api/calls/:practiceId/history?limit=5`
- Pending Claims panel → `GET /api/calls/:practiceId/escalations?status=open&limit=5`
- Weekly chart → compute from dashboard response (calls per day, approved per day)

Remove the "Start New Call" button from Quick Actions — practice owners don't trigger calls manually.

Add a `QueueOverview` panel (read-only): queue status badge · queued / held counts · active call summary if one is running · "X resolved today". Connect to the same WebSocket for live updates. No intervention controls — watch only.

#### `AgingReport.tsx` — `/reports/aging`

Data: `GET /api/practices/:practiceId/reports/aging?timeframe=30d`

Layout:
1. Four summary cards (one per bucket): total $ · claim count · % of total AR. The 90+ card is red-bordered if amount > 0.
2. Carrier × bucket table: carriers as rows, buckets as columns, row totals right, column totals bottom.
3. Stacked horizontal bar chart (Recharts `BarChart`) showing bucket proportions of total AR.
4. `[⬇ Export CSV]` button — browser-side CSV generation, no backend needed.

Timeframe selector: Last 30 days / Last 90 days / All time. Updates on change.

#### `CarrierStats.tsx` — `/reports/carriers`

Data: `GET /api/practices/:practiceId/reports/carriers?timeframe=30d`

Layout:
1. Six carrier cards: success rate · total claims · avg call duration · avg attempts · top denial reason · trend indicator (↑ improving / ↓ declining / → stable).
2. Comparison table: carriers as rows, all metrics as columns. Sortable columns.
3. CARRIER_BLOCK history table at the bottom: carrier · blocked at · cleared at · claims held.

Timeframe selector: Last 30 days / Last 90 days / All time.

#### `Escalations.tsx` — `/escalations` (extended from front desk)

Same component as front desk but with additional columns for `practice_owner`:
- Amount at stake (formatted $)
- Attempt number when escalated
- `[📄 Transcript]` link

Additional action buttons (replace the single Resolve button):
- `[Appeal]` → sets `resolution: 'appealing'`, pauses claim
- `[Write Off]` → sets `resolution: 'written_off'`, removes from queue permanently, marks resolved
- `[Pause for Review]` → pauses claim, keeps escalation open

Gate these three buttons behind `role === 'practice_owner'` check inside the component.

#### `PracticeSettings.tsx` — `/settings`

Four sections, each with its own Save button:

**Section 1 — General (read-only)**
Name · email · phone · address · plan · monthly fee. All read-only. Editable by platform admin only.

**Section 2 — Voice Agent**
- `voiceAgentEnabled` toggle
- Global call window: time pickers for start/end (Eastern). Constrain to 08:00–17:00.
- Escalation phone number input (E.164 format)

**Section 3 — Carrier Configuration**
Table: one row per carrier. Columns: enabled toggle · min claim age (input, validated per carrier) · max attempts (1–3 select) · notes (text input). Save validates on server.

**Section 4 — TELUS TPA Mappings**
Key-value pair editor: group prefix → TPA name. Add/remove rows. Static explanatory text about why this matters.

**Section 5 — Email Automation**
Existing toggles: `emailsEnabled` · `automationEnabled` · `sendFromPracticeEmail`.

---

### 8.3 Auditor — `role: 'auditor'`

**Nav items:** Aging Report · Carrier Stats · Queue Stats · Export · Profile

Auditor sees the same Aging Report and Carrier Stats components as the practice owner, rendered in pure read-only mode: no action buttons, no drill-down links to claims, no settings access.

**Scope enforcement:** The practice selector (if the auditor has access to multiple practices) is populated from `db.auditorGrants` for this user. If they have one practice, no selector — data loads for that practice only. If they have `'all'`, a practice dropdown appears at the top of every page.

#### `QueueStats.tsx` — `/reports/queue`

Read-only snapshot: queue totals · resolution rate · automation savings. No real-time WebSocket — polling every 60s is fine for auditors.

#### Export

Each report page has `[⬇ Export CSV]` and `[⬇ Export PDF]` buttons.
- CSV: generated browser-side from the fetched data.
- PDF: `POST /api/practices/:practiceId/reports/export` → server-side PDF generation using a simple HTML-to-PDF library (e.g. `puppeteer` or `@react-pdf/renderer`). Returns a binary stream with `Content-Disposition: attachment`.

**No write access anywhere in the auditor UI.** Every button or input in shared components must be hidden or disabled when `role === 'auditor'`. Implement via a context value `const { isReadOnly } = useAuth()` where `isReadOnly = role === 'auditor'`.

---

### 8.4 Billing Ops Manager — `role: 'billing_ops_manager'` (Phase 2, build now)

**Nav items:** Portfolio · Aging (All) · Carrier Intelligence · Escalations · Claims · Profile

#### `Portfolio.tsx` — `/portfolio` (home screen)

Data: `GET /api/reports/portfolio`

A card grid — one card per practice. Each card: practice name · total AR · queue status · open escalation count · worst aging bucket. Clicking a card drills into that practice.

Practice drilldown: renders the same `AgingReport`, `CarrierStats`, and `Escalations` components but with the selected `practiceId` injected. A "← All Practices" breadcrumb navigates back.

#### Cross-Practice Aging — `/reports/aging`

Same `AgingReport` component. Add a practice multi-select filter at the top. Default: all practices. Aggregates across selected practices.

#### Cross-Practice Carrier Intelligence — `/reports/carriers`

Same `CarrierStats` component. Add a "View by carrier across all practices" toggle: when active, shows one row per carrier with data aggregated across all practices — useful for spotting systemic carrier problems.

#### Cross-Practice Escalations — `/escalations`

Same `Escalations` component, no `practiceId` scope. Adds a "Practice" column to the table. Billing ops manager has full resolve/appeal/write-off authority (same as practice owner).

---

### 8.5 Platform Admin — `role: 'platform_admin'` (Phase 2, build now)

**Nav items:** Practices · System Health · Users · Break-Glass · Profile

#### `AdminPractices.tsx` — `/admin`

List of all practices: name · plan · voice agent status · open escalation count · last call timestamp.

Clicking a practice opens a tabbed detail view:
- **Overview** — same as `QueueStats` for this practice
- **Settings** — same `PracticeSettings` component, editable by platform admin
- **Access Grants** — list of `platform_admin_practice_grants` for this practice. Shows which admins have claim access and who granted it. No self-grant — grants must be initiated and approved by the practice owner.

#### `SystemHealth.tsx` — `/admin/health`

Cross-practice queue health: calls in progress · queued per practice · CARRIER_BLOCK active incidents · Vapi error rate (last 24h from call failure rates). Auto-refresh every 30s.

#### `UserManagement.tsx` — `/admin/users`

Table of all users. Columns: email · role · practice · created · status (active/deactivated).
- `[+ New User]` → modal: email · role · practice (if front_desk or practice_owner) → `POST /api/admin/users`
- `[Deactivate]` per row → `DELETE /api/admin/users/:id`

#### `BreakGlass.tsx` — `/admin/break-glass`

Intentionally spartan UI. Two large buttons: `[Build Queue]` and `[Run Queue]`. Both require a mandatory reason text area before the button becomes active. On confirm, calls the break-glass routes and shows an audit confirmation: "Action logged. Practice owners will be notified."

#### Claim Access Gate

When a platform admin navigates to a practice's claims or escalations without a grant: show a locked state with copy: "Claim access requires approval from [Practice Name]'s owner. [Request Access]". The request button sends an email to the practice owner (via existing `EmailService`) — the owner grants access by clicking a link that calls `POST /api/admin/practices/:practiceId/grants`.

---

## 9. Build Order

Follow this sequence. Each phase unblocks the next.

### Phase A — Foundation (blocks everything)
1. Update `src/types/auth.ts` — new `UserRole` enum
2. Find-and-replace old role strings in middleware and routes
3. Add new types files: `src/types/calls.ts`, `src/types/ws.ts`
4. Extend `src/types/practice.ts`
5. Add new Maps to `src/api/db.ts`
6. Add Vapi + Twilio to `src/api/config.ts`

### Phase B — Backend Services (can be built in parallel after Phase A)
7. `src/api/services/carrierBlock.ts` — no external deps
8. `src/api/services/vapiService.ts` — HTTP wrapper only
9. `src/api/services/outcomeClassifier.ts` — pure function, no deps
10. `src/api/services/queueEngine.ts` — depends on carrierBlock + vapiService
11. `src/api/services/ws.ts` — attach to HTTP server in `server.ts`

### Phase C — API Routes (after Phase B)
12. Extend `src/api/routes/webhooks.ts` — Vapi webhook handler (depends on all services + WS)
13. New `src/api/routes/calls.ts` — all call/queue/carrier/escalation routes. Mount in `server.ts`.
14. Extend `src/api/routes/practices.ts` — reports + settings routes
15. New `src/api/routes/admin.ts` — platform admin routes. Mount in `server.ts`.

### Phase D — Frontend, Practice Owner + Front Desk (can be built in parallel after Phase C)
16. Role-based routing + `<ProtectedRoute>` + `HOME_ROUTE` map
17. Wire `Dashboard.tsx` to real data
18. `LiveConsole.tsx` — build with mock WS data first, wire real WS last
19. `CallHistory.tsx`
20. `AgingReport.tsx` + `CarrierStats.tsx`
21. `PracticeSettings.tsx`
22. `Escalations.tsx` — single component, role-conditional columns + buttons

### Phase E — Frontend, Auditor (after Phase D, shares components)
23. Auditor routing + `isReadOnly` context value
24. `QueueStats.tsx`
25. PDF export route + button

### Phase F — Frontend, Phase 2 Roles (after Phase E)
26. `Portfolio.tsx` + cross-practice data fetching
27. `AdminPractices.tsx` + `SystemHealth.tsx`
28. `UserManagement.tsx` + `BreakGlass.tsx`
29. Claim access grant flow (email + grant link)

---

## 10. Testing Checklist

### Role gates
- [ ] `front_desk` JWT → `GET /api/practices/:id/reports/aging` → 403
- [ ] `front_desk` JWT → `GET /api/admin/practices` → 403
- [ ] `practice_owner` JWT → `POST /api/calls/:id/active/takeover` → 403 (front desk only)
- [ ] `auditor` JWT → `PUT /api/practices/:id/escalations/:eid` → 403
- [ ] `platform_admin` JWT → `GET /api/calls/:id/escalations` (no grant) → 403 with grant message
- [ ] `billing_ops_manager` JWT → `GET /api/calls/practiceA/history` → 200 (cross-practice allowed)

### CARRIER_BLOCK
- [ ] Transcript containing "automated call" mid-call → active call ends, all queued claims for that carrier held, WS alert fires, other carriers unaffected
- [ ] Staff clears block → held claims return to queue, alert dismisses

### Queue engine
- [ ] Claim < 30 days old → `rejected_too_new`
- [ ] Claim > 90 days old → `escalated_too_old` + escalation record created
- [ ] Queue tick outside Mon–Fri 08:00–17:00 ET → no call initiated
- [ ] 3rd failed call attempt → escalation record created, claim removed from queue

### PHI boundary
- [ ] Log Vapi `startCall` request body → must not contain patient name, DOB, or health card number

### Settings validation
- [ ] `callWindowEnd: '19:00'` → 422
- [ ] TELUS `minimumClaimAgeDays: 15` → 422
- [ ] `escalationPhoneNumber: 'not-a-number'` → 422

### Outcome classification
- [ ] Transcript with "payment processing" → `approved`
- [ ] Call duration 20s, no voicemail phrase → `ivr_failure` (fallback)
- [ ] `takenOverByStaffId` set → `human_takeover` (overrides everything)

### Escalation actions (practice owner)
- [ ] `[Write Off]` → escalation resolved, claim removed from queue permanently
- [ ] `[Appeal]` → claim paused, escalation status = appealing

### Auditor read-only
- [ ] Auditor UI: no action buttons render anywhere
- [ ] Auditor API: `GET /api/practices/practiceB/reports/aging` where auditor only has grant for practiceA → 403

### WebSocket
- [ ] Close browser tab mid-call → reconnect within 30s → call state resumes from DB (not memory)
- [ ] `billing_ops_manager` WS client receives `carrier.blocked` event for any practice

---

*End of brief. Questions → Khalid Egeh (khalidegeh97@gmail.com)*
