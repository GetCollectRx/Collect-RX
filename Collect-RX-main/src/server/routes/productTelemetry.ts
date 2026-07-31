/**
 * Product telemetry API — ClickHouse-backed (distinct from /api/analytics KPI routes).
 *
 * POST /api/telemetry/events      Ingest a batch of events from the SDK (unauthenticated)
 * GET  /api/telemetry/summary     Headline numbers (auth: platform_admin | practice_owner)
 * GET  /api/telemetry/pages       Time-on-page per route
 * GET  /api/telemetry/clicks      Top clicked elements (optionally ?path=)
 * GET  /api/telemetry/funnels     Funnel step completion + drop-off (?name=)
 * GET  /api/telemetry/sessions    Recent session path traces (?limit=)
 *
 * Read endpoints require auth. platform_admin sees cross-tenant aggregates;
 * practice_owner is scoped to their session practice_id.
 */

import { Router, Request, Response } from 'express';
import { safeInsert, safeQuery } from '../productAnalytics/clickhouse.js';
import type { AnalyticsEvent } from '../../types/productAnalytics.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireUserRoles } from '../middleware/requireUserRole.js';
import { practiceIdFromSession } from '../middleware/requirePracticeSession.js';
import { isPlatformAdmin } from '../accessControl/types.js';

const router = Router();

type TelemetryScope =
  | { mode: 'all' }
  | { mode: 'practice'; practiceId: string };

function resolveTelemetryScope(req: Request): TelemetryScope {
  const auth = req.auth ?? req.practiceAuth;
  if (isPlatformAdmin(auth)) {
    return { mode: 'all' };
  }
  return { mode: 'practice', practiceId: practiceIdFromSession(req) };
}

function scopeParams(scope: TelemetryScope): Record<string, string> | undefined {
  return scope.mode === 'practice' ? { practiceId: scope.practiceId } : undefined;
}

function scopeFilter(scope: TelemetryScope, column = 'practice_id'): string {
  return scope.mode === 'practice' ? `AND ${column} = {practiceId:String}` : '';
}

const readRouter = Router();
readRouter.use(authenticate);
readRouter.use(requireUserRoles('platform_admin', 'practice_owner'));

// ---------------------------------------------------------------------------
// POST /api/telemetry/events — ingestion stays open so auth failures don't blind analytics
// ---------------------------------------------------------------------------

router.post('/events', async (req: Request, res: Response) => {
  const { events } = req.body as { events: AnalyticsEvent[] };

  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'events must be a non-empty array' });
  }

  // Map SDK shape → ClickHouse column names + strip any accidental PHI
  const rows = events.map((e) => {
    // Sanitise meta — never store patient names, DOBs, health card numbers
    const safeMeta = e.meta
      ? Object.fromEntries(
          Object.entries(e.meta).filter(
            ([k]) => !['patientName', 'dob', 'healthCard'].includes(k)
          )
        )
      : {};

    return {
      event_id:        e.eventId ?? '',
      type:            e.type ?? 'unknown',
      session_id:      e.sessionId ?? '',
      user_id:         e.userId ?? '',
      role:            e.role ?? '',
      practice_id:     e.practiceId ?? '',
      // ClickHouse DateTime64 accepts ISO string or Unix-ms
      timestamp:       new Date(e.timestamp ?? Date.now()).toISOString().replace('T', ' ').replace('Z', ''),
      path:            e.path ?? '/',
      duration_ms:     e.durationMs ?? null,
      element_label:   e.elementLabel ?? null,
      element_id:      e.elementId ?? null,
      element_type:    e.elementType ?? null,
      funnel_name:     e.funnelName ?? null,
      funnel_step:     e.funnelStep ?? null,
      funnel_step_idx: e.funnelStepIndex ?? null,
      meta:            JSON.stringify(safeMeta),
    };
  });

  // Fire-and-forget — never block the HTTP response on the insert
  safeInsert('analytics_events', rows);

  return res.status(202).json({ accepted: rows.length });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/summary
// ---------------------------------------------------------------------------

interface SummaryRow {
  total_events: string;
  total_sessions: string;
  active_users_today: string;
  events_today: string;
  events_this_week: string;
}

interface RoleRow {
  role: string;
  cnt: string;
}

