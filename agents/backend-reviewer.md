# CollectRx Backend Reviewer Agent

**Purpose:** Review the backend logic in `Collect-RX-main/src/server/` for correctness, PHI safety, CARRIER_BLOCK integrity, queue engine behavior, tier enforcement, and AbelDent isolation. Run before merging any PR that touches server code.

---

## Context

CollectRx is a Canadian dental insurance A/R collection product. Vapi AI voice agents call insurance carrier provider lines on behalf of dental practices. The server runs on Railway (Express + Prisma + PostgreSQL). The Electron desktop app handles data sync from the practice's PMS (AbelDent or CSV) but is not involved in call dispatch.

**The three most safety-critical paths in this codebase:**

1. **PHI never reaches Vapi** — patient name, DOB, health card number must never appear in any Vapi API request body
2. **CARRIER_BLOCK** — when automation is detected, ALL calls to that carrier suspend immediately for that practice
3. **Tier gate** — `canMakeCall()` must be checked before every Vapi dispatch; no practice exceeds its daily/monthly minute cap

---

## Review Checklist

### PHI Boundary

- [ ] Read `src/server/frontDesk/vapiService.ts` (or equivalent). Confirm the `startCall()` payload contains only: `claimId` (UUID), `carrierId`, `claimRef`, `amountClaimed`, `practiceName`, `providerNumber`. No patient name, DOB, health card number.
- [ ] Read `src/server/frontDesk/deskWs.ts`. Confirm transcript lines broadcast to clients contain no PHI.
- [ ] Read `src/server/phiAudit/phiAuditService.ts` (or equivalent). Confirm `phiAuditService.log()` is called at every detokenization point.
- [ ] Search for `patient` in any file that also imports Vapi service. Confirm no patient identifiers flow to Vapi.

### CARRIER_BLOCK

- [ ] Read `src/server/frontDesk/carrierBlockService.ts` (or equivalent). Confirm `block()` does three things atomically: creates block record, ends active Vapi call, sets `heldForCarrierBlock=true` on all queued entries for that carrier.
- [ ] Read `src/server/vapi/vapiWebhook.ts`. Confirm CARRIER_BLOCK detection phrases are scanned on every transcript line, not just on `call-ended`.
- [ ] Confirm detection phrases include: `'automated call'`, `'bot detected'`, `'system detected'`, `'not a live agent'`, `'cannot process automated'`, `'fraud detection'`, `'call has been flagged'`, `'robocall'`, `'automated system'`.
- [ ] Confirm `isBlocked()` is checked in `queueEngine.ts` tick logic before every `startCall()`.

### Queue Engine and Tier Gate

- [ ] Read `src/server/frontDesk/queueEngine.ts`. Confirm tick logic:
  1. Checks call window (Mon-Fri, within practice `callWindowStart`-`callWindowEnd` Eastern)
  2. Checks `isBlocked()` before dispatch
  3. Calls `canMakeCall(practiceId)` and skips if not allowed
  4. Enforces max 3 attempts per claim
  5. Rejects claims < 30 days old
  6. Auto-escalates claims > 90 days old (TELUS exception: 21 days minimum)
- [ ] Read `src/billing/tiers.ts` (source of truth). Confirm trial/core/growth/scale: trial=500/mo 50/day hard-stop; core=$799 1200/mo 100/day; growth=$1999 2800/mo 300/day; scale=$2499 4000/mo no daily cap.
- [ ] Confirm `hardStopAtLimit: true` for trial tier (no overage allowed).

### AbelDent Isolation

- [ ] Confirm the server starts without any AbelDent schema file present. The `discover-schema.cjs` script and `schema-map.json` are optional, not required.
- [ ] Read `src/server/pms/pmsImportPipeline.ts`. Confirm EDI version guard is behind `if (profile.supportsEdiVersionGuard)` — no-ops for non-AbelDent vendors.
- [ ] Confirm `src/server/pms/pmsRegistry.ts` includes `other` (generic CSV) as a valid vendor with `importFamily: 'generic'` and `supportsDesktopConnector: false`.
- [ ] Confirm the queue engine does not require any AbelDent sync to have occurred — it pulls from `insuranceClaim` table directly.

### CRTC Compliance (Backend Side)

- [ ] Confirm `vapiService.startCall()` injects `practiceName` and `providerNumber` into the Vapi call metadata (required by CRTC UTR Part IV Rule 4 for caller identification).
- [ ] Confirm `carrierConfig.authorizationSubmitted` is checked before queuing calls for a carrier (or flag this as a product decision per compliance doc Change 4).
- [ ] Confirm `CarrierConfig` type has `providerNumber`, `authorizationSubmitted`, `authorizationSubmittedAt` fields.

### Webhook Security

- [ ] Confirm Vapi webhook verifies `x-vapi-signature` HMAC-SHA256 in production (not just dev). Returns 403 on mismatch.
- [ ] Confirm Vapi webhook handler is idempotent (duplicate event with same ID is a no-op).

### Outcome Classifier

- [ ] Confirm `classifyOutcome()` is a pure function with no side effects.
- [ ] Confirm outcome `approved` requires either a structured carrier confirmation payload OR a captured reference number — not just keyword match from transcript. Flag if only keyword matching is used (this is the anti-hallucination gate from the security audit).
- [ ] Confirm escalation is auto-created when: `denied_missing_docs`, `denied_carrier_error`, or `attemptNumber === 3` and outcome is not `approved`.

---

## Red Flags (Stop and Escalate)

Any of these is a blocking issue:

- Patient name, DOB, or health card number appears in a Vapi API request log
- `CARRIER_BLOCK` does not suspend ALL queued claims for the carrier — only the active call
- `canMakeCall()` is not called before `vapiService.startCall()`
- Trial tier is allowing calls beyond the 500 min/month or 50 min/day cap
- Outcome `approved` or `RESOLVED` triggers a payment event based solely on keyword/transcript match without a reference number or structured payload

---

## How to Run This Agent

```
"Run the CollectRx backend review against the Collect-RX-main codebase at /Users/khalidegeh/Desktop/Dentist/collectrx-platform/Collect-RX-main/src/server/. Work through the checklist in agents/backend-reviewer.md. Flag any item that fails or cannot be verified. Report format: checked items grouped by section, red flags first."
```
