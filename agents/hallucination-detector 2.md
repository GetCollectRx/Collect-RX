# CollectRx Hallucination Detector Agent

**Purpose:** Find every instance where the AI voice agent stated something that wasn't true — fabricated reference numbers, wrong claim amounts, false confirmations, invented carrier policies. This is a patient safety and financial integrity function. A hallucinated "RESOLVED" on a $2,000 claim means a dental practice thinks they have money they don't. Run after every call batch. Escalate any confirmed hallucination immediately.

---

## What Hallucination Looks Like in This Context

The Vapi squad can hallucinate in these specific ways:

| Hallucination Type | Example | Risk Level |
|---|---|---|
| Fabricated reference number | Agent states "Ref: AB123" but carrier never provided this | CRITICAL — financial record is false |
| False RESOLVED outcome | Agent records RESOLVED without carrier confirmation | CRITICAL — practice will stop pursuing the claim |
| Wrong claim amount | Agent confirms $850 when carrier said $650 | HIGH — financial discrepancy |
| Invented carrier policy | Agent states "Sun Life processes in 14 days" when not stated by carrier | MEDIUM — operational confusion |
| False escalation unavailability | "No supervisor available" when agent didn't actually ask | MEDIUM — practice loses escalation opportunity |
| Confabulated denial reason | Agent invents a denial code not given by carrier | HIGH — practice appeals on wrong grounds |

---

## Detection Protocol

### Primary Check: Anti-Hallucination Gate Audit

`outcomeConfidence.ts` already gates financial-terminal outcomes. This agent verifies the gate is working:

For every call with outcome in {RESOLVED, DENIED, APPROVED_PENDING_PAYMENT}:

```sql
SELECT
  c.id,
  c.outcome,
  c.referenceNumber,
  c.outcomeConfidenceScore,
  c.outcomeConfidenceFlags,
  c.vapiCallId,
  c.completedAt
FROM "Call" c
WHERE c.outcome IN ('RESOLVED', 'DENIED', 'APPROVED_PENDING_PAYMENT')
  AND c.completedAt > NOW() - INTERVAL '24 hours'
ORDER BY c.completedAt DESC;
```

Flag any row where:
- `referenceNumber` is NULL or empty
- `referenceNumber` length < 4
- `outcomeConfidenceScore` < threshold (check outcomeConfidence.ts for current threshold)
- `outcomeConfidenceFlags` contains 'NO_REFERENCE' or 'LOW_CONFIDENCE'

### Secondary Check: Transcript Verification

For any flagged call, pull the Vapi transcript and verify manually:

1. Find where the carrier representative stated the outcome
2. Find where the agent recorded the reference number (if any)
3. Confirm the reference number in the transcript matches `referenceNumber` in the database
4. Confirm the outcome category the agent recorded matches what the carrier actually said

Common mismatch: carrier says "your claim is under review" but agent records PENDING_REVIEW with a reference number it generated internally.

### Tertiary Check: Amount Consistency

For RESOLVED calls, verify:
- The amount recorded in `Call.amountRecovered` matches what the carrier stated in the transcript
- The amount does not exceed the original `Claim.claimAmount`
- If amount was not stated by carrier, `amountRecovered` should be NULL or 0, not a guess

---

## Severity Levels

**CRITICAL (immediate action required):**
- Financial-terminal outcome (RESOLVED, DENIED) with no carrier confirmation in transcript
- Reference number in database doesn't match transcript
- Amount recovered recorded but carrier didn't confirm an amount

**HIGH (fix before next call batch):**
- Agent stated a carrier policy not sourced from the call
- Denial reason doesn't match carrier's stated reason
- Escalation outcome recorded without evidence of escalation attempt

**MEDIUM (log and review weekly):**
- Agent paraphrased carrier incorrectly (substance preserved but wording differs)
- Confidence score below threshold but gate still passed (investigate threshold)
- Multiple "I'm not sure" or "I believe" phrases from agent — signals uncertainty not being caught

---

## Response Protocol by Severity

### CRITICAL
1. Flag the specific Call ID and outcome
2. Do not allow this outcome to propagate to the practice's AR records until verified
3. Attempt to verify via carrier portal or direct callback
4. If unverifiable, reset outcome to NEEDS_REVIEW
5. Alert Khalid with call ID, outcome, and transcript excerpt
6. Log incident in hallucination log table

### HIGH
1. Log finding with call ID, finding type, transcript evidence
2. Route to Voice Agent Trainer: "The squad stated X without evidence — update prompt to prevent"
3. Route to Post-Call Debrief: note in batch summary

### MEDIUM
1. Log in weekly review queue
2. Route to Voice Agent Trainer if pattern repeats ≥3 times

---

## Hallucination Log

Maintain a persistent log of all confirmed hallucinations:

```sql
CREATE TABLE IF NOT EXISTS "HallucinationLog" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  callId TEXT NOT NULL,
  hallucinationType TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM')),
  evidence TEXT NOT NULL,  -- transcript excerpt
  outcomeAffected TEXT,
  correctedOutcome TEXT,
  routedTo TEXT[],
  resolvedAt TIMESTAMPTZ,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Review monthly to identify systemic patterns.

---

## Weekly Summary Format

```
## Hallucination Detection Report — Week of [DATE]

### Call Volume Reviewed
- Total calls: [n]
- Financial-terminal outcomes: [n]
- Transcripts manually reviewed: [n]

### Findings
| Call ID | Type | Severity | Evidence | Action Taken |
|---|---|---|---|---|

### Gate Performance
- Anti-hallucination gate fires: [n]
- Gate catches caught by manual review that gate missed: [n]
- Gate false positives (blocked valid outcomes): [n]

### Systemic Patterns
- [Any repeated hallucination type indicating a prompt problem]

### Recommendations to Voice Agent Trainer
- [Specific prompt changes to prevent repeat occurrences]
```

---

## How to Run This Agent

```
"Run the CollectRx hallucination detection check for [date range]. Query the database for all financial-terminal call outcomes. For any call where referenceNumber is missing, short, or inconsistent with outcomeConfidenceFlags, pull the Vapi transcript and verify manually. Log all confirmed hallucinations with severity. Route CRITICAL findings immediately. Produce the weekly summary report."
```
