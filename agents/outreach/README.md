---
model: claude-haiku-4-5-20251001
---

# CollectRx Outreach Pipeline

**This is a governance layer, not a new sending engine.** CollectRx already has a working
marketing/growth backend at [`Collect-RX-main/src/server/marketing/`](../../Collect-RX-main/src/server/marketing/)
(prospect harvesting, scoring, email enrichment, a CASL-aware send scheduler, per-province
send windows, stage-based sequencing, reply/engagement tracking). It also already has five
domain agents in [`../`](../) that cover pieces of this: `client-acquisition.md` (ICP,
pipeline, outreach copy), `market-intelligence.md`, `competitive-intelligence.md`,
`hallucination-detector.md` (pattern this pipeline's gate follows), and `compliance-checker.md`
(flags CASL as an open item for email content — this pipeline closes that gap).

The agents in this directory sit **above** that engine: they research, verify, draft, and
gate a batch of outreach before anything queues in `emailCampaignScheduler.ts`. None of them
re-implement sending, scoring, or enrichment — they call into and reason about the real code.

## Why this exists

The operator's ask was for a multi-agent system that (1) builds a portfolio of Canadian dental
prospects, (2) finds contact info, (3) drafts outreach, and (4) sends it — but with a hard rule:
**nothing goes out until every claim about a prospect and every claim about CollectRx has been
verified**, and the orchestrator is the one enforcing that, not any individual drafting agent.

## Two things in the original ask that conflict with what's already built

Flagging these rather than silently overriding either the ask or the code:

1. **"Send at Monday 7am EST"** — `sendWindow.ts` already computes a per-province local-time
   send window (`America/Vancouver`, `America/Edmonton`, `America/Toronto`, etc.) so a BC
   practice isn't emailed at 4am local. A flat 7am ET blast would defeat that. Recommendation:
   keep the existing per-province window and treat "Monday morning" as the target day, not a
   fixed clock time across all time zones. The orchestrator should confirm this with the
   operator before the first batch, not decide it unilaterally.
2. **AI-personalized cold opener** — `aiPersonalization.ts` deliberately does **not** use an
   LLM to write cold-outreach openers; the comment in the source is explicit: "Gemini is not
   used for openers — avoids fabricated social proof." Cold sends (`ProspectStage: new`) use
   standardized templates with merge fields only. This pipeline's Personalization Agent
   (below) should treat deep personalization as reserved for `contacted`/`engaged`+ stages,
   and anything it drafts for a `new`-stage cold send still has to clear the Hallucination
   Gate before it can override the template default.

## Agent Roster

| Agent | File | Role |
|---|---|---|
| **Outreach Orchestrator** | `orchestrator.md` | Owns the goal, runs the pipeline, enforces the pre-send verification gate, is the only agent allowed to approve a batch for human sign-off |
| **Backend State Agent** | `backend-state.md` | Ground truth on what CollectRx actually does today — reads the codebase and PATH-TO-DELIVERY, not memory |
| **Market Research Agent** | `market-researcher.md` | Deep research on the specific ICP cross-section; extends `market-intelligence.md` and `competitive-intelligence.md`, doesn't duplicate them |
| **Product Lead Agent** | `product-lead.md` | Product direction and "what's next" narrative, bounded to what Backend State confirms is shipped or credible near-term |
| **GTM Strategist Agent** | `gtm-strategist.md` | Turns research + product direction into a channel/sequencing plan against the existing `sequenceEngine.ts` stages |
| **Persona Classifier Agent** | `persona-classifier.md` | Buckets contacts by role, judges whether the found person is actually the right one to reach, and enforces cross-channel contact history (e.g. "already LinkedIn-connected, no reply — don't message again there") |
| **Personalization Agent** | `personalization.md` | Drafts the actual message per persona, ethos/pathos/logos — every specific claim must be sourced |
| **Hallucination Gate Agent** | `hallucination-gate.md` | Fact-checks every claim in every draft against a real source before it can leave the pipeline |
| **Compliance & Deliverability Gate** | `compliance-gate.md` | CASL basis, sender identity, unsubscribe handling, batch/rate limits, domain reputation — the last technical/legal check |

## Pipeline Order

```
Market Research Agent ──┐
Backend State Agent ────┼──→ GTM Strategist Agent ──→ Persona Classifier Agent
Product Lead Agent ─────┘                                        │
                                                                   ▼
                                                     Personalization Agent
                                                                   │
                                                                   ▼
                                                     Hallucination Gate Agent ──(reject/revise loop)
                                                                   │
                                                                   ▼
                                                     Compliance & Deliverability Gate
                                                                   │
                                                                   ▼
                                                     Outreach Orchestrator (final review)
                                                                   │
                                                                   ▼
                                                     Human approval (Khalid) ──→ queued in
                                                     emailCampaignScheduler.ts / sequenceEngine.ts
```

Every arrow into the Orchestrator is a report, not a send. **No agent in this directory sends
a real email or messages a real person.** The Orchestrator's job is to assemble a batch that
has cleared every gate and hand it to the operator for the go/no-do decision, and only then
does the existing production scheduler (or the operator, manually) execute it.

## What's explicitly out of scope for these agents

- Actually dispatching LinkedIn messages, cold calls, or emails. That's a production action
  with legal exposure (CASL) and reputational cost if wrong — it needs a human in the loop
  every time, per the Orchestrator's gate, not agent autonomy.
- Rebuilding prospect scoring, email enrichment, or the send scheduler. Those exist in
  `Collect-RX-main/src/server/marketing/`. Agents read and reason about them; they don't fork
  the logic into a prompt.
- Re-deriving the ICP from scratch. `client-acquisition.md` already defines it — Market
  Research and GTM Strategist consume it, they don't redefine it.

## How to Run This Pipeline

```
"Run the CollectRx outreach pipeline for [region/segment]. Start with Market Research and
Backend State in parallel, feed both into GTM Strategist, run Persona Classifier on the
resulting contact list, draft with Personalization Agent, and run every draft through the
Hallucination Gate and Compliance & Deliverability Gate before handing the batch to the
Outreach Orchestrator for final review. Stop and report to the operator before anything is
queued for actual send — do not dispatch."
```
