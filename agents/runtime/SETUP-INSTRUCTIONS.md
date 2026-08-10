# Agent Routine Setup — Fly.io Configuration

## Critical: API Base URL

All agents require these environment variables when scheduled as Claude Routines:

```
API_BASE=https://collect-rx.fly.dev
AGENT_RUNTIME_SECRET=<secret from: fly secrets get AGENT_RUNTIME_SECRET --app collect-rx>
```

**⚠️ DO NOT use railway.app** — that deployment is decommissioned (404). Always use `collect-rx.fly.dev`.

## Fly.io Secret Setup

```bash
# Get the current secret (required for agent auth):
fly secrets get AGENT_RUNTIME_SECRET --app collect-rx

# If not set, generate and store one:
fly secrets set AGENT_RUNTIME_SECRET="$(openssl rand -hex 32)" --app collect-rx
```

## Claude Routine Configuration

When creating each agent routine in Claude (Web, Desktop, or CLI):

1. **Routine name:** `CollectRx: <agent-name>`
2. **Trigger:** Cron expression from `schedules.md`
3. **Prompt template:** Use the prompt from `schedules.md` with these substitutions:
   - `{{API_BASE}}` → `https://collect-rx.fly.dev`
   - `{{AGENT_RUNTIME_SECRET}}` → *(use the secret from `fly secrets get` above)*
4. **Model:** `claude-haiku-4-5-20251001` (already set in each agent file)

## Example: Weekly Analytics Pipeline

**Routine name:** `CollectRx: analytics-pipeline`  
**Cron:** `0 6 * * 1` (Monday 6am ET)  
**Prompt:**

```
API_BASE=https://collect-rx.fly.dev
AGENT_RUNTIME_SECRET=<your-secret>

You are the CollectRx analytics-pipeline agent. Read agents/analytics-pipeline.md and agents/runtime/agent-runner-template.md. Run all 7 weekly data quality checks using the CollectRx MCP tools. Calculate the weekly quality score. Flag any threshold breaches. POST output to /api/agent-runs per the runner template. AGENT_NAME=analytics-pipeline. Downstream: risk-radar, post-call-debrief, hallucination-detector, call-quality-scorer.
```

## All Agents (19 total)

See `schedules.md` for complete cron schedule and prompt for each agent.

## Verification

After setting up routines, confirm agents can reach Fly:

```bash
curl -H "Authorization: Bearer $AGENT_RUNTIME_SECRET" \
  https://collect-rx.fly.dev/api/agent-runs/context?agents=test&hours=1
```

Should return 200 OK (not 404 or 401).
