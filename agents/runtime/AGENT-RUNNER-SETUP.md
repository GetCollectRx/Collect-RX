# Agent Runner Setup — Autonomous Agent Orchestration

The Agent Runner Service is built into the Collect-RX backend and manages autonomous agent scheduling and execution. All 19 agents run inside the Fly.io application via BullMQ job scheduling.

## Architecture

```
Fly.io Backend (collect-rx app)
├── API Process (Express, port 3000)
│   ├── Routes (including /api/agent-runs)
│   ├── registerAgentRunners() - schedules agent jobs at startup
│   └── Database/Stripe/Vapi integrations
└── Worker Process (BullMQ)
    ├── AR Queue - insurance AR ops (RULES_TICK, etc.)
    └── Agent Runner Queue - autonomous agents
        ├── Agent runner worker (concurrency: 1)
        └── Job handler calls runAgent()
```

## Setup (Already Configured)

The agent runner service is automatically initialized when the backend starts:

1. **Environment Variables** (set via Fly CLI):
   ```bash
   fly secrets set API_BASE="https://collect-rx.fly.dev" --app collect-rx
   fly secrets set AGENT_RUNTIME_SECRET="$(openssl rand -hex 32)" --app collect-rx
   fly secrets set ANTHROPIC_API_KEY="sk-..." --app collect-rx
   ```

2. **Redis Configuration**:
   - Uses same Redis instance as AR queue (BullMQ)
   - Queue name: `agent-runner`
   - Connection pooling via IORedis

3. **Agent Registration**:
   - On startup, the API process calls `registerAgentRunners()`
   - Clears old repeatables and registers all 19 agent schedules
   - Each agent registered with 3 retries + exponential backoff

## How It Works

### Agent Execution Flow

1. **Schedule**: BullMQ trigger at cron time (e.g., 06:00 ET Monday for analytics-pipeline)

2. **Job Creation**: AGENT_RUN job added to queue with:
   - `agentName`: analytics-pipeline
   - `cron`: 0 6 * * 1
   - `upstreamAgents`: []
   - `timeWindow`: UTC

3. **Worker Processing** (in worker process):
   - Worker picks job from agent-runner queue
   - Calls `runAgent(job)` from agentRunnerService.ts
   - Correlation ID set for tracing

4. **Agent Execution** (in runAgent):
   ```typescript
   ├── Read agent definition from GitHub (agents/analytics-pipeline.md)
   ├── Read runner template (agents/runtime/agent-runner-template.md)
   ├── Build Claude prompt with:
   │   ├── Agent definition
   │   ├── Runner template
   │   ├── API_BASE and AGENT_RUNTIME_SECRET
   │   └── Upstream agent list
   ├── Call Claude API (claude-haiku-4-5-20251001, 4096 tokens)
   ├── Parse JSON result from Claude response
   └── POST result to /api/agent-runs with Bearer auth
   ```

5. **Result Handling**:
   - Result JSON includes: agentName, severity, score, findings, downstream, raw
   - Escalation service processes findings (email CRITICAL alerts)
   - Downstream agents added to next available schedule slot

### Dependency Resolution

Agents with upstreams wait for upstream agents to complete:

```
analytics-pipeline (06:00)
  ↓
risk-radar (06:30) — waits for analytics-pipeline, call-quality-scorer, hallucination-detector
call-quality-scorer (08:00) — waits for analytics-pipeline, post-call-debrief
hallucination-detector (07:30) — waits for analytics-pipeline
```

Dependencies are reflected in the prompt — agents fetch upstream context via:
```bash
GET /api/agent-runs/context?agents=analytics-pipeline,call-quality-scorer&hours=168
Authorization: Bearer {{AGENT_RUNTIME_SECRET}}
```

## Disabling Agent Runners

Set environment variable on Fly:
```bash
fly secrets set DISABLE_AGENT_RUNNERS="true" --app collect-rx
```

Or disable REDIS_URL to fall back to in-process schedulers (not recommended for production).

## Monitoring Agent Runs

### View Agent Job Status

Check BullMQ queue:
```bash
# Connect to Fly Redis (requires fly CLI proxy)
# Then use BullMQ CLI or inspect directly:
redis-cli -u redis://[connection] KEYS "bull:agent-runner:*"
```

### View Agent Results

