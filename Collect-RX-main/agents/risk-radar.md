# CollectRx Risk Radar Agent

**Purpose:** Continuously monitor all risk domains and surface the ones that need attention before they become incidents. CollectRx operates in a high-stakes environment — regulatory violations, PHI breaches, financial misreporting, and carrier blocks each carry serious consequences. This agent watches everything and says so clearly. Run daily. Feeds into: Incident Response (if threshold crossed), Khalid (if risk level elevated).

---

## Risk Domains

### Domain 1: Regulatory Risk (CRTC / PHIPA / PIPEDA)

**Red flags:**
- Any call missing CRTC disclosure (caught by call-quality-scorer)
- Any PHI on a Vapi call (caught by hallucination-detector / call-quality-scorer)
- CRTC 2026-132 consultation produces a draft rule restricting AI voice
- PHIPA audit log gaps (caught by phi-access-log-reviewer)
- Authorization status not submitted for a carrier and calls are running for that carrier

**Current open regulatory risks:**
- CRTC 2026-132: active consultation — monitor monthly via compliance-checker
- Vendor BAAs (Vapi, Twilio): operator/legal execution pending — see `LEGAL-REVIEW-PROMPT.md`

**Closed (2026-06-20):**
- PHI/Vapi boundary: Option B documented in `PHI-VAPI-BOUNDARY.md`
- BAAL gate: hard-enforced in `checkCarrierAuthorizationGate()`

**Risk level:** MEDIUM (vendor BAAs pending) / LOW once BAAs executed

### Domain 2: Carrier Block Risk

**Red flags:**
- CARRIER_BLOCK phrase detected (caught by carrierBlockPhrases.ts)
- CARRIER_BLOCK rate >2 incidents/7 days (caught by carrier-ivr-health)
- Any manual report of carrier suspecting automation
- Call pattern that could trigger carrier fraud detection (high volume, uniform timing)

**Monitoring query:**
```sql
SELECT ic.carrier_id, COUNT(*) AS block_events
FROM call_attempts ca
JOIN insurance_claims ic ON ic.id = ca.claim_id
WHERE ca.outcome = 'BLOCK_DETECTED'
  AND ca.completed_at > NOW() - INTERVAL '7 days'
GROUP BY ic.carrier_id
ORDER BY block_events DESC;
```

For the authoritative signal (a carrier suspension currently in effect, not just a block-flagged call), check `carrier_block_events` instead — see incident-response.md's IC-2.

**Risk level:** LOW (if no recent blocks) / CRITICAL (if active block)

### Domain 3: Financial Integrity Risk

**Red flags:**
- Hallucination-detector finds confirmed CRITICAL-severity hallucination
- amountRecovered populated without corresponding transcript confirmation
- RESOLVED rate statistically abnormal (>70% over 7 days)
- Any practice disputing a reported outcome

**This domain has the highest legal exposure outside of CRTC.** If CollectRx misreports a financial outcome, the practice makes decisions based on false AR data. That's actionable.

**Risk level:** Check daily via hallucination-detector and analytics-pipeline outputs.

### Domain 4: PHI Breach Risk

**Red flags:**
- PHI access by unauthorized user (caught by phi-access-log-reviewer)
- platform_admin accessing PHI without explicit practice grant
- Unusual volume of detokenization events
- Any user accessing PHI data outside Canadian borders (server location change)
- PHI visible in any log file

**This domain triggers PHIPA notification obligations if breached.**

**Monitoring:** phi-access-log-reviewer runs monthly. Between monthly reviews, risk-radar watches for:
```sql
-- After-hours PHI access
SELECT * FROM phi_access_events
WHERE EXTRACT(HOUR FROM created_at) NOT BETWEEN 7 AND 22
  AND created_at > NOW() - INTERVAL '24 hours';
```

**Risk level:** CRITICAL if breach confirmed / LOW if no anomalies.

### Domain 5: Platform Availability Risk

**Red flags:**
- Queue engine heartbeat gap >2 hours during call window
- Fly deployment failure
- Vapi API downtime
- Stripe webhook failure (practice upgrades/downgrades not processing)
- Database connection errors

**Business impact:** Every hour the queue engine is down during call window is lost recovery capacity for active practices. More critically, if practices notice missed calls, churn risk increases.

**Monitoring query (queue heartbeat proxy — there is no dedicated heartbeat table; see analytics-pipeline.md §6):**
```sql
SELECT MAX(updated_at) AS last_heartbeat,
       NOW() - MAX(updated_at) AS gap_since_last_process
FROM call_queue;
```

**Risk level:** Alert if gap >2 hours during 8am-5pm EST.

### Domain 6: Financial / Business Risk

**Red flags:**
- Trial conversion rate <20% for 2 consecutive months
- Any Scale tier customer churning (highest revenue impact)
- Gross margin on Scale tier dropping below 30%
- Stripe payment failures exceeding 10% of active subscriptions
- Overage confirmations not being collected (pauseOnSoftStop bypassed)

**Monitoring:** tier-billing-health runs weekly. Risk-radar monitors between runs.

### Domain 7: Competitive / Market Risk

**Red flags:**
- New direct competitor announced (from competitive-intelligence)
- TELUS Health announces AI voice for provider claims
- Major carrier announces API access for providers (eliminates phone need — product disruption)
- CRTC rules AI voice must disclose specific capabilities (not just "automated system")

**Monitoring:** competitive-intelligence runs monthly. Risk-radar reviews for late-breaking news.

---

## Risk Level Definitions

| Level | Definition | Action |
|---|---|---|
| CRITICAL | Imminent or active harm — legal, financial, or PHI | Stop relevant operations; alert Khalid immediately; trigger incident-response |
| HIGH | Risk likely to materialize within 30 days without action | Escalate to Khalid; put mitigation plan in place this week |
| MEDIUM | Risk likely within 90 days; not yet imminent | Track weekly; assign mitigation owner |
| LOW | Risk exists but unlikely without a major change | Log; review monthly |

---

## Daily Risk Snapshot

```
## Risk Radar — [DATE]

### CRITICAL Risks (requires immediate action)
- [Risk] — Domain: [domain] — Evidence: [what triggered it] — Action: [immediate step]

### HIGH Risks (requires action this week)
- [Risk] — Domain: [domain] — Days open: [n] — Mitigation: [plan]

### MEDIUM Risks (requires monitoring)
- [Risk] — Domain: [domain] — Next review: [date]

### Domain Health Summary
| Domain | Level | Notes |
|---|---|---|
| Regulatory | 🔴/🟡/🟢 | |
| Carrier Block | 🔴/🟡/🟢 | |
| Financial Integrity | 🔴/🟡/🟢 | |
| PHI Breach | 🔴/🟡/🟢 | |
| Platform Availability | 🔴/🟡/🟢 | |
| Business / Financial | 🔴/🟡/🟢 | |
| Competitive / Market | 🔴/🟡/🟢 | |

### Open Decisions Contributing to Risk
- Vendor BAAs (Vapi, Twilio): pending operator/legal execution
- AbelDent re-engagement: product decision pending
```

---

## How to Run This Agent

```
"Run the CollectRx daily risk radar. Review outputs from: call-quality-scorer (CRTC/PHI), hallucination-detector (financial integrity), analytics-pipeline (data quality, carrier block rate), phi-access-log-reviewer if run today, tier-billing-health if run this week, competitive-intelligence if run this month. Assess all 7 risk domains. Assign risk levels. Flag any CRITICAL risks for immediate escalation to Khalid and trigger of incident-response agent. Produce the daily risk snapshot."
```
