# Agent Runner Architecture

## System Overview

The Agent Runner is a self-contained subsystem within the Collect-RX backend that manages autonomous agent scheduling and execution. Agents run inside the Fly app (not external Routines) and have full access to database, billing logic, and escalation workflows.

```
┌─────────────────────────────────────────────────────────────────┐
│ Fly.io App (collect-rx)                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  API Process                         Worker Process             │
│  ┌──────────────────────┐            ┌─────────────────────┐   │
│  │ Express Server       │            │ BullMQ Worker       │   │
│  │ ├─ /api/...         │            │ ├─ AR Queue Proc    │   │
│  │ ├─ /api/agent-runs  │ ◄──────────┼─┤ ├─ Agent Queue     │   │
│  │ └─ registerAgents() │ schedule   │ │ │   (this system)  │   │
│  │   at startup        │ jobs      │ │ │ └─ runAgent()     │   │
│  └──────────────────────┘            │ └─────────────────────┘   │
│           │                          │           │               │
│           │ (via Redis)              │           │               │
│           └──────────────────────────┼───────────┘               │
│                                      │                           │
│  ┌────────────────────────────┐     │                           │
│  │ Redis (BullMQ)             │◄────┤                           │
│  │ └─ agent-runner queue      │     │                           │
│  │    (scheduled jobs)        │     │                           │
│  └────────────────────────────┘     │                           │
│                                      │                           │
└──────────────────────────────────────┼──────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
              PostgreSQL           Claude API          GitHub Raw
              (AgentRun table)      (agent exec)       (definitions)
```

## Key Files

### Runtime Infrastructure
- `agents/runtime/schedules.md` - agent cron times & dependencies
- `agents/runtime/SETUP-INSTRUCTIONS.md` - Fly env vars setup
- `agents/runtime/agent-runner-template.md` - execution contract
- `agents/runtime/AGENT-RUNNER-SETUP.md` - this system's operation

### Backend Code (Collect-RX-main/)
- `src/server/jobs/agentRunnerQueue.ts` - BullMQ queue management
- `src/server/jobs/agentRunnerService.ts` - agent execution engine
- `src/server/jobs/agentSchedules.ts` - hardcoded schedule config
- `src/server/jobs/registerSchedulers.ts` - registers jobs on startup
- `src/server/workerEntry.ts` - worker process entry & job handler
- `src/server/index.ts` - API startup (calls registerAgentRunners)
- `src/server/routes/agentRunsRouter.ts` - /api/agent-runs endpoint
- `src/server/services/agentEscalationService.ts` - CRITICAL alert routing

### Agent Definitions
- `agents/*.md` - 19 agent definitions (markdown + metadata)
- `.claude/agents/*.md` - coordination agent definitions (unused by runner)

## Execution Lifecycle

### 1. Startup (API Process)

```
App Start
  ↓
registerAgentRunners()
  ├─ Check REDIS_URL, API_BASE, AGENT_RUNTIME_SECRET
  ├─ Connect to BullMQ queue ('agent-runner')
  ├─ Clear old repeatable jobs
  └─ For each AGENT_SCHEDULES:
     └─ q.add('AGENT_RUN', {agentName, upstreamAgents}, 
         {repeat: {pattern: cron}, attempts: 3, backoff: exponential})
              ↓
         Job scheduled for next Monday 06:00-15:00 ET
```

### 2. Job Trigger (BullMQ)

```
Cron time reached (e.g., Monday 06:00 ET)
  ↓
BullMQ fires AGENT_RUN job
  ├─ Job picked up by worker (concurrency: 1)
  ├─ Correlation ID assigned
  └─ runWithCorrelationId() + runWithRlsBypass() + job handler
              ↓
         runAgent(job) called
```

### 3. Agent Execution (Claude API)

```
runAgent(job)
  ├─ Fetch agent definition from GitHub
  ├─ Fetch runner template from GitHub
  ├─ Build Claude prompt with:
  │  ├─ Agent definition
  │  ├─ Runner template
  │  ├─ API_BASE and AGENT_RUNTIME_SECRET
  │  └─ Upstream agent names
  ├─ Call claude-haiku-4-5-20251001 (max 4096 tokens)
  ├─ Log token usage
  ├─ Parse JSON from response
  └─ Return AgentRunResult or null
```

### 4. Result Posting

