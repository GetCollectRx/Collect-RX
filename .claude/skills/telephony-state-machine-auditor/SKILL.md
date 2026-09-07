---
name: telephony-state-machine-auditor
description: Audit telephony code (Vapi callbacks, Twilio webhooks, phone state handlers) for strict call deadlines, carrier hold resiliency, and PHI boundary compliance.
argument-hint: "File path or code snippet to audit"
user-invocable: true
disable-model-invocation: false
trigger: "Whenever writing or modifying code matching Vapi callbacks, Twilio webhooks, or phone state handlers"
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Skill Purpose

Enforce three critical safety mandates when authoring or reviewing telephony automation code in CollectRx:
1. **Strict Call Deadlines** — every outbound webhook handler must declare absolute max call duration
2. **Carrier Hold Resiliency** — parsers survive non-standard IVR routing and dead-air blocks
3. **Zero PHI Egress to Voice Platform** — raw health claims data never in public webhook payloads

## Context

CollectRx manages concurrent automated outbound calls via Vapi.ai (5-agent squad) and Twilio. A failed webhook catch stalls voice agent nodes. Dropped call-state updates orphan conversations. Leaking PHI breaks PHIPA/PIPEDA compliance.

**Related safety rule (CLAUDE.md):**
- PHI (patient names, DOBs, health card numbers) **never crosses to Vapi metadata**
- UUID tokens only; ephemeral PHI in call `variables` at dispatch time
- Detokenization server-side before call; never in logs/database

## Execution Steps

### 1. Identify Scope

Determine file(s) to audit from `$ARGUMENTS`:
- If empty or vague: ask for specific file path(s) or code snippet
- Target patterns: `src/server/vapi/*`, `src/server/twilio/*`, `src/services/*call*`, `*webhook*`, `*callback*`, `*state*handler*`

### 2. Load Related Files

From the codebase root (`Collect-RX-main/` or `src/`):
- The target file(s) to audit
- `src/services/eligibility/types.ts` (to understand ClaimData, EstimateProcedure structures)
- `src/server/vapi/` directory (for squad orchestration patterns)
- `docs/compliance/PHI-VAPI-BOUNDARY.md` (PHI enforcement rules)

### 3. Apply Three Verification Mandates

#### Mandate 1: Strict Call Deadlines

**Check EVERY webhook handler function for max duration ceiling:**

```typescript
// ✅ GOOD: explicit ceiling
async function handleVapiCallback(req) {
  const MAX_CALL_DURATION_MS = 600000; // 10 min hard ceiling
  const startTime = Date.now();
  
  try {
    // handler logic
  } finally {
    if (Date.now() - startTime > MAX_CALL_DURATION_MS) {
      logger.error('Call exceeded max duration');
    }
  }
}

// ❌ BAD: no ceiling, no timeout guard
async function handleVapiCallback(req) {
  // unbounded logic
}
```

**Findings to report:**
- ❌ CRITICAL: Handler missing `MAX_*_DURATION_MS` constant
- ❌ HIGH: Handler has timeout logic but no explicit "call must end by X" statement in comments
- ⚠️ MEDIUM: Timeout exists but value unreasonable (e.g., > 15 min for claim lookup)
- ✅ PASS: Explicit max duration defined and enforced

**Reasonable ceilings:**
- IVR navigation → 5–10 min
- Claims Agent conversation → 10–15 min (allow for hold music + rep delay)
- Hold Sentinel → 20–30 min (silent wait)
- Resolution Closer → 5 min
- Global webhook processing → 60 sec (synchronous response only)

#### Mandate 2: Carrier Hold Resiliency

**Check inbound response parsers for robustness:**

```typescript
// ✅ GOOD: survives non-standard signals
function parseIVRResponse(audio: string, context: CallContext) {
  const trimmed = audio.trim();
  
  // Gracefully handle:
  // - silence (dead air)
  // - non-English IVR (returned to menu, carrier routing quirk)
  // - concurrent hold music + background voices
  
  if (!trimmed || trimmed.length < 100) {
    return { type: 'unclear', reason: 'insufficient_audio' };
  }
  
  // Carrier-specific parsing: each carrier's IVR has quirks
  // document them
  try {
    return parseCarrierMenu(trimmed);
  } catch (e) {
    logger.warn('Parse failed, retrying next attempt', { audio: trimmed.slice(0, 50), error: e.message });
    return { type: 'retry', reason: 'parse_error' };
  }
}

// ❌ BAD: throws on missing data, crashes on non-standard audio
function parseIVRResponse(audio: string) {
  const match = audio.match(/claim number \d+/i); // throws if audio is null
  return { claimNumber: parseInt(match[1]) };
}
```

**Findings to report:**
- ❌ CRITICAL: Parser throws unhandled exception on non-standard IVR signals
- ❌ HIGH: No fallback for silent/dead-air blocks; assumes carrier menu always present
- ⚠️ MEDIUM: Error message doesn't distinguish "retry vs escalate" scenarios
- ✅ PASS: Robust error paths documented; dead-air blocks handled