readRouter.get('/summary', async (req: Request, res: Response) => {
  const scope = resolveTelemetryScope(req);
  const params = scopeParams(scope);
  const pf = scopeFilter(scope);

  const [summaryRows, roleRows] = await Promise.all([
    safeQuery<SummaryRow>(`
      SELECT
        count()                                                         AS total_events,
        uniq(session_id)                                                AS total_sessions,
        uniqIf(user_id, toDate(timestamp) = today())                   AS active_users_today,
        countIf(toDate(timestamp) = today())                           AS events_today,
        countIf(toDate(timestamp) >= today() - INTERVAL 7 DAY)        AS events_this_week
      FROM analytics_events
      WHERE 1=1 ${pf}
    `, params),
    safeQuery<RoleRow>(`
      SELECT
        role,
        count() AS cnt
      FROM analytics_events
      WHERE toDate(timestamp) >= today() - INTERVAL 7 DAY
        AND role != ''
        ${pf}
      GROUP BY role
    `, params),
  ]);

  const s = summaryRows[0] ?? {
    total_events: '0',
    total_sessions: '0',
    active_users_today: '0',
    events_today: '0',
    events_this_week: '0',
  };

  const eventsByRole: Record<string, number> = {};
  for (const r of roleRows) {
    eventsByRole[r.role] = Number(r.cnt);
  }

  return res.json({
    totalEvents:        Number(s.total_events),
    totalSessions:      Number(s.total_sessions),
    activeUsersToday:   Number(s.active_users_today),
    eventsToday:        Number(s.events_today),
    eventsThisWeek:     Number(s.events_this_week),
    eventsByRole,
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/pages
// Queries the analytics_page_stats materialized view for speed.
// Falls back to the raw table if the view is empty (first startup).
// ---------------------------------------------------------------------------

interface PageRow {
  path: string;
  visits: string;
  avg_duration_ms: string;
}

readRouter.get('/pages', async (req: Request, res: Response) => {
  const scope = resolveTelemetryScope(req);
  const params = scopeParams(scope);
  const pf = scopeFilter(scope);

  let rows: PageRow[];

  if (scope.mode === 'all') {
    rows = await safeQuery<PageRow>(`
      SELECT
        path,
        countMerge(visit_count)                  AS visits,
        toUInt64(sumMerge(total_duration)
          / greatest(countMerge(visit_count), 1)) AS avg_duration_ms
      FROM analytics_page_stats
      GROUP BY path
      ORDER BY avg_duration_ms DESC
      LIMIT 20
    `);

    if (rows.length === 0) {
      rows = await safeQuery<PageRow>(`
        SELECT
          path,
          count()          AS visits,
          avg(duration_ms) AS avg_duration_ms
        FROM analytics_events
        WHERE type = 'page_exit'
          AND duration_ms IS NOT NULL
        GROUP BY path
        ORDER BY avg_duration_ms DESC
        LIMIT 20
      `);
    }
  } else {
    rows = await safeQuery<PageRow>(`
      SELECT
        path,
        count()          AS visits,
        avg(duration_ms) AS avg_duration_ms
      FROM analytics_events
      WHERE type = 'page_exit'
        AND duration_ms IS NOT NULL
        ${pf}
      GROUP BY path
      ORDER BY avg_duration_ms DESC
      LIMIT 20
    `, params);
  }

  const pages = rows.map((r) => ({
    path:           r.path,
    visits:         Number(r.visits),
    avgDurationMs:  Math.round(Number(r.avg_duration_ms)),
    avgDurationSec: Math.round(Number(r.avg_duration_ms) / 1000),
  }));

  return res.json({ pages });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/clicks?path=/some/route
// ---------------------------------------------------------------------------

interface ClickRow {
  label: string;
  count: string;
}

readRouter.get('/clicks', async (req: Request, res: Response) => {
  const pathFilter = req.query.path as string | undefined;
  const scope = resolveTelemetryScope(req);
  const params = scopeParams(scope);
  const pf = scopeFilter(scope);

  let rows: ClickRow[];

  if (!pathFilter && scope.mode === 'all') {
    rows = await safeQuery<ClickRow>(`
      SELECT
        element_label AS label,
        sum(click_count) AS count
      FROM analytics_click_counts
      GROUP BY element_label
      ORDER BY count DESC
      LIMIT 50
    `);

    if (rows.length === 0) {
      rows = await safeQuery<ClickRow>(`
        SELECT
          ifNull(element_label, 'unknown') AS label,
          count() AS count
        FROM analytics_events
        WHERE type = 'click'
        GROUP BY label
        ORDER BY count DESC
        LIMIT 50
      `);
    }
  } else if (!pathFilter) {
    rows = await safeQuery<ClickRow>(`
      SELECT
        ifNull(element_label, 'unknown') AS label,
        count() AS count
      FROM analytics_events
      WHERE type = 'click'
        ${pf}
      GROUP BY label
      ORDER BY count DESC
      LIMIT 50
    `, params);
  } else {
    rows = await safeQuery<ClickRow>(`
      SELECT
        ifNull(element_label, 'unknown') AS label,
        count() AS count
      FROM analytics_events
      WHERE type = 'click'
        AND path = {path:String}
        ${pf}
      GROUP BY label
      ORDER BY count DESC
      LIMIT 50
    `, { ...params, path: pathFilter });
  }

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  return res.json({
    clicks: rows.map((r) => ({ label: r.label, count: Number(r.count) })),
    total,
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/funnels?name=claim_upload
// ---------------------------------------------------------------------------

interface FunnelRow {
  funnel_name: string;
  funnel_step: string;
  funnel_step_idx: string;
  sessions: string;
}

readRouter.get('/funnels', async (req: Request, res: Response) => {
  const nameFilter = req.query.name as string | undefined;
  const scope = resolveTelemetryScope(req);
  const params = scopeParams(scope);
  const pf = scopeFilter(scope);

  let rows: FunnelRow[];

  if (scope.mode === 'all') {
    rows = await safeQuery<FunnelRow>(`
      SELECT
        funnel_name,
        funnel_step,
        funnel_step_idx,
        uniqMerge(unique_sessions) AS sessions
      FROM analytics_funnel_steps
      ${nameFilter ? 'WHERE funnel_name = {name:String}' : ''}
      GROUP BY funnel_name, funnel_step, funnel_step_idx
      ORDER BY funnel_name, funnel_step_idx
    `, nameFilter ? { name: nameFilter } : undefined);

    if (rows.length === 0) {
      rows = await safeQuery<FunnelRow>(`
        SELECT
          funnel_name,
          funnel_step,
          funnel_step_idx,
          uniq(session_id) AS sessions
        FROM analytics_events
        WHERE type = 'funnel_step'
          AND funnel_name != ''
          ${nameFilter ? "AND funnel_name = {name:String}" : ''}
        GROUP BY funnel_name, funnel_step, funnel_step_idx
        ORDER BY funnel_name, funnel_step_idx
      `, nameFilter ? { name: nameFilter } : undefined);
    }
  } else {
    rows = await safeQuery<FunnelRow>(`
      SELECT
        funnel_name,
        funnel_step,
        funnel_step_idx,
        uniq(session_id) AS sessions
      FROM analytics_events
      WHERE type = 'funnel_step'
        AND funnel_name != ''
        ${nameFilter ? "AND funnel_name = {name:String}" : ''}
        ${pf}
      GROUP BY funnel_name, funnel_step, funnel_step_idx
      ORDER BY funnel_name, funnel_step_idx
    `, nameFilter ? { ...params, name: nameFilter } : params);
  }

  // Group rows by funnel name and compute drop-off
  const byFunnel: Record<string, { stepName: string; stepIdx: number; sessions: number }[]> = {};
  for (const r of rows) {
    if (!byFunnel[r.funnel_name]) byFunnel[r.funnel_name] = [];
    byFunnel[r.funnel_name].push({
      stepName: r.funnel_step,
      stepIdx:  Number(r.funnel_step_idx),
      sessions: Number(r.sessions),
    });
  }

  const funnels = Object.entries(byFunnel).map(([funnelName, steps]) => {
    const sorted = steps.sort((a, b) => a.stepIdx - b.stepIdx);
    const topCount = sorted[0]?.sessions ?? 0;

    return {
      funnelName,
      steps: sorted.map((s) => ({
        index:          s.stepIdx,
        stepName:       s.stepName,
        sessions:       s.sessions,
        completionPct:  topCount > 0 ? Math.round((s.sessions / topCount) * 100) : 0,
        dropOffPct:     topCount > 0 ? Math.round((1 - s.sessions / topCount) * 100) : 0,
      })),
    };
  });

  return res.json({ funnels });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/sessions?limit=20
// ---------------------------------------------------------------------------

interface SessionRow {
  session_id: string;
  user_id: string;
  role: string;
  start_time: string;
  end_time: string;
  duration_ms: string;
  event_count: string;
  paths: string; // comma-separated from groupArray
}

readRouter.get('/sessions', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const scope = resolveTelemetryScope(req);
  const params = scopeParams(scope);
  const pf = scopeFilter(scope);

  const rows = await safeQuery<SessionRow>(`
    SELECT
      session_id,
      argMin(user_id, timestamp)   AS user_id,
      argMin(role, timestamp)      AS role,
      min(timestamp)               AS start_time,
      max(timestamp)               AS end_time,
      dateDiff('millisecond',
        toDateTime(min(timestamp)),
        toDateTime(max(timestamp))) AS duration_ms,
      count()                      AS event_count,
      arrayStringConcat(
        arrayDistinct(
          arraySort(
            x -> x.1,
            groupArray((toUnixTimestamp64Milli(timestamp), path))
          ).2
        ),
        '|||'
      ) AS paths
    FROM analytics_events
    WHERE type = 'page_view'
      ${pf}
    GROUP BY session_id
    ORDER BY start_time DESC
    LIMIT {limit:UInt32}
  `, { ...params, limit });

  const sessions = rows.map((r) => ({
    sessionId:    r.session_id,
    userId:       r.user_id || undefined,
    role:         r.role || undefined,
    startTime:    new Date(r.start_time).getTime(),
    endTime:      new Date(r.end_time).getTime(),
    durationMs:   Number(r.duration_ms),
    eventCount:   Number(r.event_count),
    pathSequence: r.paths ? r.paths.split('|||').filter(Boolean) : [],
  }));

  return res.json({ sessions });
});

router.use(readRouter);

export default router;