```
If result parsed successfully:
  ├─ POST to API_BASE/api/agent-runs
  │  ├─ Header: Authorization: Bearer AGENT_RUNTIME_SECRET
  │  ├─ Body: {agentName, severity, score, summary, findings, downstream, raw}
  │  └─ Timeout: 30 seconds
  └─ Log success
  
If POST succeeds:
  ├─ agentRunsRouter receives request
  ├─ Validates payload against AgentRunInputSchema
  ├─ Calls recordAgentRun() → agentEscalationService
  ├─ Stores in AgentRun table (PostgreSQL)
  ├─ If severity = CRITICAL:
  │  └─ Send email to khalidegeh97@gmail.com
  └─ Return 200 OK
```

### 5. Failure Handling

```
On Agent Execution Error:
  ├─ Log error (correlationId included)
  ├─ Job retries (attempt 1/3)
  ├─ Backoff 5 seconds
  ├─ If attempt 3 fails:
  │  └─ Job failed event
  │     ├─ Log error
  │     ├─ Alert ops if shouldAlertOnJobExhaustion()
  │     └─ Job removed from queue after 1 hour
  └─ No automatic recovery (manual retry via BullMQ UI)
```

## Dependency Graph

```
Monday 06:00 - analytics-pipeline (no upstream)
Monday 06:30 - risk-radar (upstream: analytics-pipeline, call-quality-scorer, hallucination-detector)
Monday 07:00 - post-call-debrief (upstream: analytics-pipeline)
Monday 07:30 - hallucination-detector (upstream: analytics-pipeline)
Monday 08:00 - call-quality-scorer (upstream: analytics-pipeline, post-call-debrief)
Monday 08:30 - carrier-ivr-health (upstream: post-call-debrief)
Monday 09:00 - escalation-triage (upstream: post-call-debrief)
Monday 09:30 - collections-performance (upstream: analytics-pipeline, hallucination-detector)
Monday 10:00 - database-health (no upstream)
Monday 10:30 - tier-billing-health (upstream: analytics-pipeline)
Monday 11:00 - phi-access-log-reviewer (no upstream)
Monday 11:30 - compliance-checker (upstream: phi-access-log-reviewer)
Monday 12:00 - practice-time-savings (upstream: analytics-pipeline, collections-performance)
Monday 12:30 - roi-proof (upstream: practice-time-savings, collections-performance)
Monday 13:00 - voice-of-customer (upstream: escalation-triage, post-call-debrief)
Monday 13:30 - client-acquisition (upstream: tier-billing-health)
Monday 14:00 - market-intelligence (no upstream)
Monday 14:30 - competitive-intelligence (upstream: market-intelligence)
Monday 15:00 - project-manager (upstream: all 18 agents above)
```

## Data Flow

### Agent ← Upstream Context

Agent fetches upstream results before executing:
```bash
GET /api/agent-runs/context?agents=analytics-pipeline,call-quality-scorer&hours=168
Authorization: Bearer AGENT_RUNTIME_SECRET
```

Response includes:
```json
{
  "context": [
    {
      "agentName": "analytics-pipeline",
      "severity": "MEDIUM",
      "score": 75,
      "summary": "...",
      "findings": [...],
      "raw": {...}
    }
  ]
}
```

### Agent → Results

Agent posts execution results:
```bash
POST /api/agent-runs
Authorization: Bearer AGENT_RUNTIME_SECRET
Content-Type: application/json

{
  "agentName": "analytics-pipeline",
  "severity": "CRITICAL",
  "score": 42,
  "summary": "3 data quality issues found in this week's calls",
  "findings": [
    {
      "id": "ANALYTICS-PIPELINE-2026-08-10-001",
      "severity": "CRITICAL",
      "domain": "data-quality",
      "description": "...",
      "action": "...",
      "evidence": "..."
    }
  ],
  "downstream": ["risk-radar", "post-call-debrief"],
  "raw": {
    "checksRun": 7,
    "checksFailed": 3,
    "metricsDetails": {...}
  }
}
```

## Security Model

### Authentication

- Agents must include `Authorization: Bearer AGENT_RUNTIME_SECRET` header
- Secret is a 64-character hex string (32 bytes)
- Stored in Fly secrets (not in code, config, or logs)
- Generated with `openssl rand -hex 32`

### Secret Access Pattern

