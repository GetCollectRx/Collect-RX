# Agent Routine Setup — Fly.io Configuration

## Critical: Set Environment Variables on Fly.io

All agents read these environment variables. Set them once on the Fly app, not per-routine:

```bash
# Set the Fly backend URL
fly secrets set API_BASE="https://collect-rx.fly.dev" --app collect-rx

# Generate and set the agent auth secret
fly secrets set AGENT_RUNTIME_SECRET="$(openssl rand -hex 32)" --app collect-rx
```

**⚠️ DO NOT use railway.app** — that deployment is decommissioned (404). Always use `collect-rx.fly.dev`.

## Verify Secrets Are Set

```bash
# Show that secrets exist (values redacted):
fly secrets list --app collect-rx

# Test agent can reach Fly:
curl -H "Authorization: Bearer $(fly secrets get AGENT_RUNTIME_SECRET --app collect-rx)" \
  https://collect-rx.fly.dev/api/agent-runs/context?agents=test&hours=1
```

Should return 200 OK (not 404 or 401).

## Claude Routine Configuration

When creating routines in Claude, the prompt is simple (no substitution needed):

```
You are the CollectRx <agent-name> agent. Read agents/<agent-name>.md and agents/runtime/agent-runner-template.md. [Full prompt from schedules.md].
```

The agent automatically reads `API_BASE` and `AGENT_RUNTIME_SECRET` from Fly environment at runtime.

## All Agents (19 total)

See `schedules.md` for:
- Cron schedule for each agent
- Complete prompt template for each agent

All use Haiku model (cost-efficient, fully capable for routine operations).
