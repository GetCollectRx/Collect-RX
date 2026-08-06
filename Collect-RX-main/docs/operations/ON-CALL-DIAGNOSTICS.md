# On-Call Diagnostics Guide — Vapi Degradation

**Scenario:** You're paged at 2:35 AM with an alert: "150 claims queued, oldest 35 minutes."

**Goal:** Determine root cause in <5 minutes and know whether to:
- Pause the queue (if Vapi is down)
- Restart the service (if there's a memory leak)
- Check Vapi status page (if external degradation)
- Escalate to ops/infrastructure (if database issue)

---

## First Command: Check Vapi Health (30 seconds)

```bash
curl -s "https://collect-rx.fly.dev/api/admin/diagnostics/vapi-health" \
  -H "Authorization: Bearer $HEALTH_METRICS_TOKEN" | jq .
```

**Response looks like:**
```json
{
  "timestamp": "2026-08-05T06:35:12Z",
  "circuitBreaker": {
    "state": "OPEN",
    "consecutiveTimeouts": 5,
    "lastStateChange": "2026-08-05T06:05:47Z",
    "nextRecoveryAttempt": "2026-08-05T06:07:47Z",
    "explanation": "Vapi API degraded (5 consecutive timeouts). Fast-failing new requests. Recovery attempt at 2026-08-05T06:07:47Z"
  },
  "latency": {
    "callsLastMinute": 12,
    "avgDurationMs": 29500,
    "p95DurationMs": 30100,
    "p99DurationMs": 30200,
    "maxDurationMs": 30200
  },
  "reliability": {
    "timeoutsLastMinute": 11,
    "timeoutRateLastMinute": 92,
    "callsLastMinute": 12
  },
  "recentCalls": [
    {
      "practiceId": "p123",
      "claimId": "claim-abc",
      "carrierId": "sun_life",
      "initiatedAt": "2026-08-05T06:35:02Z",
      "completedAt": "2026-08-05T06:35:32Z",
      "durationMs": 30100,
      "status": "timeout",
      "errorMessage": "AbortError: signal timeout"
    },
    ...
  ],
  "diagnosis": [
    {
      "severity": "high",
      "issue": "Vapi API has high timeout rate (>50%)",
      "action": "Check Vapi API status page or network connectivity to Vapi"
    },
    {
      "severity": "high",
      "issue": "Circuit breaker is OPEN — Vapi API degraded",
      "action": "Check Vapi status page. Automatic recovery at 2026-08-05T06:07:47Z"
    }
  ]
}
```

### What This Tells You

| Field | Value | Meaning |
|-------|-------|---------|
| `circuitBreaker.state` | `OPEN` | Vapi is degraded; new calls being fast-failed |
| `reliabilit.timeoutRateLastMinute` | 92% | 92% of calls are timing out |
| `latency.avgDurationMs` | 29500 | Calls are taking ~30 seconds (our timeout limit) |
| `diagnosis` | Array | Actionable next steps |

---

## Diagnosis Matrix

### If Circuit Breaker is OPEN + Timeout Rate > 50%

**What's happening:** Vapi API is slow or down.

**Evidence:**
- Recent calls all hitting 30-second timeout
- Circuit breaker tripped automatically
- avgDurationMs ≈ 30,000 (our VAPI_HTTP_TIMEOUT_MS)

**Next steps:**
1. Check Vapi status page: https://status.vapi.ai
2. If Vapi is down, pause the queue and escalate to Vapi support
3. If Vapi is "normal" on status page, check network connectivity:
   ```bash
   fly ssh console -a collect-rx
   curl -I https://api.vapi.ai/call -w "\nDNS: %{time_connect}s\n"
   ```
4. Wait for automatic recovery (next attempt shown in `nextRecoveryAttempt`)

### If Circuit Breaker is CLOSED + Timeout Rate < 10%

**What's happening:** Vapi is healthy. Problem is elsewhere.

**Evidence:**
- Circuit breaker not tripped
- Low timeout rate
- Calls completing normally (latency ~2s)

**Next steps:**
1. Check queue health:
   ```bash
   curl -s "https://collect-rx.fly.dev/api/health/metrics" | jq '.queue'
   ```
2. If queue is backed up but Vapi is healthy, check:
   - Database connection pool: `SELECT count(*) FROM pg_stat_activity`
   - Queue engine logs: `fly logs -a collect-rx | grep deskQueueEngine`
   - PHI token expiration: `fly logs -a collect-rx | grep "token expired"`

### If Circuit Breaker is HALF_OPEN

**What's happening:** Recovery attempt in progress. Will either close or reopen soon.

**Evidence:**
- Just transitioned from OPEN
- Testing Vapi connectivity

**Next steps:**
- Wait 1–2 minutes for automatic transition
- OR check Vapi status and manually reset if healthy:
  ```bash
  curl -s -X POST "https://collect-rx.fly.dev/api/admin/diagnostics/vapi-reset-circuit-breaker" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
  ```

---

## Command: Check PHI Vault Health (1 minute)

If Vapi is healthy but claims are failing to dispatch, check if the PHI Vault has memory pressure:

```bash
curl -s "https://collect-rx.fly.dev/api/admin/diagnostics/phi-vault-health" \
  -H "Authorization: Bearer $HEALTH_METRICS_TOKEN" | jq .
```

**Response looks like:**
```json
{
  "timestamp": "2026-08-05T06:35:12Z",
  "vault": {
    "activeTokens": 2500,
    "expiredTokens": 150,
    "totalTokensIssued": 5200,
    "oldestActiveTokenAge": 95
  },
  "configuration": {
    "maxVaultSize": 100000,
    "tokenTtlDays": 120,
    "gcIntervalMs": 3600000
  },
  "diagnosis": []
}
```

**What to look for:**

| Scenario | Meaning | Action |
|----------|---------|--------|
| `expiredTokens: 0` | Vault is clean | No action needed |
| `expiredTokens: >1000` | High GC lag; expired tokens waiting for cleanup | Run manual GC: `curl -X POST ... /phi-vault-gc` or lower `PHI_VAULT_GC_INTERVAL_MS` |
| `activeTokens: >90000` (with max 100k) | Vault near capacity | Monitor token lifecycle; create new claims cautiously |
| `oldestActiveTokenAge: 120+` | Tokens at or past 120-day TTL | Investigate why old tokens haven't expired; may indicate expired() logic bug |

**Manual GC (if vault is backing up):**
```bash
curl -X POST "https://collect-rx.fly.dev/api/admin/diagnostics/phi-vault-gc" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

---

## Second Command: Check Queue State (1 minute)

If Vapi looks healthy but queue is still backed up:

```bash
curl -s "https://collect-rx.fly.dev/api/health/metrics" | jq '{queue: .queue, http: .http}'
```

**What to look for:**

| Scenario | Action |
|----------|--------|
| `duePendingCount: 0` | Alert already resolved; check when it started via logs |
| `duePendingCount: 100+, oldestDuePendingAgeMinutes: 50+` | Queue stalled; check database/connection pool |
| `openCallAttempts: 0` | All dispatch attempts completed; no stuck calls |
| `http.avgLatencyMs: 800+` | Slow HTTP requests; could be database or network |

---

## Third Command: Check Logs (2 minutes)

If the health endpoint doesn't tell the full story:

```bash
# Last 100 log lines with Vapi errors
fly logs -a collect-rx --tail 100 | grep -E "vapi|timeout|tick error" | tail -50

# Or check for database connection issues
fly logs -a collect-rx --tail 100 | grep -E "ECONNREFUSED|pool|connection"

# Or check for PHI token issues
fly logs -a collect-rx --tail 100 | grep "token expired\|PHI"
```

**Common patterns:**

| Pattern | Root Cause | Fix |
|---------|-----------|-----|
| `[vapi/client] REQUEST TIMEOUT` (repeated) | Vapi is slow | Check Vapi status page |
| `[deskQueueEngine] previous tick still running` | Queue tick taking >60s | Usually follows Vapi timeouts |
| `connection pool exhausted` | Database connection leak | Restart service |
| `PHI token expired` | Token TTL exceeded | Wait for auto-reissue or manually reset PHI vault |

---

## Automatic Circuit Breaker Protection

**Good news:** The queue engine automatically stops dispatching when the circuit breaker is OPEN.

When Vapi times out 5+ times consecutively:
1. Circuit breaker trips to OPEN (visible in diagnostics endpoint)
2. Next queue tick skips dispatch entirely (all claims remain PENDING, no forced calls)
3. Queue waits 120s (configurable), then attempts recovery (HALF_OPEN)
4. When Vapi recovers, circuit breaker auto-closes and dispatch resumes

**You do NOT need to manually pause the queue if Vapi is down.** The circuit breaker handles cascade prevention automatically.

Manual intervention is only needed if:
- Circuit breaker is stuck (shows future `nextRecoveryAttempt` but Vapi is already healthy) → use manual reset (see below)
- You need to pause a specific practice for administrative reasons (not API degradation)

---

## Pausing/Resuming the Queue

If you need to manually stop the queue for a practice (administrative hold or recovery procedures):

```bash
# Pause queue for a practice (to prevent cascading errors)
curl -X POST "https://collect-rx.fly.dev/api/admin/practice/{practiceId}/queue/pause" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Vapi API degraded"}'

# Resume when fixed
curl -X POST "https://collect-rx.fly.dev/api/admin/practice/{practiceId}/queue/resume" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Manual Circuit Breaker Recovery

If Vapi recovers but circuit breaker is still OPEN:

```bash
curl -X POST "https://collect-rx.fly.dev/api/admin/diagnostics/vapi-reset-circuit-breaker" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

**Response:**
```json
{
  "timestamp": "2026-08-05T06:08:00Z",
  "action": "Circuit breaker manually reset",
  "state": {
    "state": "CLOSED",
    "consecutiveTimeouts": 0,
    "lastStateChange": "2026-08-05T06:08:00Z"
  }
}
```

Queue will resume attempting calls immediately.

---

## Environment Variables (for Operations)

Set these to tune diagnostic thresholds:

```bash
# Vapi request timeout (milliseconds)
VAPI_HTTP_TIMEOUT_MS=30000        # Default: 30s

# Circuit breaker config
VAPI_CB_FAILURE_THRESHOLD=5       # Trip after 5 consecutive timeouts
VAPI_CB_RECOVERY_TIMEOUT_MS=120000  # Attempt recovery after 2 minutes

# PHI Vault config (encrypted token storage for call dispatch)
PHI_VAULT_TTL_DAYS=120            # Token lifetime (must outlive 90-day claim lifecycle)
PHI_VAULT_MAX_TOKENS=100000       # Max tokens in memory; enforced at tokenize()
PHI_VAULT_GC_INTERVAL_MS=3600000  # Garbage collection interval (default: 1 hour)
# For high-volume practices (>5 claims/sec), reduce to 300000 (5 min) to avoid
# accumulating expired tokens in memory between GC cycles.

# OPS monitoring + alerting (REQUIRED for on-call paging)
OPS_MONITOR_ENABLED=1             # Enable monitor loop
OPS_ALERTS_ENABLED=1              # Enable alert dispatch
OPS_ALERT_QUEUE_STALL_MINUTES=30  # Alert if queue stalls >30 min
OPS_ALERT_ATTEMPT_STUCK_MINUTES=150  # Alert if call stuck >150 min

# Alert delivery channels (pick at least one)
ALERT_SMS_TO=+1-555-0100          # Twilio SMS to on-call
OPS_ALERT_EMAIL_TO=ops@collectrx.ca  # SendGrid email
OPS_ALERT_WEBHOOK_URL=https://...  # Custom webhook (Slack/PagerDuty)
```

---

## Troubleshooting the Diagnostic Endpoint

### "401 Unauthorized"
- Missing or incorrect `Authorization: Bearer $HEALTH_METRICS_TOKEN`
- Set `HEALTH_METRICS_TOKEN` in production config

### "Connection refused"
- Fly.io app is down or restarting
- Check: `fly status -a collect-rx`

### Empty `recentCalls` array
- No calls have been attempted in the last ~100 records
- Check if queue is truly stalled or if Vapi calls are being blocked upstream

---

## Cheat Sheet

**2:35 AM, you're paged:**

```bash
# 30 seconds: Is Vapi degraded?
curl -s "https://collect-rx.fly.dev/api/admin/diagnostics/vapi-health" \
  -H "Authorization: Bearer $TOKEN" | jq '.circuitBreaker, .reliability, .diagnosis'

# 1 minute: Is queue truly stalled?
curl -s "https://collect-rx.fly.dev/api/health/metrics" | jq '.queue'

# 2 minutes: What's in the logs?
fly logs -a collect-rx --tail 100 | grep -E "vapi|timeout|error"

# Decision:
# IF: circuitBreaker.state == OPEN && timeoutRateLastMinute > 50%
#   → Vapi is down. Check status.vapi.ai. 
#   → Queue is ALREADY PAUSED (circuit breaker auto-defers). No action needed.
#   → Manual reset: use vapi-reset-circuit-breaker endpoint if Vapi recovers but
#     circuit breaker stays stuck.
# 
# ELSE IF: circuitBreaker.state == CLOSED && avgDurationMs < 5000
#   → Vapi is fine. Problem is database, queue engine, or PHI tokens.
#   → Check logs for connection pool / token expiry errors.
#
# ELSE IF: circuitBreaker.state == HALF_OPEN
#   → Recovery in progress. Wait 1-2 min or manually reset if Vapi is healthy.
```

---

## References

- Circuit breaker implementation: `src/vapi/circuitBreaker.ts`
- Metrics collection: `src/vapi/metrics.ts`
- Diagnostic endpoint: `src/server/routes/diagnosticsRoutes.ts`
- Queue engine: `src/server/frontDesk/queueEngine.ts`
- Ops monitor: `src/server/observability/opsMonitor.ts`