```
1. Agent receives env: AGENT_RUNTIME_SECRET (from Fly secrets)
2. Agent includes in HTTP Authorization header (Bearer token)
3. agentRunsRouter requireAgentSecret() middleware validates
4. If env.NODE_ENV === production and secret doesn't match → 401
5. If development (no secret required) → pass through
```

### PHI Handling

- Agents can access Prisma (full database, including patient records)
- Agents should NOT include PHI in findings or summaries
- Escalation emails go to Khalid only (no customer exposure)
- Agent run raw data stored only for Khalid review

## Performance Characteristics

### Agent Execution Time

- **Cold start (fetch definitions)**: 2-3 seconds
- **Claude inference**: 5-10 seconds (Haiku is very fast)
- **POST result**: 1 second
- **Total per agent**: 8-15 seconds
- **Full chain (19 agents)**: 2.5-4 minutes

### Resource Usage

- **BullMQ queue**: negligible (Redis)
- **Worker process CPU**: ~20-30% during agent execution (Claude I/O wait)
- **Memory**: ~100-150MB for worker process
- **Concurrent jobs**: 1 (sequential by design)

### Cost

- **Claude Haiku**: ~$0.008 per million input tokens, $0.002 per million output tokens
- **Per agent average**: ~500 tokens (inputs) + ~300 tokens (outputs) = ~$0.0008
- **Weekly cost**: 19 agents × $0.0008 = ~$0.015
- **Yearly cost**: ~$0.78 (negligible)

## Monitoring & Observability

### Logs

All logs use structured format with:
- `[agentRunner]` prefix for agent-specific logs
- `correlationId` field for tracing
- `agentName` field for filtering
- Errors include stack trace

Example:
```
logger.info('[agentRunner] Starting agent run', {
  agentName: 'analytics-pipeline',
  upstreamAgents: [],
  jobId: 'abc123'
});
```

### Metrics

Agent runs stored in AgentRun table:
```sql
CREATE TABLE "AgentRun" (
  id String @id @default(cuid())
  agentName String
  runAt DateTime @default(now())
  severity Enum('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'OK')
  score Int? @min(0) @max(100)
  summary String
  findings Json
  downstream Json
  escalated Boolean
  raw Json?
  
  @@index([agentName, runAt])
  @@index([severity, runAt])
  @@index([runAt])
}
```

### Alerts

CRITICAL findings trigger:
1. Email to khalidegeh97@gmail.com (via SendGrid)
2. Stored in AgentRun with escalated = true
3. Downstream agents notified (incident-response)

## Testing

### Verify Setup

```bash
# Check env vars are set
fly secrets list --app collect-rx

# Check agent jobs scheduled (requires Redis access)
fly proxy 6379:6379 --app collect-rx &
redis-cli KEYS "bull:agent-runner:*"

# Check job counts
redis-cli ZCARD bull:agent-runner:waiting
redis-cli ZCARD bull:agent-runner:active
```

### Manual Agent Trigger

Add direct job to queue (one-time):
```bash
# Via Node script (in Fly machine or local with proxy)
const { getAgentRunnerQueue } = require('./src/server/jobs/agentRunnerQueue');
const q = getAgentRunnerQueue();
await q.add('AGENT_RUN', {
  agentName: 'analytics-pipeline',
  cron: '0 6 * * 1',
  upstreamAgents: [],
  timeWindow: 'UTC'
});
```

### Test Result Posting

```bash
curl -X POST https://collect-rx.fly.dev/api/agent-runs \
  -H "Authorization: Bearer $AGENT_RUNTIME_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "test-agent",
    "severity": "OK",
    "score": 100,
    "summary": "Test run",
    "findings": [],
    "downstream": [],
    "raw": null
  }'
```

## Future Improvements

1. **Agent Parallelization**: Run independent agents in parallel (currently sequential by design)
2. **Dead Letter Queue**: Store failed agent results for manual retry
3. **Agent Versioning**: Track which agent definition version ran
4. **Custom Prompts**: Allow per-agent prompt overrides (bypass template)
5. **Multi-Model Support**: Allow different agents to run on different Claude models
6. **Real-Time Triggers**: Event-driven agent execution (not just cron)
7. **Agent Chaining**: Agents triggering other agents mid-execution
8. **Persistent State**: Agents maintaining state across runs
