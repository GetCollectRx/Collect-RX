// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — PostgreSQL TLS guard
//
// Prisma talks to Postgres over TCP. In production we require TLS on that hop
// (encryption in transit) via sslmode=require or stricter, or ssl=true.
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

/** Exit the process in production when Postgres TLS is not configured. */
export function assertPostgresTlsInProduction(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const url = process.env.DATABASE_URL || '';
  if (!isPostgresConnectionString(url)) return;
  if (postgresUrlUsesStrictSsl(url)) return;

  console.error(
    '[server] FATAL: DATABASE_URL must require TLS to PostgreSQL in production. ' +
      'Append ?sslmode=require (or verify-full / verify-ca) to the connection string, ' +
      'or add ssl=true to the query string. See docs/operations/DATA-ENCRYPTION.md.',
  );
  process.exit(1);
}
