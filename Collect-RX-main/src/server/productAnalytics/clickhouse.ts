/**
 * ClickHouse client singleton for CollectRx analytics.
 *
 * All analytics writes and reads go through this module.
 * The client is lazy-initialised on first use so the server
 * can start even if ClickHouse is temporarily unavailable
 * (analytics must never crash the main application).
 *
 * Connection config comes from environment variables:
 *   CLICKHOUSE_URL      http://localhost:8123   (HTTP interface)
 *   CLICKHOUSE_USER     collectrx
 *   CLICKHOUSE_PASSWORD collectrx_ch_dev_only
 *   CLICKHOUSE_DB       collectrx_analytics
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';

let _client: ClickHouseClient | null = null;

/** When unset, telemetry is accepted but not stored (safe for Railway without ClickHouse). */
export function isClickHouseMockMode(): boolean {
  return !(process.env.CLICKHOUSE_URL ?? '').trim();
}

export function getClickHouseClient(): ClickHouseClient {
  if (isClickHouseMockMode()) {
    throw new Error('ClickHouse is not configured (CLICKHOUSE_URL unset)');
  }
  if (!_client) {
    _client = createClient({
      url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER ?? 'collectrx',
      password: process.env.CLICKHOUSE_PASSWORD ?? 'collectrx_ch_dev_only',
      database: process.env.CLICKHOUSE_DB ?? 'collectrx_analytics',
      // Keep-alive pool — one persistent connection per Node process.
      // The HTTP interface multiplexes queries over it.
      keep_alive: { enabled: true },
      // Request timeout (ms) — analytics queries should be fast.
      request_timeout: 10_000,
    });
  }
  return _client;
}

/**
 * Fire-and-forget wrapper. Analytics writes should NEVER propagate errors
 * to the caller — a dropped event is acceptable; a crashed API is not.
 */
export async function safeQuery<T = unknown>(
  query: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  if (isClickHouseMockMode()) return [];
  try {
    const client = getClickHouseClient();
    const result = await client.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });
    return await result.json<T>();
  } catch (err) {
    console.error('[ClickHouse] query error:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function safeInsert(
  table: string,
  values: Record<string, unknown>[]
): Promise<void> {
  if (values.length === 0 || isClickHouseMockMode()) return;
  try {
    const client = getClickHouseClient();
    await client.insert({
      table,
      values,
      format: 'JSONEachRow',
    });
  } catch (err) {
    console.error('[ClickHouse] insert error:', err instanceof Error ? err.message : err);
  }
}

/** Ping ClickHouse — used in the /health endpoint. */
export async function pingClickHouse(): Promise<boolean> {
  if (isClickHouseMockMode()) return false;
  try {
    const client = getClickHouseClient();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}
