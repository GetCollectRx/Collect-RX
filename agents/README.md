# CollectRx Agent System

**29 agents** covering every dimension of building and running CollectRx as a company: product quality, compliance, business intelligence, call performance, client acquisition, analytics, and risk.

> **P0 OPEN:** PHI variables (`{{patient_name}}`, `{{patient_dob}}`) found in `Collect-RX-main/vapi-system-prompt.md`. This directly violates the PHI boundary rule. Production calls must not run until this is resolved. See `vapi-squad-auditor.md` for resolution options.

---

## Agent Roster

| # | Agent | File | Cadence |
|---|---|---|---|
| 1 | **Analytics Pipeline** | `analytics-pipeline.md` | Daily — run before any other analytics |
| 2 | **Risk Radar** | `risk-radar.md` | Daily — escalates CRITICALs to Khalid |
| 3 | **Post-Call Debrief** | `post-call-debrief.md` | Per batch / Daily |
| 4 | **Hallucination Detector** | `hallucination-detector.md` | Daily |
| 5 | **Call Quality Scorer** | `call-quality-scorer.md` | Daily |
| 6 | **Voice Agent Trainer** | `voice-agent-trainer.md` | Weekly |
| 7 | **Carrier IVR Health** | `carrier-ivr-health.md` | Weekly |
| 8 | **Escalation Triage** | `escalation-triage.md` | Weekly |
| 9 | **Collections Performance** | `collections-performance.md` | Weekly |
| 10 | **Tier & Billing Health** | `tier-billing-health.md` | Weekly |
| 11 | **Database Health** | `database-health.md` | Weekly |
| 12 | **Project Manager** | `project-manager.md` | Weekly |
| 13 | **Client Acquisition** | `client-acquisition.md` | Weekly |
| 14 | **Practice Time Savings** | `practice-time-savings.md` | Monthly |
| 15 | **ROI Proof** | `roi-proof.md` | Monthly |
| 16 | **Voice of Customer** | `voice-of-customer.md` | Monthly |
| 17 | **Market Intelligence** | `market-intelligence.md` | Monthly |
| 18 | **Competitive Intelligence** | `competitive-intelligence.md` | Monthly |
| 19 | **Researcher** | `researcher.md` | On-demand |
| 20 | **Product Manager** | `product-manager.md` | Monthly |
| 21 | **PHI Access Log Reviewer** | `phi-access-log-reviewer.md` | Monthly |
| 22 | **Security Auditor** | `security-auditor.md` | Monthly |
| 23 | **Compliance Checker** | `compliance-checker.md` | Quarterly |
| 24 | **Vapi Squad Auditor** | `vapi-squad-auditor.md` | Pre-deploy / Monthly |
| 25 | **Frontend Auditor** | `frontend-auditor.md` | Per-deploy |
| 26 | **Backend Reviewer** | `backend-reviewer.md` | Pre-PR |
| 27 | **Practice Onboarding Validator** | `practice-onboarding-validator.md` | Per new practice |
| 28 | **Release Readiness** | `release-readiness.md` | Pre/post-deploy |
| 29 | **Incident Response** | `incident-response.md` | On-demand (CRITICAL only) |

---

## Agent Groups

### Daily — Call Quality Loop
Post-Call Debrief → Hallucination Detector → Call Quality Scorer → Voice Agent Trainer (weekly synthesis)

### Weekly — Operational Health
Analytics Pipeline → Risk Radar → Carrier IVR Health → Escalation Triage → Collections Performance → Tier & Billing Health → Database Health → Project Manager → Client Acquisition

### Monthly — Analytics & Proof
Practice Time Savings → ROI Proof → Voice of Customer → Market Intelligence → Competitive Intelligence → Product Manager

### On-Demand / Per-Deploy — Build Safety
Frontend Auditor → Backend Reviewer → Vapi Squad Auditor → Practice Onboarding Validator → Release Readiness → Researcher → Incident Response

### Monthly/Quarterly — Compliance
PHI Access Log Reviewer → Security Auditor → Compliance Checker

---

## Information Flow

```
Post-Call Debrief
  → Hallucination Detector (outcome evidence issues)
  → Call Quality Scorer (rubric input)
  → Carrier IVR Health (IVR drift alerts)
  → Voice Agent Trainer (learnings to implement)

Voice Agent Trainer
  → Vapi Squad Auditor (review before publishing prompt changes)

Call Quality Scorer + Collections Performance
  → ROI Proof + Voice of Customer

Market Intelligence + Competitive Intelligence + Voice of Customer
  → Product Manager (roadmap)

Product Manager → Project Manager (sprint planning)

Practice Time Savings + Collections Performance → ROI Proof (client reports)

Risk Radar → Incident Response (CRITICAL triggers)
Risk Radar → Khalid (HIGH+ decisions required)

Client Acquisition → ROI Proof (prospect estimates)
```

---

## Weekly Run Order (Monday)

1. **Analytics Pipeline** — verify data is trustworthy before anything else
2. **Risk Radar** — any CRITICAL issues to address before proceeding?
3. **Call Quality Scorer** — how did calls perform?
4. **Hallucination Detector** — any financial integrity issues?
5. **Post-Call Debrief** — what did we learn from calls?
6. **Collections Performance** — is the product collecting money?
7. **Carrier IVR Health** — are carriers behaving normally?
8. **Escalation Triage** — what needs human attention?
9. **Tier & Billing Health** — is revenue healthy?
10. **Database Health** — is infrastructure sound?
11. **Project Manager** — what's in progress, what's blocked?
12. **Client Acquisition** — pipeline status and next outreach

---

## Open Decisions Blocking Progress

1. **PHI in Vapi system prompt** — Option A (PHI-free design) or Option B (BAA with Vapi). Owner: Khalid. **Blocks: all production calls.**

2. **BAAL gate in queue engine** — Hard block or soft UI warning. Owner: Khalid. **Blocks: CRTC compliance for ADAD.**

3. **AbelDent re-engagement** — Active pursuit or park. Owner: Khalid.

---

## How to Invoke Any Agent

Paste the "How to Run This Agent" prompt from the relevant file into a new Cowork session. Each prompt is self-contained — it tells the agent what to read, what to check, and what format to report in.

---

## How to Add a New Agent

1. Create `agents/[agent-name].md` with: Purpose, Inputs, Protocol/Checklist, Output Format, How to Run.
2. Add to the roster and weekly run order in this README.
3. Map it into the information flow diagram.
4. If it monitors call behavior, add test cases to the voice-agent-trainer test library.
