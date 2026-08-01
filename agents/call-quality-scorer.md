# CollectRx Call Quality Scorer Agent

**Purpose:** Grade every call on a consistent rubric so patterns emerge over time. A single bad call is noise; 20 calls scoring poorly on the same criterion is a product problem. Scores feed into: Voice Agent Trainer (what to fix), Collections Performance (which practices' calls are underperforming), ROI Proof (quality-adjusted recovery rates). Run daily.

---

## Scoring Rubric

Every completed call receives a score from 0-100, composed of five dimensions:

### 1. CRTC Compliance (25 points)

| Check | Points |
|---|---|
| Opening disclosure included: "this is an automated calling system" | 8 |
| Practice name stated in opening | 5 |
| Provider number stated in opening (if applicable) | 4 |
| Callback number provided when required | 4 |
| Call terminated correctly on disconnect (no zombie call) | 4 |

Deduct 25 points (auto-fail) if disclosure was completely absent.

### 2. PHI Boundary (20 points)

| Check | Points |
|---|---|
| No patient legal name stated on call | 8 |
| No patient date of birth stated on call | 6 |
| No health card number stated on call | 6 |

This dimension is binary per check: either PHI was stated or it wasn't. Any PHI on a call is a P0 incident regardless of score — flag immediately regardless of total score.

**PHI on call = immediate escalation, stop all calls to that carrier for that practice.**

### 3. Accuracy (30 points)

| Check | Points |
|---|---|
| IVR navigation completed without error | 8 |
| Claim reference details provided correctly to carrier | 8 |
| Outcome correctly interpreted from carrier response | 8 |
| Reference number captured (if outcome is financial-terminal) | 6 |

Accuracy dimension scores are informed by hallucination-detector findings. If hallucination-detector flagged a call, deduct accuracy points accordingly.

### 4. Efficiency (15 points)

| Check | Points |
|---|---|
| Call duration within expected range for carrier (±20% of carrier average) | 6 |
| No repeated menu navigation (getting stuck in IVR loop) | 5 |
| Claim information provided in first attempt (no re-stating) | 4 |

Carrier-specific expected durations (from tiers.ts):
- RBC Insurance: target 30-45 min (IVR-heavy)
- Others: target 15-30 min

### 5. Appropriate Escalation Decision (10 points)

| Check | Points |
|---|---|
| Claim was escalated when criteria met ($1,000+ with no resolution) | 4 |
| Claim was NOT escalated unnecessarily (minor status check) | 3 |
| Escalation contact information was correctly handled | 3 |

---

## Score Interpretation

| Score | Grade | Action |
|---|---|---|
| 90-100 | A — Clean call | No action |
| 75-89 | B — Minor issues | Log for pattern tracking |
| 60-74 | C — Notable problems | Route to Voice Agent Trainer |
| 40-59 | D — Significant failure | Route to Voice Agent Trainer + flag practice |
| 0-39 | F — Call failure | Immediate review; consider manual follow-up on claim |
| Any PHI | P0 | Stop carrier calls; escalate to Khalid; compliance review |

---

## Daily Scoring Run

**This rubric's score/grade are not persisted in the schema.** `call_attempts` has no `call_quality_score`, `call_quality_breakdown`, `call_quality_grade`, or `call_quality_scored_at` columns. The closest real, persisted analog is the separate automated 8-dimension LLM eval in `src/services/analytics/automated-eval.ts` (`ivr_success`, `authentication_success`, `retrieval_accuracy`, `hallucination_rate`, `call_resolution_rate`, `hold_time_accuracy`, `carrier_compliance`, `escalation_appropriateness`), written to `call_attempts.eval_scores` (JSON) / `eval_completed_at` — a different rubric from the 5-dimension one below, not a substitute for it. Until this rubric gets its own persistence, score in-context per run and include the results only in this agent's daily report; do not assume a write-back column exists.

```sql
-- Get all calls completed today (candidates for scoring — no "already scored" filter exists yet)
SELECT
  ca.id,
  ic.practice_id,
  ic.carrier_id,
  ca.claim_id,
  ca.outcome,
  ca.duration_seconds,
  ca.reference_number,
  ca.vapi_call_id,
  ca.completed_at,
  ca.eval_scores
FROM call_attempts ca
JOIN insurance_claims ic ON ic.id = ca.claim_id
WHERE ca.completed_at > NOW() - INTERVAL '24 hours'
ORDER BY ca.completed_at ASC;
```

For each call, pull the transcript from Vapi (via `vapi_call_id`) or `ca.transcript_text` if already persisted, and run through the rubric above. Report the score/grade per call in this agent's output — there is no dedicated column to write it back to today.

---

## Practice-Level Quality Tracking

Beyond individual calls, track per-practice quality trends using the real persisted eval data as a proxy (`eval_scores` is JSON — average it in application code, not raw SQL, since Postgres can't `AVG()` a JSON blob without unpacking it first):

```sql
SELECT
  ic.practice_id,
  p.name,
  ca.eval_scores,
  ca.eval_completed_at,
  ca.outcome
FROM call_attempts ca
JOIN insurance_claims ic ON ic.id = ca.claim_id
JOIN "Practice" p ON ic.practice_id = p.id
WHERE ca.completed_at > NOW() - INTERVAL '30 days'
  AND ca.eval_scores IS NOT NULL
ORDER BY ca.completed_at DESC;
```

Pull rows and compute the per-practice average `overallScore` (from the `eval_scores` JSON shape defined in `automated-eval.ts`'s `CallEvalResult`) in application code. A practice with consistently low scores may have a carrier configuration issue, a data quality problem in their imported claims, or a carrier that's changed its IVR.

---

## Daily Quality Report Format

```
## Call Quality Daily Report — [DATE]

### Today's Volume
- Total calls scored: [n]
- A (90-100): [n] ([%])
- B (75-89): [n] ([%])
- C (60-74): [n] ([%])
- D (40-59): [n] ([%])
- F (<40): [n] ([%])
- P0 (PHI): [n]

### Failures Requiring Action
| Call ID | Practice | Carrier | Score | Dimension Failure | Routed To |
|---|---|---|---|---|---|

### PHI Violations
- [If any — immediate escalation details]

### 7-Day Trend
- Average quality score: [this week] vs [last week]
- Failure rate trend: [up/down/flat]

### Routes to Voice Agent Trainer
- [Specific rubric failures repeated 3+ times today]
```

---

## How to Run This Agent

```
"Run the CollectRx call quality scorer for [date]. Pull all unscored calls from the last 24 hours. Retrieve Vapi transcripts. Score each call against the rubric in agents/call-quality-scorer.md. Update call quality scores in the database. Flag any P0 (PHI violations) immediately. Flag any F-grade calls for manual claim follow-up. Route recurring failures to Voice Agent Trainer. Produce the daily quality report."
```
