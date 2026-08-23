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

**This pipeline runs autonomously — no live human sign-off per batch.** The operator gave
standing authorization for that, on the condition that anything requiring judgment gets
resolved by an agent with a fixed, fail-closed policy instead of by him personally reviewing
every batch (see `approval-agent.md` for the exact scope of that authorization and the
decisions it resolves). The gates themselves — verification checklist, hallucination check,
CASL/compliance check — are unchanged and still hard-block anything that doesn't clear them;
what changed is that clearing every gate is now sufficient to release a contact, rather than
also requiring a person to say go.

## How this stays controlled

Running with no live human sign-off per batch (see above) only works if the pipeline can't
quietly do something wrong at scale. Five independent controls, from most to least
routine:

1. **Gates with veto power, not advice.** Hallucination Gate and Compliance Gate reject
   outright; nothing downstream can override a CRITICAL/HIGH/FAIL verdict.
2. **Pre-Send Verification Checklist** (`orchestrator.md`) — 7 must-pass criteria per contact.
   One failure drops that contact, no partial credit.
3. **Circuit breakers** (`approval-agent.md`) — a segment pauses itself automatically if its
   own gate-rejection rate or exclusion rate signals something upstream is systematically off,
   without waiting for anyone to notice.
4. **Hard weekly send cap** (`approval-agent.md`) — a flat ceiling (`OUTREACH_MAX_WEEKLY_SENDS`)
   that holds even if every gate above passed everything. The backstop for a bug in the gates
   themselves, not for bad contacts.
5. **Kill switch** (`orchestrator.md`) — `OUTREACH_KILL_SWITCH=true` as a Fly.io secret halts
   the entire pipeline, every segment, before a single downstream agent runs. The one control
   that needs no code change and no waiting for a batch to finish.

Model allocation is a sixth, quieter control: the steps where a wrong call reaches a real
person (persona judgment, drafting, fact-checking, compliance) run on Sonnet; the
research/aggregation/mechanical steps run on Haiku. See each agent's frontmatter.

## Two things in the original ask that conflict with what's already built

Flagging these rather than silently overriding either the ask or the code — both are now
resolved as standing policy so the pipeline doesn't stall on them:

1. **"Send at Monday 7am EST"** — `sendWindow.ts` already computes a per-province local-time
   send window (`America/Vancouver`, `America/Edmonton`, `America/Toronto`, etc.) so a BC
   practice isn't emailed at 4am local. A flat 7am ET blast would defeat that. **Resolved:**
   keep the existing per-province window and treat "Monday morning" as the target day, not a
   fixed clock time across all time zones (`orchestrator.md`, `approval-agent.md`).
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
| **Outreach Orchestrator** | `orchestrator.md` | Owns the goal, runs the pipeline, enforces the pre-send verification gate, assembles the batch Approval Agent acts on |
| **Backend State Agent** | `backend-state.md` | Ground truth on what CollectRx actually does today — reads the codebase and PATH-TO-DELIVERY, not memory |
| **Market Research Agent** | `market-researcher.md` | Deep research on the specific ICP cross-section; extends `market-intelligence.md` and `competitive-intelligence.md`, doesn't duplicate them |
| **Product Lead Agent** | `product-lead.md` | Product direction and "what's next" narrative, bounded to what Backend State confirms is shipped or credible near-term |
| **GTM Strategist Agent** | `gtm-strategist.md` | Turns research + product direction into a channel/sequencing plan against the existing `sequenceEngine.ts` stages |
| **Persona Classifier Agent** | `persona-classifier.md` | Buckets contacts by role, judges whether the found person is actually the right one to reach, and enforces cross-channel contact history (e.g. "already LinkedIn-connected, no reply — don't message again there") |
| **Personalization Agent** | `personalization.md` | Drafts the actual message per persona, ethos/pathos/logos — every specific claim must be sourced |
| **Text Humanizer Agent** | `text-humanizer.md` | Style-only pass on every draft — no em/en dashes, active voice, varied rhythm — before anything reaches the fact-checking gates |
| **Hallucination Gate Agent** | `hallucination-gate.md` | Fact-checks every claim in every draft against a real source before it can leave the pipeline |
| **Compliance & Deliverability Gate** | `compliance-gate.md` | CASL basis, sender identity, unsubscribe handling, batch/rate limits, domain reputation — the last technical/legal check |
| **Approval Agent** | `approval-agent.md` | Releases or auto-excludes each contact based purely on upstream gate verdicts, under the operator's standing authorization — this is what removed the human bottleneck |

## Pipeline Order

```
Market Research Agent ──┐
Backend State Agent ────┼──→ GTM Strategist Agent ──→ Persona Classifier Agent
Product Lead Agent ─────┘                                        │
                                                                   ▼
                                                     Personalization Agent
                                                                   │
                                                                   ▼
                                                     Text Humanizer Agent (style only, no em/en
                                                     dashes — cannot touch claims or sources)
                                                                   │
                                                                   ▼
                                                     Hallucination Gate Agent ──(reject/revise loop)
                                                                   │
                                                                   ▼
                                                     Compliance & Deliverability Gate
                                                                   │
                                                                   ▼
                                                     Outreach Orchestrator (assembles batch)
                                                                   │
                                                                   ▼
                                                     Approval Agent (releases/excludes per fixed
                                                     policy, no live sign-off) ──→ queued in
                                                     emailCampaignScheduler.ts / sequenceEngine.ts
```

**No agent in this directory sends a real email or messages a real person directly** — release
means "queued into the existing production scheduler," which is the thing that actually
dispatches. The Approval Agent's release decision is bounded to contacts that already cleared
every gate; it cannot override a gate, lower a threshold, or bypass the code-level CASL sender-
identity check in `emailCampaignScheduler.ts`. See `approval-agent.md` for the exact scope of
what it's authorized to decide on the operator's behalf and what it explicitly is not.

## What's explicitly out of scope for these agents

- Overriding any gate's FAIL/CRITICAL verdict, no matter how the batch would look otherwise —
  see `approval-agent.md`'s standing-authorization boundaries.
- Rebuilding prospect scoring, email enrichment, or the send scheduler. Those exist in
  `Collect-RX-main/src/server/marketing/`. Agents read and reason about them; they don't fork
  the logic into a prompt.
- Re-deriving the ICP from scratch. `client-acquisition.md` already defines it — Market
  Research and GTM Strategist consume it, they don't redefine it.

## How to Run This Pipeline

```
"Run the CollectRx outreach pipeline for [region/segment]. Start with Market Research and
Backend State in parallel, feed both into GTM Strategist, run Persona Classifier on the
resulting contact list, draft with Personalization Agent, run every draft through the Text
Humanizer Agent, then through the Hallucination Gate and Compliance & Deliverability Gate.
Hand the result to the Approval Agent, which releases anything that passed every gate and
auto-excludes anything that didn't, per the fixed policies in approval-agent.md. Produce the
full batch report — this runs end-to-end without a live approval pause."
```
