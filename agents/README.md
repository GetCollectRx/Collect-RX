# CollectRx Agent System

**This is the Claude Code / Cowork copy**, carrying the `model:` frontmatter added by `2d22558`. It is **not** what the server runs: `agentRunner.ts:loadAgentPrompt()` reads `$AGENTS_DIR`, which resolves to the copy under [`Collect-RX-main/agents/`](../Collect-RX-main/agents/) — that directory is inside the Docker build context and is what ships. The server runtime executes these prompts on Gemini (`gemini-2.0-flash`) and does not parse frontmatter.

⚠️ **The two trees drift and nothing checks them.** The root copy has model frontmatter the shipped copy lacks, and their READMEs have contradicted each other on compliance status. Edit both, and diff them before trusting either.

**29 domain agents** covering every dimension of building and running CollectRx: product quality, compliance, business intelligence, call performance, client acquisition, analytics, and risk. Orchestration subagents (orchestrator, investigator, engineering, simulator, integration-tester, vapi-configurator, rollout-manager, escalation-manager, pre-launch-audit, weekly-health-reporter) live in [`.claude/agents/`](../.claude/agents/).

> **Billing (2026-07-09):** Do **not** run these markdown prompts via Claude Code / `loop_runner.py` with your Anthropic API key — that pattern caused ~$56/week in Opus API charges. Use the **free** vitest agents instead: `npm run agents` (deterministic, no LLM). Paid LLM evals require `COLLECTRX_ANTHROPIC_EVAL=1` explicitly. All agents here run `claude-haiku-4-5` by design (commits `c95883a`, `2d22558`).

> **Compliance status (2026-06-20):** PHI boundary closed (Option B — ephemeral Vapi call variables, `docs/compliance/PHI-VAPI-BOUNDARY.md`). BAAL hard gate enforced in `validateDispatch()`. Legal templates pending counsel — see `docs/compliance/LEGAL-REVIEW-PROMPT.md`.

### Counting agents

Five populations overlap; do not sum them. The cron registry (`scheduledAgents.ts`, 24 entries) and event registry (`eventAgents.ts`, 7 triggers) are the **runtime execution of the 29 prompts here**, not additional agents — 24 + 7 − 2 in both = 29, and every scheduled name resolves to a file in this directory. Adding the registries triple-counts the same agents; that error has produced published totals of 35 and 65. Separately: 9 deterministic validators in `Collect-RX-main/tests/agents/`, 5 Vapi voice squad members, and `productImprovementAgent.ts` (runtime-only, no prompt file). Derive the roster with the commands in [`.claude/agents/orchestrator.md`](../.claude/agents/orchestrator.md) §2 rather than quoting a number.

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

## Open Decisions

1. **AbelDent re-engagement** — Active pursuit or park. Owner: Khalid.

## Operator / Legal (blocking production scale)

1. **Counsel review** — Execute BAAL, Platform Agreement, Privacy Policy. Prompt: `Collect-RX-main/docs/compliance/LEGAL-REVIEW-PROMPT.md`.
2. **Vendor BAAs** — Vapi, Twilio, SendGrid, Stripe (Document 5 in the legal prompt).

## Closed Decisions (2026-06-20)

1. **PHI / Vapi boundary** — Option B (ephemeral call variables). See `Collect-RX-main/docs/compliance/PHI-VAPI-BOUNDARY.md`.
2. **BAAL gate** — Hard block in `checkCarrierAuthorizationGate()` via `validateDispatch()`. Requires BAAL + provider number + voice agent enabled.

---

## How to Invoke Any Agent

Paste the "How to Run This Agent" prompt from the relevant file into a new Cowork session. Each prompt is self-contained — it tells the agent what to read, what to check, and what format to report in.

---

## How to Add a New Agent

1. Create `agents/[agent-name].md` with: Purpose, Inputs, Protocol/Checklist, Output Format, How to Run.
2. Add to the roster and weekly run order in this README.
3. Map it into the information flow diagram.
4. If it monitors call behavior, add test cases to the voice-agent-trainer test library.
