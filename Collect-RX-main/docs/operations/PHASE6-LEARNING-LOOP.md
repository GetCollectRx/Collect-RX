# Phase 6: Learning Loop Operations & Setup

## What It Does

The learning loop is an autonomous agent that:
1. **Pulls** backlog items from Notion on a schedule (default daily at 06:00 server time)
2. **Researches** each item (codebase search + Notion context)
3. **Ranks** by impact × urgency ÷ effort
4. **Scores feasibility** (0–100; default gate: ≥65)
5. **Implements** if feasible (Notion updates, docs, DB records)
6. **Notifies** Khalid via SMS with cycle summary

## Prerequisites

- [ ] **Notion workspace** with a learning backlog database created
- [ ] **Notion API key** generated (Notion Settings → Integrations → Create internal integration)
- [ ] **Twilio credentials** configured (SMS delivery to `ALERT_SMS_TO`)
- [ ] **Redis URL** set (enables BullMQ scheduler; else uses in-process node-cron)
- [ ] **Research provider** chosen (NotebookLM / Gemini / local codebase)

## Setup Checklist

### Step 1: Notion Integration

```bash
# In your Notion workspace:
# 1. Create internal integration at notion.so/my-integrations
# 2. Copy the API key
# 3. Create a new database "CollectRx Learning Backlog" with fields:
#    - Title (text)
#    - Status (select: Ready for research, Backlog, Not Started, Researching, Ranked, Implementing, Completed, Skipped)
#    - Impact (select: high, medium, low)
#    - Urgency (select: urgent, normal, low)
#    - Effort (select: 1, 2, 3, 5, 8 — story points)
#    - Bucket (select: product, engineering, ops, growth, compliance)
#    - Research Notes (text)
#    - Feasibility Score (number)
#    - Implemented (checkbox)

# 4. Share the database with your integration token
# 5. Note the database ID (from the URL: notion.so/workspace/DATABASE_ID?v=...)
```

### Step 2: Environment Variables

```bash
# .env or Railway Variables:

# Enable the learning loop
LEARNING_LOOP_ENABLED=1

# Notion integration
NOTION_API_KEY=secret_abc123...
NOTION_LEARNING_DATABASE_ID=abc123def456...

# Scheduling
LEARNING_CRON=0 6 * * *          # Daily 06:00 server time (node-cron syntax)
LEARNING_MAX_IMPLEMENT_PER_CYCLE=3  # Max items per run (default 3)
LEARNING_FEASIBILITY_MIN=65       # Minimum score to auto-implement

# Which Notion statuses trigger research
LEARNING_NOTION_STATUS_RESEARCH=Ready for research,Backlog,Not Started

# Research provider (one of: notebooklm, gemini, local)
LEARNING_RESEARCH_PROVIDER=notebooklm
LEARNING_RESEARCH_TIMEOUT_MS=20000  # Research timeout (20s)

# Research repositories (optional; defaults to process.cwd())
LEARNING_REPO_ROOT=/path/to/Collect-RX-main

# SMS notifications
ALERT_SMS_TO=+1-YOUR-PHONE-NUMBER

# Twilio (shared with ops alerts)
TWILIO_ACCOUNT_SID=ACxxxxxxx...
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1-YOUR-TWILIO-NUMBER

# Redis (for BullMQ; if unset, uses in-process node-cron)
REDIS_URL=redis://default:password@host:port

# Research providers (choose one)
# NotebookLM (Google unofficial SDK):
NOTEBOOKLM_NOTEBOOK_ID=abc123...
NOTEBOOKLM_COOKIES_FILE=~/.notebooklm/session.json
NOTEBOOKLM_RESEARCH_SOURCE=web       # web | drive
NOTEBOOKLM_RESEARCH_MODE=fast        # fast | deep

# OR Gemini (Google AI Studio):
GEMINI_API_KEY=AIzaSyD...
GEMINI_MODEL=gemini-2.0-flash

# OR local codebase only (no external research):
# (just set LEARNING_RESEARCH_PROVIDER=local)
```

### Step 3: Local Testing

```bash
# Test the learning loop locally (single cycle, dry-run if desired)
LEARNING_LOOP_ENABLED=1 npm run dev

# In another terminal, check logs:
tail -f ~/.local/share/dental-ar-system/logs/* 2>/dev/null || echo "Check Railway logs for production"

# Manually trigger a cycle (for testing):
curl -X POST http://localhost:3000/api/learning/trigger \
  -H "Authorization: Bearer $AGENT_RUNTIME_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'  # Set to false to actually implement
```

### Step 4: Production Deployment (Railway)

1. **Set environment variables** in Railway → Variables:
   - `LEARNING_LOOP_ENABLED=1`
   - `NOTION_API_KEY=...`
   - `NOTION_LEARNING_DATABASE_ID=...`
   - All Twilio/SMS variables
   - Research provider credentials

2. **Deploy**:
   ```bash
   git push origin main  # Triggers Railway CI
   ```

