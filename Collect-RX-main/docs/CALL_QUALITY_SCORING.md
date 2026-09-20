# Call Quality Scoring

CollectRx provides comprehensive call quality scoring across all carriers, agents, and time periods. This scoring system measures the effectiveness of the AI voice agent fleet and identifies performance issues that require operational attention.

## Overview

The Call Quality Scorer aggregates and analyzes:

1. **Success rate by carrier** — % of calls resulting in RESOLVED or APPROVED outcomes
2. **Average call duration trends** — increasing, decreasing, or stable patterns
3. **Agent performance metrics** — success rates, duration patterns, carrier specialization
4. **Outcome distribution** — breakdown of RESOLVED, DENIED, ESCALATED, FAILED, NO_ANSWER
5. **Week-over-week quality trends** — quality score trends and velocity

## Architecture

### Service: `callQualityScorer.ts`

Core service located at `src/server/services/callQualityScorer.ts`.

**Public API:**

```typescript
// Comprehensive quality report (all carriers, all agents)
scoreCallQuality(prisma: PrismaClient, input?: {
  since?: Date;           // Default: 30 days ago
  to?: Date;              // Default: now
  practiceId?: string;    // Optional scope to single practice
}): Promise<CallQualityReport>

// Carrier-specific metrics
scoreSingleCarrier(prisma: PrismaClient, carrierId: CarrierId, input?: {
  since?: Date;
  to?: Date;
  practiceId?: string;
}): Promise<CarrierQualityMetrics>
```

### Routes: `callQualityRoutes.ts`

REST API endpoints for quality scoring.

**Endpoints:**

```
GET /api/quality/score
  Query: ?days=30&practiceId=<id>
  Returns: CallQualityReport

GET /api/quality/carrier/:carrierId
  Query: ?days=30&practiceId=<id>
  Returns: CarrierQualityMetrics
```

## Scoring Methodology

### Overall Quality Score (0–100)

Calculated as a weighted average:

- **Success rate (60% weight)** — % of calls with RESOLVED or APPROVED_PENDING_PAYMENT outcomes
- **Duration quality (20% weight)** — optimal range 120–300 seconds (2–5 minutes)
  - Full credit: 120–300s
  - Partial credit: 60–600s
  - No credit: <60s or >600s
- **Volume consistency (20% weight)** — penalty for very small samples (<5 calls)

**Formula:**
```
Quality Score = (successRate × 0.6) + durationScore + volumeScore
```

Capped at 100.

### Success Rate

```
Success Rate % = (RESOLVED + APPROVED_PENDING_PAYMENT) / total_calls × 100
```

Success outcomes:
- `RESOLVED` — payment confirmed and claim closed
- `APPROVED_PENDING_PAYMENT` — carrier approved; waiting for funds to clear

### Duration Trend

Call durations are segmented into first half and second half of the time window. Trend is determined by comparing average durations:

- **Increasing** — second half avg > first half avg by >10s
- **Decreasing** — first half avg > second half avg by >10s
- **Stable** — difference <10s or <4 calls in window

### Outcome Distribution

Counts by outcome type:

- `RESOLVED` — claim successfully closed with payment
- `APPROVED` — carrier approved (maps to APPROVED_PENDING_PAYMENT)
- `DENIED` — carrier denied the claim
- `ESCALATED` — claim escalated to human or another agent
- `FAILED` — call failed (no carrier reach)
- `NO_ANSWER` — carrier IVR not responsive
- `OTHER` — misc (PENDING, HUNG_UP, BLOCK_DETECTED)

### Week-over-Week Trend

Last two weeks' quality scores are compared:

- **Improving** — current week score > previous week by >3 points
- **Stable** — difference ≤3 points
- **Declining** — current week score < previous week by >3 points

## Report Structure

### `CallQualityReport`

Top-level comprehensive quality report.

```typescript
{
  timestamp: Date;                          // Report generation time
  timeWindow: {
    from: Date;                             // Start of measurement window
    to: Date;                               // End of measurement window
    days: number;                           // Window size in days
  };

  overallQualityScore: number;              // 0-100
  overallSuccessRate: number;               // % (0-100)
  trend: 'improving' | 'stable' | 'declining';
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;

  carrierMetrics: CarrierQualityMetrics[]; // Sorted by success rate (desc)
  agentPerformance: AgentPerformance[];    // Sorted by success rate (desc)

  outcomeDistribution: {
    resolved: number;
    approved: number;
    denied: number;
    escalated: number;
    failed: number;
    noAnswer: number;
    other: number;
  };

  weeklyTrends: WeekOverWeekTrend[];       // Week-by-week breakdown

  escalationRecommendations: {
    type: 'carrier' | 'agent' | 'outcome';
    subject: string;
    reason: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    suggestedAction: string;
  }[];

  outliers: {
    lowPerformingCarriers: string[];       // Success rate <40%, >5 calls
    highErrorRates: string[];              // Agent success rate <30%, >10 calls
    unusualDurationPatterns: string[];     // Avg duration <60s or >600s
  };
}
```

