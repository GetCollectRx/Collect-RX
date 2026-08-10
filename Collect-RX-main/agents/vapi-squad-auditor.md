# CollectRx Vapi Squad Auditor Agent

**Purpose:** Audit the 5-agent Vapi squad configuration (IVR_Navigator, Hold_Sentinel, Claims_Agent, Escalation_Closer, Resolution_Closer — verified against `vapi-squad-config.json`), system prompts, and call payload for correctness, PHI safety, CRTC disclosure compliance, and clinical accuracy. Run before any prompt change goes live and monthly as a standing check.

---

## ✅ PHI Boundary — Closed (Option B)

**Decision (2026-06-20):** Ephemeral PHI via Vapi `variables` at call time only. Documented in `docs/compliance/PHI-VAPI-BOUNDARY.md`.

`vapi-system-prompt.md` and `vapi-squad-config.json` use **placeholder variable names** (`{{patient_name}}`, etc.). Real values are injected by `initiateCall()` and never stored in DB, logs, or Vapi metadata.

**Before production scale — operator/legal:**
1. Signed BAA/DPA with Vapi covering Canadian PHI
2. Confirm Vapi transcript retention policy in writing
3. PHI access log reviewed monthly

**Auditor checks:**
- [ ] No PHI in Vapi `metadata` payload (UUID only)
- [ ] `recordingEnabled: false` on outbound calls
- [ ] Post-call audio deletion gate active
- [ ] Logger scrubs PHI field names

---

## Squad Configuration Audit

### Four-Agent Squad

| Agent | Role | Check |
|---|---|---|
| IVR_Navigator | Navigates carrier IVR menus | Phone numbers correct per carrier; IVR menu paths current |
| Claims_Agent | Speaks with rep, gathers status | Verification questions answered correctly; JSON output fires |
| Escalation_Closer | Handles denied/disputed claims | Escalation conditions match `carrierBlockPhrases.ts` |
| Resolution_Closer | Confirms payment, closes claim | Reference number captured before call ends |

For each agent:
- [ ] System prompt is loaded in Vapi dashboard (not just a local file)
- [ ] `[PRACTICE_NAME]` / `{{practice_name}}` variable is populated at call time
- [ ] `[PROVIDER_NUMBER]` / `{{providerNumber}}` variable is populated at call time
- [ ] PHI variables (patient_name, patient_dob) — BLOCKED until PHI decision is resolved (see above)

### CRTC Disclosure Check

The opening of every call MUST state (per UTR Part IV Rule 4):
- [ ] "This is an automated calling system" — confirmed in current prompt ✅
- [ ] Practice name stated: "calling on behalf of [PRACTICE_NAME]"
- [ ] Purpose of call: "regarding an outstanding insurance claim / claim [CLAIM_REF]"
- [ ] Callback number referenced: "You can reach us at [PRACTICE_PHONE]"

Current prompt opening passes items 1, 3, and 4. Verify item 2 (practice name variable is populated).

### JSON Output Gate (Stage 6)

Every call must terminate with a structured JSON output:
```json
{
  "outcome": "<CLAIM_NOT_RECEIVED | NOT_COVERED | MAX_BENEFITS_REACHED | NEED_INFORMATION | PROCESSING | CLAIM_PAID | CLAIM_DENIED | TRANSFERRED | UNCLEAR | CALL_DROPPED | NO_ANSWER>",
  "reference_number": "<captured reference or null>",
  ...
}
```

- [ ] Confirm `outcomeConfidence.ts` gate is wired to this JSON output: `CLAIM_PAID` and `CLAIM_DENIED` only accepted as financial-terminal if `hasStructuredPayload: true` OR `referenceNumber` is non-null and >= 4 chars
- [ ] If JSON output is absent or malformed on `call-ended`, the claim must default to `UNCLEAR` → escalation, not auto-resolution

### Carrier-Specific Notes

Each carrier has different IVR flows and hold behaviors. Confirm in the Vapi dashboard:
- [ ] **RBC Insurance** — 45-minute timeout configured (`CARRIER_TIMEOUTS['rbc-insurance']: 45`)
- [ ] **All others** — 30-minute timeout
- [ ] **TELUS AdjudiCare** — TPA identification step fires before IVR navigation; group prefix → TPA lookup runs
- [ ] Carrier-specific `{{carrier_specific_notes}}` blocks are populated for all 6 carriers

### Anti-Impersonation Rules

The prompt states: "NEVER claim to be a human or deny being an automated system if asked directly."
- [ ] Confirm this rule appears in all four agent prompts, not just the primary
- [ ] Confirm there is no "sound human" instruction that contradicts this (there is a "sound like a real person" instruction — verify this does not override the anti-impersonation rule when asked directly)

---

## `vapiService.startCall()` Payload Audit

Read `src/server/vapi/client.ts` or equivalent. Confirm the call creation payload:

**Must contain:**
- `claimId` (UUID, not patient ID)
- `carrierId`
- `claimRef` (e.g., CRX-4821)
- `amountClaimed`
- `practiceName`
- `providerNumber`

**Must NOT contain (unless Option B above is selected and BAA is signed):**
- `patientName`
- `patientDob`
- `healthCardNumber`
- `policyNumber` (if this maps to PHI in your data model)

---

## How to Run This Agent

```
"Run the CollectRx Vapi Squad Audit. Read vapi-system-prompt.md, vapi-squad-config.json, and src/server/vapi/client.ts. Work through the checklist in agents/vapi-squad-auditor.md. The PHI conflict is the P0 issue — assess both resolution options and recommend one. Report: PHI status first, then all checklist items."
```
