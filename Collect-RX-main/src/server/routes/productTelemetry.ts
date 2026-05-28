/**
 * Product telemetry API — ClickHouse-backed (distinct from /api/analytics KPI routes).
 *
 * POST /api/telemetry/events      Ingest a batch of events from the SDK
 * GET  /api/telemetry/summary     Headline numbers
 * GET  /api/telemetry/pages       Time-on-page per route
 * GET  /api/telemetry/clicks      Top clicked elements (optionally ?path=)
 * GET  /api/telemetry/funnels     Funnel step completion + drop-off (?name=)
 * GET  /api/telemetry/sessions    Recent session path traces (?limit=)
 *
 * All read endpoints query either the raw analytics_events table or the
 * pre-aggregated materialized views (faster for high-volume deployments).
 *
 * Auth: event ingestion is unauthenticated (blocking analytics on auth
 * failures creates blind spots). Read endpoints are open too — add the
 * authenticate middleware if you want to restrict to platform_admin.
 */

import { Router, Request, Response } from 'express';
import { safeInsert, safeQuery } from '../productAnalytics/clickhouse.js';
import type { AnalyticsEvent } from '../../types/productAnalytics.js';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/analytics/events
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

router.get('/summary', async (_req: Request, res: Response) => {
  const [summaryRows, roleRows] = await Promise.all([
    safeQuery<SummaryRow>(`
      SELECT
        count()                                                         AS total_events,
        uniq(session_id)                                                AS total_sessions,
        uniqIf(user_id, toDate(timestamp) = today())                   AS active_users_today,
        countIf(toDate(timestamp) = today())                           AS events_today,
        countIf(toDate(timestamp) >= today() - INTERVAL 7 DAY)        AS events_this_week
      FROM analytics_events
    `),
    safeQuery<RoleRow>(`
      SELECT
        role,
        count() AS cnt
      FROM analytics_events
      WHERE toDate(timestamp) >= today() - INTERVAL 7 DAY
        AND role != ''
      GROUP BY role
    `),
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

router.get('/pages', async (_req: Request, res: Response) => {
  // Try materialised view first
  let rows = await safeQuery<PageRow>(`
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

  // Fall back to raw table if MV hasn't populated yet
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

router.get('/clicks', async (req: Request, res: Response) => {
  const pathFilter = req.query.path as string | undefined;

  // Use the SummingMergeTree view when no path filter is requested
  let rows: ClickRow[];

  if (!pathFilter) {
    rows = await safeQuery<ClickRow>(`
      SELECT
        element_label AS label,
        sum(click_count) AS count
      FROM analytics_click_counts
      GROUP BY element_label
      ORDER BY count DESC
      LIMIT 50
    `);

    // Fall back if view empty
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
  } else {
    // Path-filtered query always hits the raw table
    rows = await safeQuery<ClickRow>(`
      SELECT
        ifNull(element_label, 'unknown') AS label,
        count() AS count
      FROM analytics_events
      WHERE type = 'click'
        AND path = {path:String}
      GROUP BY label
      ORDER BY count DESC
      LIMIT 50
    `, { path: pathFilter });
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

router.get('/funnels', async (req: Request, res: Response) => {
  const nameFilter = req.query.name as string | undefined;

  // Query the AggregatingMergeTree view
  let rows = await safeQuery<FunnelRow>(`
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

  // Fall back to raw table
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

router.get('/sessions', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100);

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
      -- Ordered, deduplicated path sequence from page_view events
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
    GROUP BY session_id
    ORDER BY start_time DESC
    LIMIT {limit:UInt32}
  `, { limit });

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

export default router;