3. **Verify**:
   ```bash
   # SSH into Railway pod or check logs:
   railway logs -f
   
   # Look for "[learning-loop]" lines confirming cron is running
   ```

## How It Works

### Cron Trigger

When `LEARNING_LOOP_ENABLED=1`, the server registers a repeatable job:

- **If Redis**: BullMQ `LEARNING_CYCLE` job runs at `LEARNING_CRON` time
- **If no Redis**: Node-cron runs in-process at `LEARNING_CRON` time

### Pipeline Stages

**1. Pull (Notion)**
- Query Notion DB for rows with status in `LEARNING_NOTION_STATUS_RESEARCH`
- Limit to `LEARNING_MAX_IMPLEMENT_PER_CYCLE` items
- Mark as `Researching`

**2. Research**
- Call research provider (NotebookLM, Gemini, or local grep)
- Extract keywords, codebase hits, risk summary
- Update Notion: `Research Notes` field
- Transition to `Ranked`

**3. Rank**
- Fetch Impact, Urgency, Effort from Notion
- `rankScore = (impact_weight × urgency_weight) / (effort_weight)`
- Save to `Rank Score` field

**4. Feasibility Score**
- LLM agent reads research notes + rank score
- Generates 0–100 feasibility score
- Saves to `Feasibility Score` field
- Decision: `score >= LEARNING_FEASIBILITY_MIN` → implement

**5. Implement** (if feasible)
- **Safe actions only:**
  - Update Notion status to `Implementing`
  - Generate optional `docs/learning-autogen/YYYYMMDD-{slug}.md` with findings
  - Create `LearningCandidate` + `AuditLog` records in DB
  - Update Notion status to `Completed`
- **Blocked actions:**
  - No code commits (requires human review)
  - No production deploys
  - No PHI-bearing changes

**6. Notify (SMS)**
- Format cycle summary:
  ```
  [Learning Loop] Cycle complete: 5 researched, 2 ranked, 1 implemented, 2 skipped. Score 76/100.
  ```
- Send via Twilio to `ALERT_SMS_TO`

### Error Handling

| Error | Behavior |
|-------|----------|
| Notion unreachable | Retry next cycle (job persists) |
| Research timeout | Log timeout, mark as `Skipped`, continue |
| SMS delivery fails | Log warning, continue (doesn't block cycle) |
| LLM error | Mark item `Skipped`, log reason |

## Monitoring

### Metrics

Track in ops dashboards:

- **Cycle success rate** — % of cycles that complete without critical errors
- **Research coverage** — % of pulled items with research notes
- **Feasibility distribution** — histogram of scores (should be bi-modal: low + high)
- **Cycle duration** — research time (aim for <5 min per item)
- **Implementation rate** — % of feasible items actually implemented

### Logs

Look for `[learning-loop]` prefix in:
- Local: `npm run dev` console output
- Railway: `railway logs -f` or Railway UI → Deployments

### Notion Health

- [ ] All `Researching` rows transition to `Ranked` within 24h
- [ ] All `Ranked` rows transition to `Completed` or `Skipped` within 24h
- [ ] No rows stuck in `Implementing` for >1h

## Troubleshooting

### Learning loop not running

```bash
# Check if enabled
echo $LEARNING_LOOP_ENABLED  # should be 1

# Check Redis (if configured)
redis-cli KEYS "bull:LEARNING_CYCLE*"

# Check logs for registration
railway logs | grep -i "learning\|cron"
```

### Research taking too long

- Increase `LEARNING_RESEARCH_TIMEOUT_MS`
- Switch to faster provider: `notebooklm` (fast mode) < `local` < `gemini`

### SMS not sending

```bash
# Verify Twilio is configured
echo $TWILIO_ACCOUNT_SID
echo $TWILIO_FROM_NUMBER
echo $ALERT_SMS_TO

# Test manually
curl -X POST http://localhost:3000/api/learning/test-sms \
  -H "Authorization: Bearer $PLATFORM_DEV_PASSWORD" \
  -d '{"message": "test"}'
```

### Notion integration broken

- [ ] `NOTION_API_KEY` is valid (not expired)
- [ ] Database ID is correct (copy from Notion URL)
- [ ] Internal integration has access to the database
- [ ] Database has required fields (Status, Research Notes, Feasibility Score, etc.)

## Disabling Phase 6

```bash
# Set in Railway Variables:
LEARNING_LOOP_ENABLED=0

# Deploy
git push origin main
```

The loop will no longer run, but existing `LearningCandidate` records remain in DB.

## Related Phases

- **Phase 5** (UI/UX) — learning loop observes feature requests + UX friction signals
- **Phase 7** (Pilot) — learning loop de-prioritizes PHI-bearing research to stay within PHIPA/PIPEDA bounds
- **Phase 8** (Scale) — learning loop research feeds product roadmap for 3–5 practice phase

---

**Owner:** Khalid  
**Status:** Ready to configure (env vars documented, all integrations optional)  
**Last Updated:** 2026-07-21
