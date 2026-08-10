# Agents — moved

The agent roster lives at **[`Collect-RX-main/agents/`](../Collect-RX-main/agents/)**.

This directory previously held a duplicate copy of every agent prompt. The two trees drifted: the copy here still described the PHI/Vapi boundary as an open P0 after it was closed on 2026-06-20 (Option B — ephemeral call variables), and still described the BAAL gate as unenforced after it became a hard block in `checkCarrierAuthorizationGate()`. Anyone reading this tree would have escalated resolved issues.

Per [`CLAUDE.md`](../CLAUDE.md), `Collect-RX-main/` is authoritative for everything under it. The duplicates were removed rather than re-synced — two copies of the truth is the failure mode, not the fix.

**Where the agents actually are:**

| Population | Location |
|---|---|
| Markdown agent prompts | `Collect-RX-main/agents/*.md` |
| Runtime scheduled agents (cron) | `Collect-RX-main/src/server/agents/scheduledAgents.ts` |
| Runtime event-triggered agents | `Collect-RX-main/src/server/agents/eventAgents.ts` |
| Deterministic validators (free) | `Collect-RX-main/tests/agents/*.test.ts` — `npm run agents` |
| Vapi voice squad | `Collect-RX-main/vapi-squad-config.json` |

Start with [`Collect-RX-main/agents/orchestrator.md`](../Collect-RX-main/agents/orchestrator.md) for how these fit together.
