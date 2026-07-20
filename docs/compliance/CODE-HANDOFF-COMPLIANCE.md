# CollectRx — Compliance Code Handoff

**Repo:** `github.com/khalidegeh/Collect-RX` (branch: `master`)  
**Prepared by:** Khalid Egeh  
**Date:** 2026-06-15  
**Context:** Four targeted changes required before any live carrier calls. These are compliance requirements — not features. Do not skip or defer.

---

## Background

CollectRx uses Vapi voice agents to call insurance carrier provider lines on behalf of dental practices. Three compliance documents were produced:

1. **Billing Agent Authorization Letter** — practices sign this to designate CollectRx as their authorized billing representative with each carrier. The letter references a provider number per carrier. That number currently has no home in the data model.
2. **Vapi Script Disclosure** — approved opening scripts for all four agents require `[PRACTICE_NAME]` and `[PROVIDER_NUMBER]` variables. These are not PHI and can be sent to Vapi. Currently neither is in the `startCall()` payload.
3. **PHIPA Agent Agreement** — warrants audit logging of every PHI detokenization event. No such log exists.

---

## Change 1 — Extend `CarrierConfig` in `src/types/practice.ts`

Add three fields to the existing `CarrierConfig` interface:

```ts
export interface CarrierConfig {
  carrierId: CarrierId;
  enabled: boolean;
  minimumClaimAgeDays: number;
  maxAttempts: number;
  callWindowStart: string;
  callWindowEnd: string;
  notes: string;
  // --- ADD THESE ---
  providerNumber: string;                  // practice's provider ID with this carrier (may be empty string if not yet registered)
  authorizationSubmitted: boolean;         // true once billing agent auth letter has been submitted to this carrier
  authorizationSubmittedAt: string | null; // ISO timestamp of submission
}
```

**Validation update** — in `src/api/middleware/validate.ts`, add to the `updateSettings` schema:

- `providerNumber`: string, allow empty, max 50 chars
- `authorizationSubmitted`: boolean
- `authorizationSubmittedAt`: ISO string or null

**Seed update** — wherever carrier configs are seeded or defaulted, initialize:
```ts
providerNumber: '',
authorizationSubmitted: false,
authorizationSubmittedAt: null,
```

---

## Change 2 — Update `vapiService.startCall()` to inject practice identity

**File:** `src/api/services/vapiService.ts`

`startCall()` currently receives a `QueueEntry`. It needs the practice name and the carrier-specific provider number to inject into the Vapi call as variables. These are **not PHI** — they are business identifiers and are safe to send to Vapi.

Update the signature and payload:

```ts
// Before
startCall(entry: QueueEntry): Promise<{ vapiCallId: string }>

// After
startCall(
  entry: QueueEntry,
  practiceName: string,
  providerNumber: string
): Promise<{ vapiCallId: string }>
```

