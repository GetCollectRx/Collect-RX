/**
 * ClickHouse schema for CollectRx product analytics.
 *
 * Call `runMigrations()` once at server startup (before accepting requests).
 * All DDL statements use IF NOT EXISTS / IF EXISTS so they are fully
 * idempotent — safe to re-run on every deploy.
 *
 * Table layout
 * ────────────
 *  analytics_events          Raw event log  (MergeTree, 90-day TTL)
 *  analytics_page_stats      Aggregated time-on-page  (AggregatingMergeTree)
 *  analytics_page_stats_mv   Materialized view → analytics_page_stats
 *  analytics_click_counts    Aggregated click counts  (SummingMergeTree)
 *  analytics_click_counts_mv Materialized view → analytics_click_counts
 *  analytics_funnel_steps    Per-step session counts  (AggregatingMergeTree)
 *  analytics_funnel_steps_mv Materialized view → analytics_funnel_steps
 *
 * The materialized views keep aggregates up-to-date in the background so
 * dashboard queries are instant even at millions of events.
 */

import { getClickHouseClient, isClickHouseMockMode } from './clickhouse.js';

// ---------------------------------------------------------------------------
// DDL statements (executed in order)
// ---------------------------------------------------------------------------

const DDL: string[] = [
  // ── Raw event table ────────────────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS analytics_events
  (
      event_id        String,
      type            LowCardinality(String),
      session_id      String,
      user_id         String        DEFAULT '',
      role            LowCardinality(String) DEFAULT '',
      practice_id     String        DEFAULT '',
      timestamp       DateTime64(3),
      path            String,
      duration_ms     Nullable(UInt32),
      element_label   Nullable(String),
      element_id      Nullable(String),
      element_type    LowCardinality(Nullable(String)),
      funnel_name     Nullable(String),
      funnel_step     Nullable(String),
      funnel_step_idx Nullable(UInt8),
      meta            String        DEFAULT '{}'
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMMDD(timestamp)
  ORDER BY (timestamp, session_id, type)
  TTL toDateTime(timestamp) + INTERVAL 90 DAY
  SETTINGS index_granularity = 8192
  `,

  // ── Page stats aggregate target ────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS analytics_page_stats
  (
      path            String,
      total_duration  AggregateFunction(sum, UInt64),
      visit_count     AggregateFunction(count, UInt64)
  )
  ENGINE = AggregatingMergeTree()
  ORDER BY path
  `,

  // ── Materialized view → analytics_page_stats ───────────────────────────
  `
  CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_page_stats_mv
  TO analytics_page_stats
  AS
  SELECT
      path,
      sumState(toUInt64(ifNull(duration_ms, 0)))  AS total_duration,
      countState()                                 AS visit_count
  FROM analytics_events
  WHERE type = 'page_exit'
    AND duration_ms IS NOT NULL
  GROUP BY path
  `,

  // ── Click counts aggregate target ──────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS analytics_click_counts
  (
      element_label   String,
      click_count     UInt64
  )
  ENGINE = SummingMergeTree(click_count)
  ORDER BY element_label
  `,

  // ── Materialized view → analytics_click_counts ─────────────────────────
  `
  CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_click_counts_mv
  TO analytics_click_counts
  AS
  SELECT
      ifNull(element_label, 'unknown') AS element_label,
      count()                          AS click_count
  FROM analytics_events
  WHERE type = 'click'
  GROUP BY element_label
  `,

  // ── Funnel step counts aggregate target ────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS analytics_funnel_steps
  (
      funnel_name     String,
      funnel_step     String,
      funnel_step_idx UInt8,
      unique_sessions AggregateFunction(uniq, String)
  )
  ENGINE = AggregatingMergeTree()
  ORDER BY (funnel_name, funnel_step_idx)
  `,

  // ── Materialized view → analytics_funnel_steps ─────────────────────────
  `
  CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_funnel_steps_mv
  TO analytics_funnel_steps
  AS
  SELECT
      ifNull(funnel_name,     '')  AS funnel_name,
      ifNull(funnel_step,     '')  AS funnel_step,
      ifNull(funnel_step_idx, 0)   AS funnel_step_idx,
      uniqState(session_id)        AS unique_sessions
  FROM analytics_events
  WHERE type = 'funnel_step'
  GROUP BY funnel_name, funnel_step, funnel_step_idx
  `,
];

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

export async function runTelemetryMigrations(): Promise<void> {
  if (isClickHouseMockMode()) {
    console.log('[Telemetry] CLICKHOUSE_URL unset — skipping ClickHouse migrations (mock mode).');
    return;
  }
  const client = getClickHouseClient();
  console.log('[Analytics] Running ClickHouse migrations…');

  for (const ddl of DDL) {
    try {
      await client.command({ query: ddl.trim() });
    } catch (err) {
      // Log but don't throw — analytics schema failures must not block API startup.
      console.error(
        '[Analytics] Migration error (non-fatal):',
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log('[Analytics] ClickHouse migrations complete.');
}
