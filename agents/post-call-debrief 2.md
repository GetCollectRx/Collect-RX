# CollectRx Post-Call Debrief Agent

**Purpose:** After every completed call batch, analyze what happened and extract what can be learned. Calls are the product — every call contains information that should make the next call better. Run automatically after each carrier call session (or daily if call volume is high). Feeds into: Voice Agent Trainer, Carrier IVR Health, Escalation Triage.

---

## What "Post-Call Debrief" Means

A call batch is a set of calls completed in a single queue processing run. This agent reviews the transcripts and outcomes from that batch, finds anything notable, and routes the finding to the right agent.

"Notable" means:
- The IVR took a different path than the squad expected
- A carrier representative said something new, unexpected, or contradictory
- The call was unusually long or short for the claim value
- An escalation was triggered — was it the right call?
- An outcome was recorded without a reference number
- The anti-hallucination gate fired
- A carrier said something that resembles an automation detection phrase
- The squad successfully resolved a claim that had previously failed — what was different?

---

## Per-Call Analysis

For each call, review the transcript and compare to the expected flow:

### IVR Navigation Check

Expected IVR path per carrier (from carrier-ivr-health.md knowledge base):
- Sun Life: [documented IVR tree]
- Canada Life: [documented IVR tree]
- Manulife: [documented IVR tree]
- Green Shield: [documented IVR tree]
- RBC Insurance: [documented IVR tree]
- TELUS AdjudiCare: [documented IVR tree]

Flag any deviation: new menu option, changed prompt wording, added security question, longer hold time. Any deviation is a signal that the IVR has changed.

### Outcome Confidence Check

For every call with a financial-terminal outcome (RESOLVED, DENIED, APPROVED_PENDING_PAYMENT):
- [ ] Was a carrier reference number captured?
- [ ] Was the reference number ≥4 characters?
- [ ] Was there a structured payload from the carrier?
- [ ] Did the anti-hallucination gate pass?

If a financial-terminal outcome was recorded WITHOUT a reference number or structured payload, this is a P0 finding. Route to hallucination-detector immediately.

### Escalation Quality Check

For calls that escalated:
- Was escalation appropriate given the claim status and value?
- Did the escalation phone number connect?
- Was the practice notified correctly?
- Was the escalation resolved or still open?

For calls that did NOT escalate but probably should have:
- Claim value >$1,000 with no resolution after first attempt
- Carrier said "speak to a supervisor" but agent didn't escalate
- Agent received conflicting information on two attempts

### Carrier Signal Mining

From every transcript, extract:
- Any new terminology the carrier used (codes, reasons, process changes)
- Any mention of new carrier policies or timelines
- Any expression of confusion or frustration by the carrier rep (signal of inconsistency)
- Any mention of the CDCP or provincial plan changes
- Any mention of automation, bots, or system detection

---

## Learning Extraction

After reviewing the batch, produce a structured learning:

### IVR Change Alert
If any IVR deviation was found:
```
CARRIER: [name]
DEVIATION: [what changed]
EVIDENCE: [call ID, transcript excerpt]
IMPACT: [does this break the current IVR navigation script?]
ROUTE TO: Carrier IVR Health, Voice Agent Trainer
```

### New Carrier Policy/Terminology
If any new information about carrier policy was learned:
```
CARRIER: [name]
FINDING: [what was learned]
SOURCE: [call ID, transcript excerpt]
IMPLICATION: [does the squad's script need to change?]
ROUTE TO: Voice Agent Trainer, Researcher (if verification needed)
```

### Hallucination Candidate
If any financial outcome lacks proper evidence:
```
CALL ID: [id]
OUTCOME RECORDED: [outcome type]
EVIDENCE PRESENT: [yes/no, details]
ANTI-HALLUCINATION GATE: [passed/fired/bypassed]
ROUTE TO: Hallucination Detector
```

### Escalation Pattern
If multiple calls escalated for the same reason:
```
PATTERN: [common escalation reason]
COUNT: [n calls in this batch]
CARRIER: [if carrier-specific]
IMPLICATION: [should the squad handle this differently before escalating?]
ROUTE TO: Escalation Triage, Voice Agent Trainer
```

---

## Batch Summary Format

```
## Post-Call Debrief — [DATE] — Batch [ID]

### Batch Stats
- Total calls: [n]
- Resolved: [n] ($[total recovered])
- Denied: [n]
- Escalated: [n]
- IVR Failure: [n]
- No Answer: [n]

### Findings
1. [Finding type] — [carrier] — [call ID] — [routed to]
2. ...

### IVR Deviations
- [Any changes to carrier IVR paths]

### Hallucination Candidates
- [Any outcomes without proper evidence]

### Lessons Extracted
- [Structured learnings routed to Voice Agent Trainer]

### Nothing Unusual
- [Confirm if batch was clean — no findings is a valid and good outcome]
```

---

## How to Run This Agent

```
"Run post-call debrief for call batch [ID / date range]. Read the call transcripts and outcomes. Check for IVR deviations, outcome confidence issues, escalation quality, and new carrier signals. Extract any learnings and route them to the appropriate agents. Produce the batch debrief report."
```
