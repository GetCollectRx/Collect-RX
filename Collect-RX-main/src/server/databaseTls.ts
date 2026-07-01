// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — PostgreSQL TLS guard
//
// Prisma talks to Postgres over TCP. In production we require TLS on that hop
// (encryption in transit) via sslmode=require or stricter, or ssl=true —
// except on Fly.io's private network (`.internal` / `.flycast` hosts), which
// never leaves Fly's own WireGuard mesh: that hop is already encrypted at the
// network layer, and Fly Postgres does not enable app-layer SSL on it by
// default, so forcing sslmode=require there breaks the connection outright
// ("server does not support SSL, but SSL was required") for no security gain.
// See docs/operations/DATA-ENCRYPTION.md.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_SSLMODES = new Set(['require', 'verify-ca', 'verify-full']);

/**
 * Returns true if the URL is not a Postgres URL (e.g. sqlite file: for CI) —
 * callers typically skip TLS rules for those.
 */
export function isPostgresConnectionString(databaseUrl: string): boolean {
  const lower = (databaseUrl || '').trim().toLowerCase();
  return lower.startsWith('postgresql://') || lower.startsWith('postgres://');
}

/**
 * True for hosts on Fly.io's private network — already encrypted end-to-end
 * by Fly's WireGuard mesh, never routed over the public internet.
 */
export function isFlyPrivateNetworkHost(databaseUrl: string): boolean {
  try {
    const { hostname } = new URL(databaseUrl.replace(/^postgres:/, 'postgresql:'));
    return hostname.endsWith('.flycast') || hostname.endsWith('.internal');
  } catch {
    return false;
  }
}

/**
 * Whether the connection string explicitly enables TLS to PostgreSQL.
 * Matches query params Prisma/node-postgres accept (see Prisma Postgres docs).
 */
export function postgresUrlUsesStrictSsl(databaseUrl: string): boolean {
  const trimmed = (databaseUrl || '').trim();
  if (!trimmed) return false;
  if (!isPostgresConnectionString(trimmed)) return true;

  const qIndex = trimmed.indexOf('?');
  if (qIndex === -1) return false;
  const query = trimmed.slice(qIndex + 1).split('#')[0];
  try {
    const params = new URLSearchParams(query);
    const sslmode = (params.get('sslmode') || '').toLowerCase();
    if (ALLOWED_SSLMODES.has(sslmode)) return true;
    if (params.get('ssl') === 'true') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Force sslmode=require when the connection string doesn't already use strict
 * TLS — replacing any weaker/explicit sslmode (e.g. sslmode=disable), not just
 * appending. URLSearchParams.get() returns the first match on a repeated key,
 * so appending a second sslmode param left the original (weak) value in force
 * and made this a no-op in production regardless of how many times it ran.
 */
export function withPostgresTlsDefault(databaseUrl: string): string {
  const trimmed = (databaseUrl || '').trim();
  if (!trimmed || !isPostgresConnectionString(trimmed)) return trimmed;
  if (postgresUrlUsesStrictSsl(trimmed)) return trimmed;
  if (isFlyPrivateNetworkHost(trimmed)) return trimmed;

  const qIndex = trimmed.indexOf('?');
  const base = qIndex === -1 ? trimmed : trimmed.slice(0, qIndex);
  const query = qIndex === -1 ? '' : trimmed.slice(qIndex + 1).split('#')[0];
  const params = new URLSearchParams(query);
  params.delete('sslmode');
  params.delete('ssl');
  params.set('sslmode', 'require');
  return `${base}?${params.toString()}`;
}

/** Mutate process.env.DATABASE_URL before Prisma reads it. */
export function applyPostgresTlsToProcessEnv(): void {
  const url = process.env.DATABASE_URL || '';
  if (!url) return;
  const next = withPostgresTlsDefault(url);
  if (next === url) return;
  process.env.DATABASE_URL = next;
  if (process.env.NODE_ENV === 'production') {
    console.log('[server] DATABASE_URL: auto-enabled TLS (sslmode=require)');
  }
}

/** Exit the process in production when Postgres TLS is not configured. */
export function assertPostgresTlsInProduction(): void {
  if (process.env.NODE_ENV !== 'production') return;
  applyPostgresTlsToProcessEnv();
  const url = process.env.DATABASE_URL || '';
  if (!isPostgresConnectionString(url)) return;
  if (postgresUrlUsesStrictSsl(url)) return;
  if (isFlyPrivateNetworkHost(url)) return;

  console.error(
    '[server] FATAL: DATABASE_URL must require TLS to PostgreSQL in production. ' +
      'Append ?sslmode=require (or verify-full / verify-ca) to the connection string, ' +
      'or add ssl=true to the query string. See docs/operations/DATA-ENCRYPTION.md.',
  );
  process.exit(1);
}