In the Vapi `POST /call/phone` payload, add a `metadata` or `variables` field (per Vapi's API — use whichever field Vapi uses for call-time variable injection):

```ts
{
  // existing fields: phoneNumberId, assistantId, customer number, etc.
  metadata: {
    claimId: entry.claimId,          // UUID — not PHI
    carrierId: entry.carrierId,
    claimRef: entry.claimRef,
    amountClaimed: entry.amountClaimed,
    practiceName,                    // e.g. "Hasan Family Dentistry"
    providerNumber,                  // e.g. "ON-123456"
  }
}
```

**PHI boundary reminder** — do not include patient name, DOB, health card number, or any field from the patient record. `claimRef` (e.g. `CRX-4821`) is a CollectRx internal reference and is safe.

**Call site update** — in `src/api/services/queueEngine.ts`, the tick logic calls `vapiService.startCall(entry)`. Update this call to look up the practice record and pass `practiceName` and the carrier-specific `providerNumber`:

```ts
const practice = db.practices.get(entry.practiceId);
const carrierConfig = practice?.settings.carrierConfigs.find(c => c.carrierId === entry.carrierId);

await vapiService.startCall(
  entry,
  practice?.name ?? '',
  carrierConfig?.providerNumber ?? ''
);
```

---

## Change 3 — PHI Access Audit Log

### 3a. Add to `src/api/db.ts`

```ts
import type { PhiAccessLogEntry } from '../types/audit';

// Add to the db object:
phiAccessLog: new Map<string, PhiAccessLogEntry>(),
```

### 3b. New file `src/types/audit.ts`

```ts
export type PhiAccessAction =
  | 'detokenize'   // backend maps UUID back to patient identifiers after a call
  | 'view'         // staff views a claim detail that includes patient identifiers
  | 'export';      // any CSV or PDF export that includes patient identifiers

export interface PhiAccessLogEntry {
  id: string;                // UUID
  performedAt: string;       // ISO timestamp
  practiceId: string;
  claimId: string;           // the claim whose PHI was accessed
  action: PhiAccessAction;
  performedBy: string;       // userId if triggered by staff action; 'system' if triggered by queue engine post-call
  reason: string;            // human-readable, e.g. 'call completion detokenization for CRX-4821'
}
```

### 3c. New service `src/api/services/phiAuditService.ts`

```ts
import { db } from '../db';
import { v4 as uuid } from 'uuid';
import type { PhiAccessAction } from '../../types/audit';

export const phiAuditService = {
  log(params: {
    practiceId: string;
    claimId: string;
    action: PhiAccessAction;
    performedBy: string;
    reason: string;
  }): void {
    const entry = {
      id: uuid(),
      performedAt: new Date().toISOString(),
      ...params,
    };
    db.phiAccessLog.set(entry.id, entry);
  }
};
```

### 3d. Call it at every detokenization point

Wherever the backend maps a claim UUID back to patient identifiers (after a Vapi call completes, when a staff member opens a claim detail), add:

```ts
phiAuditService.log({
  practiceId: call.practiceId,
  claimId: call.claimId,
  action: 'detokenize',
  performedBy: 'system',            // or req.user.userId for staff-triggered access
  reason: `call completion detokenization for ${call.claimRef}`,
});
```

---

## Change 4 — Practice Settings UI: Authorization Status

**File:** `src/frontend/components/PracticeSettings.tsx`

In Section 3 (Carrier Configuration), add two columns to the carrier table per row:

| Column | Type | Behaviour |
|---|---|---|
| Provider Number | Text input | Editable. Saved via `PUT /api/practices/:id/settings`. |
| Auth Submitted | Toggle + date | Toggle sets `authorizationSubmitted`. When toggled on, set `authorizationSubmittedAt` to now. Display the date once set. Read-only after first toggle (add a "reset" link for corrections). |

This gives the practice owner and platform admin a place to record that the billing agent authorization letter has been submitted to each carrier — which is a prerequisite before calls to that carrier should be enabled.

**Optional enforcement** — in `queueEngine.ts` tick logic, before calling `vapiService.startCall()`, check:

```ts
if (!carrierConfig?.authorizationSubmitted) {
  // skip this entry, log reason: 'authorization not yet submitted for this carrier'
  continue;
}
```

Whether to enforce this as a hard block or a soft warning is a product decision. Flag it for Khalid to decide.

---

## What NOT to change

- Do not modify the CARRIER_BLOCK service — it is correct as specified.
- Do not modify the PHI boundary rule — PHI must never reach Vapi. The `practiceName` and `providerNumber` additions in Change 2 are not PHI.
- Do not touch patient records, DOBs, or health card numbers anywhere in this changeset.
- The Vapi agent system prompts (the actual script text) are configured in the Vapi dashboard, not in this codebase. That is a separate task for Khalid to handle in the Vapi UI using the script document `collectrx-vapi-script-disclosure.docx`.

---

## Acceptance Criteria

- [ ] `CarrierConfig` has `providerNumber`, `authorizationSubmitted`, `authorizationSubmittedAt`
- [ ] `vapiService.startCall()` sends `practiceName` and `providerNumber` to Vapi — confirmed by logging the request payload (never log PHI)
- [ ] `queueEngine.ts` passes practice name and provider number when calling `startCall()`
- [ ] `db.phiAccessLog` Map exists and `phiAuditService.log()` is called at all detokenization points
- [ ] Carrier config table in `PracticeSettings.tsx` shows provider number input and authorization toggle
- [ ] Settings validation schema updated for the new `CarrierConfig` fields
- [ ] No patient name, DOB, or health card number appears in any Vapi API request payload

---

*Questions → Khalid Egeh (khalidegeh97@gmail.com)*
