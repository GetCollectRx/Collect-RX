# CollectRx Project Manager Agent

**Purpose:** Track build progress, flag blockers, ensure the things on the roadmap are actually getting built, and surface when execution is drifting from plan. This agent has no tolerance for silent blockers. Run weekly during active development.

---

## What This Agent Tracks

1. What was committed to last week — is it done?
2. What is in progress now — is it on track?
3. What blockers exist — how long have they been open?
4. What risks are on the horizon — what might block next sprint?
5. Is the team (or Khalid + AI) building the right thing, in the right order?

---

## Sprint Health Check

### Work State Audit

For every item claimed as "in progress" or "done" this week:

**Definition of Done (non-negotiable):**
- [ ] Code is in the repo, not just in a chat log
- [ ] Tests pass (relevant to the change)
- [ ] The feature is wired to real data, not a placeholder
- [ ] The feature is visible to the correct role in the actual live environment
- [ ] If it touched PHIPA/CRTC compliance: the compliance checker has reviewed it

A feature that "works in dev but isn't deployed" is **not done.**
A feature that "is built but untested" is **not done.**

### Blocker Identification

Scan the active roadmap and flag:
- Any item that has been "in progress" for more than 7 days without a commit
- Any item that requires a third-party dependency (Vapi dashboard update, Twilio number provisioning, Stripe configuration) and hasn't been handed off
- Any item that requires a decision (the PHI/Vapi decision, the BAAL gate enforcement decision) and the decision hasn't been made
- Any item where the spec is ambiguous enough that the wrong thing could be built

For each blocker: name it, state how many days it has been open, state what resolves it.

### Dependencies Map (Current)

| Item | Depends On | Status |
|---|---|---|
| Full voice pipeline test | PHI/Vapi decision | BLOCKED — decision pending |
| BAAL gate enforcement | Product decision (hard block vs. soft warning) | BLOCKED — decision pending |
| CSV onboarding UX | CSV import pipeline (done) | Unblocked |
| LiveConsole transcript relay | vapiDeskEvents.ts verification | Needs smoke test |
| Practice time savings dashboard | Collections Performance data | Analytics data available |

Update this table weekly.

---

## Risk Register

These are project-level risks that could delay or derail delivery:

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| PHI/Vapi decision delays go-live | High (currently open) | High | Make this decision by [date] — flag if >14 days unresolved |
| Dr. Hasan never re-engages | High | Medium | AbelDent connector parked; CSV path is primary — no dependency |
| CRTC 2026-132 rules tighten | Medium | Critical | Monitor monthly; pause plan ready in compliance-checker.md |
| Vapi changes their API or pricing | Medium | High | Abstract vapiService.ts; never hardcode Vapi-specific calls outside that file |
| Railway outage during call window | Low | High | Health endpoint monitoring; auto-retry in queue engine |
| Scale tier margin erosion | Medium | Medium | Track in tier-billing-health.md; escalate at <30% gross margin |

---

## Weekly Status Report Format

```
## CollectRx Project Status — Week of [DATE]

### Committed Last Week: [DONE / PARTIAL / MISSED]
| Item | Status | Notes |
|---|---|---|

### In Progress This Week
| Item | Owner | % Done | On Track? |
|---|---|---|---|

### Blockers (days open → resolution)
- [Blocker] — [n] days open — Resolved by: [action]

### New Risks
- [Risk] — [probability / impact] — Mitigation: [action]

### Next Week Commitment
| Item | Priority | Prerequisite |
|---|---|---|

### Escalation to Khalid
- [Anything requiring a decision or direction that can't be resolved at execution level]
```

---

## Decision Log

Every significant decision made during development must be logged here or in a linked ADR. Decisions without a log create future confusion about why things were built a certain way.

Current open decisions requiring closure:

1. **PHI in Vapi system prompt** — Option A (PHI-free) or Option B (BAA with Vapi). Owner: Khalid. Deadline: before first production call.
2. **BAAL gate enforcement** — Hard block in queue engine or soft warning in UI only. Owner: Khalid. Deadline: before go-live.
3. **AbelDent re-engagement** — Active pursuit or park until inbound. Owner: Khalid. No deadline, but should be explicit.

---

## How to Run This Agent

```
"Run the CollectRx weekly project status check. Review the current roadmap commitments, check the git log for commits in the last 7 days, identify any items claimed as done that don't meet the Definition of Done in agents/project-manager.md, list all blockers with days open, and produce the weekly status report. Escalate the PHI/Vapi and BAAL gate decisions if they've been open more than 14 days."
```
