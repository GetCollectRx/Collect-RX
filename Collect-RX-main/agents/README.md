# Agents — moved to the repo root

The agent roster lives at **[`../../agents/`](../../agents/)** (repo root), and the orchestration subagents at **[`../../.claude/agents/`](../../.claude/agents/)**.

This directory held a second copy of every agent prompt. The two trees drifted badly enough to be dangerous: this copy described the PHI/Vapi P0 as open after it closed on 2026-06-20 (Option B — ephemeral call variables) and the BAAL gate as unenforced after it became a hard block in `checkCarrierAuthorizationGate()`. Anyone reading here would have escalated resolved issues.

The root tree is canonical because it is the one the runtime loads: commit `2d22558` added `model: claude-haiku-4-5-20251001` frontmatter to all 29 files there, and `agentRunner.ts:loadAgentPrompt()` reads them. This copy never received that frontmatter.

Duplicates were deleted rather than re-synced — two copies of the truth is the failure mode, not the fix.

**Where the agents actually are:**

| Population | Location |
|---|---|
| Orchestration subagents | `.claude/agents/*.md` |
| Domain agent prompts | `agents/*.md` |
| Runtime scheduled (cron) | `Collect-RX-main/src/server/agents/scheduledAgents.ts` |
| Runtime event-triggered | `Collect-RX-main/src/server/agents/eventAgents.ts` |
| Deterministic validators (free) | `Collect-RX-main/tests/agents/*.test.ts` — `npm run agents` |
| Vapi voice squad | `Collect-RX-main/vapi-squad-config.json` |

The scheduled and event registries are the *runtime execution of* the domain prompts, not additional agents — 24 cron + 7 event − 2 in both = 29, exactly the number of prompt files. Summing them triple-counts.

Start with [`.claude/agents/orchestrator.md`](../../.claude/agents/orchestrator.md) for how these fit together.
