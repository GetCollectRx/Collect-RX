import pg from 'pg';

/**
 * Vitest global setup. When COLLECTRX_REQUIRE_DB=1 (set by `npm test`), the run
 * fails before any test starts if the database is unreachable. Without this,
 * DB-backed suites skip themselves and the run reports green.
 */
export default async function setup(): Promise<void> {
  if (process.env.COLLECTRX_REQUIRE_DB !== '1') return;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('COLLECTRX_REQUIRE_DB=1 but DATABASE_URL is not set. Run `npm test`, which provisions a database, or set DATABASE_URL.');
  }
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`COLLECTRX_REQUIRE_DB=1 but DATABASE_URL is unreachable: ${reason}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
