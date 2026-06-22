# CollectRx Escalation Triage Agent

**Purpose:** Review open escalations across all practices, recommend resolution paths, flag claims approaching write-off thresholds, and identify patterns that indicate systemic problems (IVR issues, carrier policy changes, script gaps). Run weekly or on-demand for a specific practice.

---

## Context

Claims are escalated when:
1. AI cannot resolve — 3 failed attempts
2. Carrier signals denial requiring documentation or appeal
3. Claim is >90 days old (auto-escalated at queue entry)
4. Staff manually escalates during a live call takeover

Resolution options (from `EscalationResolution` type):
- `resolved` — carrier confirmed payment or issue closed
- `appealing` — formal appeal submitted, claim paused
- `written_off` — claim is not worth pursuing further
- `paused_for_review` — staff needs more information

An escalation sitting open longer than 14 days without a resolution decision is a problem.

---

## Triage Checklist

### Stale Escalations

Query escalations where `status = 'open'` and `createdAt < NOW() - INTERVAL '14 days'`:

```sql
SELECT e.*, ic.amountClaimed, ic.createdAt as claimCreatedAt,
       DATE_PART('day', NOW() - ic.createdAt) AS claim_age_days,
       DATE_PART('day', NOW() - e.createdAt) AS escalation_age_days
FROM escalations e
JOIN insurance_claims ic ON ic.id = e.claimId
WHERE e.status = 'open'
  AND e.createdAt < NOW() - INTERVAL '14 days'
ORDER BY ic.amountClaimed DESC;
```

For each: recommend `appealing`, `written_off`, or `paused_for_review` based on:
- Amount: <$200 → often better to write off than pursue
- Claim age: >80 days → getting close to practical uncollectibility
- Reason: `denied_missing_docs` → almost always worth submitting docs and re-trying
- Reason: `denied_carrier_error` → worth appealing if amount > $500
- Carrier: certain carriers have known error rates worth appealing (identify from carrier stats)

### High-Value Open Escalations

```sql
SELECT e.*, ic.amountClaimed
FROM escalations e
JOIN insurance_claims ic ON ic.id = e.claimId
WHERE e.status = 'open'
  AND ic.amountClaimed > 100000  -- > $1,000 in cents
ORDER BY ic.amountClaimed DESC;
```

Any claim >$1,000 that is escalated and open must be actively managed. These should never age past 21 days in escalation without a decision.

### Pattern Detection

Group open escalations by `reason` and `carrierId`:

```sql
SELECT e.reason, ic.carrierId, COUNT(*) as count, 
       SUM(ic.amountClaimed) as total_cents
FROM escalations e
JOIN insurance_claims ic ON ic.id = e.claimId
WHERE e.status = 'open'
GROUP BY e.reason, ic.carrierId
ORDER BY count DESC;
```

**Pattern flags:**

| Pattern | Interpretation | Action |
|---|---|---|
| `denied_missing_docs` for same carrier, >3 claims | Carrier's documentation requirements changed | Update carrier-specific notes in Vapi prompt; review what docs to submit |
| `ivr_failure` escalations clustering on one carrier | IVR change (see Carrier IVR Health agent) | Update IVR navigation prompt |
| `denied_carrier_error` >5 claims same carrier | Carrier system issue or coverage rule change | Contact carrier directly; consider temporary pause |
| All escalations for one practice | Practice data quality issue | Review their CSV import, claim formatting |

### Claims Approaching Write-Off Threshold

Claims that are >75 days old and still escalated are at risk of becoming practically uncollectable:

```sql
SELECT e.*, ic.amountClaimed, 
       DATE_PART('day', NOW() - ic.createdAt) AS claim_age_days
FROM escalations e
JOIN insurance_claims ic ON ic.id = e.claimId
WHERE e.status = 'open'
  AND DATE_PART('day', NOW() - ic.createdAt) > 75
ORDER BY claim_age_days DESC;
```

For each: notify the practice. These need a human decision before day 90.

---

## Resolution Recommendations

When recommending resolution for a specific escalation:

**Recommend `appealing`** when:
- Amount > $500
- Denial reason is `denied_carrier_error` (carrier made an error, not the practice)
- Claim is < 60 days old
- Practice has submitted the correct documentation

**Recommend `resolved` (with manual verification)** when:
- Practice has verbal or written confirmation from carrier that payment is processing
- Payment appears in the practice's EOB but not yet in system

**Recommend `written_off`** when:
- Amount < $200
- Claim is >80 days old
- Two appeal attempts have failed
- Carrier has issued a final denial with no further recourse

**Recommend `paused_for_review`** when:
- Missing documentation that the practice needs to gather
- COB (coordination of benefits) dispute where subscriber info is needed
- Claim requires resubmission with corrected CDT codes

---

## Report Format

```
## Escalation Triage — [DATE]

### Summary
- Total open escalations: [n] ($[total amount])
- Stale (>14 days): [n] ($[amount])
- High-value (>$1,000): [n] ($[amount])
- Approaching write-off (>75 days): [n] ($[amount])

### Patterns Detected
- [Carrier + reason + count + recommended action]

### Priority Escalations (sorted by: high value + stale)
| Claim Ref | Practice | Carrier | Amount | Age | Escalation Age | Recommended Action |
|---|---|---|---|---|---|---|
| [data] |

### Systemic Issues Requiring Prompt Fix
- [Any IVR drift or carrier policy change flagged by pattern analysis]

### Write-Off Candidates (recommend notifying practice)
- [List with amounts and ages]
```

---

## How to Run This Agent

```
"Run the CollectRx escalation triage. Query open escalations, group by reason and carrier, identify patterns, flag stale and high-value items. Work through agents/escalation-triage.md and produce the triage report with resolution recommendations per escalation. Sort by urgency: high-value first, then stale, then pattern issues."
```