**Things to check:**
- Does code assume IVR menu text is always present?
- Are silence/timeout scenarios handled gracefully?
- Does code retry or escalate on parse failure?
- Are carrier-specific quirks (Sun Life vs. Canada Life) documented?

#### Mandate 3: Zero PHI Egress to Voice Platform

**Check all Vapi webhook payloads for PII:**

```typescript
// ✅ GOOD: UUID token in metadata, ephemeral PHI in call variables only
async function dispatchToVapi(claim: ClaimData) {
  const claimToken = uuidv4(); // deterministic or random, not patient name
  
  const callPayload = {
    metadata: {
      claim_token: claimToken, // safe
      practice_id: claim.practiceId, // safe
      // ❌ NOT HERE: claim.patientName, claim.healthCardNumber, claim.DOB
    },
    variables: {
      // Ephemeral: passed at call dispatch, detokenized server-side
      patient_name: claim.patientName,
      health_card: claim.healthCardNumber,
      dob: claim.dateOfBirth,
    },
  };
  
  return vapi.createCall(callPayload);
}

// ❌ BAD: raw health data in metadata (public webhook payload)
async function dispatchToVapi(claim: ClaimData) {
  return vapi.createCall({
    metadata: {
      patientName: claim.patientName, // PHIPA VIOLATION
      procedures: claim.procedures, // raw estimate array
      estimate: claim.estimatedCost, // ok
    },
  });
}
```

**Findings to report:**
- ❌ CRITICAL: Patient name, DOB, health card number in metadata or logs
- ❌ CRITICAL: `ClaimData` or `EstimateProcedure[]` array passed directly to Vapi
- ❌ HIGH: Metadata contains `procedures` or `estimates` object (could leak dental codes/costs)
- ⚠️ MEDIUM: Logging includes PHI even with disclaimer comment
- ✅ PASS: UUID tokens in metadata; PHI confined to ephemeral call variables

**Things to check:**
- Does code pass entire `ClaimData` object to Vapi?
- Are patient identifiers (name, DOB, MRN, health card) in metadata?
- Are procedure estimates, costs, or procedure arrays in webhook payloads?
- Does code log full objects that contain PHI?

### 4. Severity Assignment

- **CRITICAL**: Violates deadlines (unbounded async), PHI egress (patient data in public payload), or unhandled parser crash
- **HIGH**: Missing documented deadline ceiling, missing carrier-hold fallback, logs contain PII
- **MEDIUM**: Unreasonable timeout values, unclear error paths, documentation gaps
- **LOW**: Style improvements, unclear variable names, missing comments

### 5. Produce Audit Report

Format as a **structured findings report**:

```markdown
## Telephony Automation Audit Report

**File(s) Audited:**
- [ list ]

**Audit Date:** [date]

### Mandate 1: Strict Call Deadlines

| Location | Status | Ceiling Value | Notes |
|----------|--------|---------------|-------|
| `handleVapiCallback` | ✅ PASS | 10 min | Explicit ceiling enforced |
| `handleTwilioWebhook` | ❌ CRITICAL | None | Unbounded async; needs MAX_DURATION_MS |

### Mandate 2: Carrier Hold Resiliency

| Function | Status | Finding |
|----------|--------|---------|
| `parseIVRResponse` | ✅ PASS | Handles silence, retries on parse error |
| `extractClaimStatus` | ⚠️ MEDIUM | Assumes menu text always present; add fallback for non-standard routing |

### Mandate 3: Zero PHI Egress

| Payload | Status | Finding |
|---------|--------|---------|
| `dispatchToVapi` metadata | ✅ PASS | UUID tokens only; PHI in call variables |
| Vapi logging | ❌ CRITICAL | `claim.patientName` in metadata object |

### Summary

- **Total Findings:** [N]
- **CRITICAL:** [N] (block merge)
- **HIGH:** [N] (address before production call)
- **MEDIUM/LOW:** [N] (suggested improvements)

### Remediation Required

[Concrete steps to fix each CRITICAL/HIGH finding]

### Next Action

- [ ] If CRITICAL findings exist: DO NOT merge; apply fixes and re-audit
- [ ] If HIGH findings: create follow-up task; plan remediation within 1 sprint
- [ ] If only MEDIUM/LOW: apply as polish, or defer to next iteration
```

### 6. Provide Remediation Guidance

For each finding, offer **concrete fix code**:

```typescript
// Example fix for unbounded handler
async function handleVapiCallback(req) {
  const MAX_HANDLER_DURATION_MS = 60000; // 1 min ceiling for sync processing
  const startTime = Date.now();
  
  try {
    // ... handler logic ...
  } finally {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_HANDLER_DURATION_MS) {
      logger.error('Webhook handler exceeded max duration', { elapsed, max: MAX_HANDLER_DURATION_MS });
      // Queue long-running work to background job, not webhook handler
    }
  }
}
```

## Done When

- [ ] All three mandates verified against target file(s)
- [ ] Severity levels assigned to all findings
- [ ] Structured report produced (Markdown)
- [ ] Remediation guidance offered for CRITICAL/HIGH findings
- [ ] User presented with next-action recommendation (merge-safe vs. fix-required)