Agent runs are stored in `AgentRun` table (PostgreSQL):
```sql
SELECT agentName, severity, score, createdAt 
FROM "AgentRun" 
ORDER BY createdAt DESC 
LIMIT 20;
```

### View Agent Logs

Check Fly logs for agent execution:
```bash
fly logs --app collect-rx | grep '\[agentRunner\]'
```

### View Escalations

CRITICAL findings trigger emails to khalidegeh97@gmail.com and are stored:
```sql
SELECT * FROM "AgentRun" WHERE severity = 'CRITICAL' ORDER BY createdAt DESC;
```

## Development

### Local Testing (with local Redis)

```bash
# Start Redis
docker compose up -d redis

# Set env vars
export REDIS_URL=redis://127.0.0.1:6379
export API_BASE=http://localhost:3000
export AGENT_RUNTIME_SECRET=dev-secret-12345
export ANTHROPIC_API_KEY=sk-...

# Run agent runner service
npm run dev
# In another terminal:
npm run worker
```

### Test Individual Agent Execution

```bash
# Add job manually to queue
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Authorization: Bearer dev-secret-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "analytics-pipeline",
    "severity": "OK",
    "score": 95,
    "summary": "Test run successful",
    "findings": [],
    "downstream": ["risk-radar"],
    "raw": {"testRun": true}
  }'
```

### Manually Trigger an Agent

Enqueue agent job directly (requires database access):
```typescript
import { getAgentRunnerQueue } from './src/server/jobs/agentRunnerQueue.js';

const q = getAgentRunnerQueue();
await q.add('AGENT_RUN', {
  agentName: 'analytics-pipeline',
  cron: '0 6 * * 1',
  upstreamAgents: [],
  timeWindow: 'UTC'
}, { repeat: null }); // one-time, not repeating
```

## Troubleshooting

### Agent job stuck in pending

Check worker process:
```bash
fly logs --app collect-rx --process worker | grep error
```

Check Redis connection:
```bash
fly proxy 5432:5432 --app collect-rx  # Fly Postgres proxy
fly proxy 6379:6379 --app collect-rx  # Fly Redis proxy
```

### CRITICAL findings not escalating

Verify:
- AGENT_RUNTIME_SECRET is set correctly
- /api/agent-runs endpoint is reachable from worker
- Email service is configured (check SendGrid)
- AgentRun table exists in Prisma schema

### Agent response parsing fails

Check Claude response in logs:
- Agent should output valid JSON with agentName, severity, summary, findings
- If parsing fails, agent run completes but result not POSTed

### Too many retries / job exhausted

Default: 3 attempts, exponential backoff (5s, 25s, 125s)

If agent consistently fails:
1. Check agent definition exists on GitHub
2. Check Claude API quotas/rate limits
3. Check ANTHROPIC_API_KEY is valid
4. Review agent runner logs for error details

## Escalation Integration

Agent runs with CRITICAL findings automatically:
1. Route to escalation service
2. Send email to khalidegeh97@gmail.com
3. Store in AgentRun table for audit
4. Can trigger downstream agents (incident-response)

Override email by setting:
```bash
fly secrets set ESCALATION_EMAIL="team@example.com" --app collect-rx
```

## Cost & Performance

### Cost per Agent Run

- Claude Haiku: ~$0.0008 per run (avg 500 tokens used)
- 19 agents × $0.0008 = ~$0.015 per week
- 52 weeks × $0.015 = ~$0.78 per year

### Performance per Agent Run

- Cold start (fetch definitions from GitHub): ~2-3 seconds
- Claude inference: ~5-10 seconds
- POST to /api/agent-runs: ~1 second
- **Total: ~8-15 seconds per agent**

### Concurrency

- Worker concurrency: 1 (sequential processing)
- This ensures agents run in dependency order without race conditions
- Full 19-agent chain takes ~2.5-4 minutes

## Next Steps

1. **Verify Deployment**: Check `fly logs --app collect-rx` for registerAgentRunners startup message
2. **Monitor First Run**: Next Monday at 06:00 ET, agent jobs will be triggered
3. **Configure Escalation Contacts** (see ESCALATION-CONTACTS.md)
4. **Set Up Health Monitoring** (see OPS-ALERTS.md)
5. **Document Audit Trail** (see COMPLIANCE-AUDIT-TRAIL.md)
