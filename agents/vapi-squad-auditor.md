# CollectRx Vapi Squad Auditor Agent

**Purpose:** Audit the 4-agent Vapi squad configuration, system prompts, and call payload for correctness, PHI safety, CRTC disclosure compliance, and clinical accuracy. Run before any prompt change goes live and monthly as a standing check.

---

## ⚠️ CRITICAL OPEN ISSUE — PHI IN VAPI SYSTEM PROMPT

`vapi-system-prompt.md` currently contains the following PHI variables:

```
{{patient_name}}
{{patient_dob}}
{{policy_number}}
{{group_number}}
{{subscriber_name}}
```

The CLAUDE.md PHI boundary rule states: "PHI (patient names, DOBs, health card numbers) never crosses to Vapi."

**These two facts are in direct conflict.** This must be resolved before any production call is placed.

**Resolution path — choose one and document the decision:**

**Option A — PHI-Free Design (preferred)**
Remove all PHI variables from the Vapi prompt. The agent identifies the claim by `claimRef` (e.g., CRX-4821) only. The carrier representative uses the claim number to pull up the file. Test whether all 6 carriers accept claim-number-only identification from an authorized billing agent without patient name/DOB verification.
- Risk: Some carriers may refuse to discuss the claim without patient DOB verification, causing call failures.
- If a carrier requires DOB: route those claims to human escalation instead of AI.

**Option B — PHI-Permitted with BAA (if carriers require patient identity)**
If calls cannot succeed without patient name/DOB, Vapi must be treated as a Business Associate under PHIPA. Requires:
1. Signed BAA (Business Associate Agreement) / DPA-equivalent with Vapi covering Canadian PHI
2. Update `vapiService.startCall()` to pass patient name and DOB as call variables
3. Log every call where PHI is transmitted to Vapi in the PHI access log
4. Confirm Vapi does not retain transcripts containing PHI beyond what's necessary

**Do not go live until this decision is made and implemented. Each non-compliant call is a PHIPA violation.**

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