### `CarrierQualityMetrics`

Per-carrier metrics.

```typescript
{
  carrierId: string;
  carrierName: string;
  successRate: number;                    // % (0-100)
  successCount: number;
  totalCalls: number;
  avgDurationSeconds: number;
  durationTrend: 'increasing' | 'decreasing' | 'stable';
  outcomeDistribution: { /* ... */ };
  outliers: string[];                     // Specific issues for this carrier
}
```

### `AgentPerformance`

Per-agent metrics.

```typescript
{
  agentName: string;                      // e.g., 'Claims_Agent', 'IVR_Navigator'
  successRate: number;                    // % (0-100)
  totalCalls: number;
  successCount: number;
  avgDurationSeconds: number;
  carriers: string[];                     // Carriers handled by this agent
}
```

### `WeekOverWeekTrend`

Week-by-week quality progression.

```typescript
{
  week: string;                           // ISO week start (YYYY-MM-DD)
  callsCount: number;
  successRate: number;                    // % (0-100)
  qualityScore: number;                   // 0-100
  durationTrend: number;                  // +/- seconds from previous week
}
```

## Escalation Thresholds

### Carrier Escalation

- **Critical:** Success rate <25% with ≥10 calls
- **High:** Success rate <40% with ≥10 calls

Recommended action: Review carrier IVR navigation, escalation procedures, and rep engagement strategy.

### Agent Escalation

- **High:** Success rate <30% with ≥20 calls

Recommended action: Review agent transcripts; consider tuning prompt or reducing call volume temporarily.

### Outcome Pattern Escalation

- **Medium:** Escalation + Denial rate >30%

Recommended action: Analyze top denial reasons; adjust pre-call validation or documentation requirements.

## Usage Examples

### Get Comprehensive Quality Report (Last 30 Days)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://collect-rx.fly.dev/api/quality/score?days=30
```

### Get Carrier-Specific Metrics

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://collect-rx.fly.dev/api/quality/carrier/sun_life?days=30
```

### Get Quality Report for Specific Practice

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://collect-rx.fly.dev/api/quality/score?days=90&practiceId=practice-id-123"
```

### Programmatic Usage (TypeScript)

```typescript
import { scoreCallQuality } from '@/server/services/callQualityScorer';
import { prisma } from '@/lib/prisma';

const to = new Date();
const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

const report = await scoreCallQuality(prisma, {
  since,
  to,
  practiceId: 'your-practice-id',
});

console.log(`Overall quality: ${report.overallQualityScore}/100`);
console.log(`Success rate: ${report.overallSuccessRate}%`);
console.log(`Trend: ${report.trend}`);

// Top-performing carrier
const bestCarrier = report.carrierMetrics[0];
console.log(`Best: ${bestCarrier.carrierName} (${bestCarrier.successRate}%)`);

// Escalations
for (const rec of report.escalationRecommendations) {
  if (rec.severity === 'critical') {
    console.warn(`CRITICAL: ${rec.subject} — ${rec.reason}`);
  }
}
```

## Integration with Platform Reporting

The quality scorer feeds into:

1. **Dashboard Analytics** — Real-time quality KPI cards
2. **Pilot Reports** — Weekly quality summaries for stakeholders
3. **Alerts & Monitoring** — Critical escalations trigger PagerDuty/Slack notifications
4. **Learning Loop** — Agent tuning inputs based on quality trends

## Performance Considerations

- **No real-time computation** — Scores computed on-demand, not continuously
- **Efficient aggregation** — Single Prisma query per window (no N+1)
- **Configurable lookback** — Default 30 days; supports up to 365 days
- **Practice scoping** — Optionally scope to single practice for multi-tenant deployments

## Testing

Run the quality scorer tests:

```bash
npx vitest run tests/callQualityScorer.test.ts
```

Tests cover:

- Empty practice (no calls)
- Success rate calculation
- Outcome distribution
- Carrier metrics aggregation
- Agent performance ranking
- Quality score computation
- Trend detection
- Escalation recommendations
- Outlier identification

## Future Enhancements

- Persistent quality score snapshots (for historical analysis)
- Anomaly detection (ML-based outlier identification)
- SLA tracking (uptime, max resolution time)
- Cost-per-resolution metrics (integrate with billing)
- Carrier-specific playbook adjustments based on quality trends
- A/B testing framework for prompt variations
