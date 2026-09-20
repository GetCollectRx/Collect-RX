// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Postgres RLS role safety check
//
// docs/operations/HUMAN-DECISIONS-PENDING.md #3: Postgres RLS tenant isolation
// (prisma/migrations/20260712000000_rls_and_phi_vault_practice) only actually
// isolates tenants when the connecting role is NOSUPERUSER and does not have
// BYPASSRLS — either attribute makes every FORCE ROW LEVEL SECURITY policy a
// silent no-op: no error, no log line, queries keep returning correct-looking
// results because the app-layer practiceId filters are still there. A
// misconfigured production role (e.g. connecting as the Postgres superuser,
// or a role that picked up BYPASSRLS from a one-off maintenance grant that
// never got revoked) would fail completely silently.
//
// This turns that into a loud, checkable failure instead — Option B from the
// doc above Option A (one-time manual `psql` verification, still worth doing
// once): query the role's actual attributes and cache the result at boot, so
// GET /api/health/ready can report it cheaply on every check instead of
// re-querying pg_roles per request.
// ─────────────────────────────────────────────────────────────────────────────
import type { PrismaClient } from '@prisma/client';

export interface RlsRoleSafety {
  checked: boolean;
  safe: boolean;
  rolname: string | null;
  rolsuper: boolean | null;
  rolbypassrls: boolean | null;
  error: string | null;
}

const UNCHECKED: RlsRoleSafety = {
  checked: false,
  safe: true,
  rolname: null,
  rolsuper: null,
  rolbypassrls: null,
  error: null,
};

let cached: RlsRoleSafety = UNCHECKED;

export function getCachedRlsRoleSafety(): RlsRoleSafety {
  return cached;
}

/** Test-only: reset the cache between cases. */
export function resetRlsRoleSafetyCacheForTests(): void {
  cached = UNCHECKED;
}

/**
 * Queries the connecting role's rolsuper/rolbypassrls and caches the result.
 * Call once at boot, after Prisma can reach the database. Never throws —
 * a query failure (e.g. sqlite in tests, DB briefly unreachable) is recorded
 * as `error` rather than crashing startup; callers decide what to do with
 * `safe: false`.
 */
export async function checkRlsRoleSafety(prisma: PrismaClient): Promise<RlsRoleSafety> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
    >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    const row = rows[0];
    if (!row) {
      cached = { ...UNCHECKED, checked: true, safe: false, error: 'current_user not found in pg_roles' };
      return cached;
    }
    const safe = !row.rolsuper && !row.rolbypassrls;
    cached = {
      checked: true,
      safe,
      rolname: row.rolname,
      rolsuper: row.rolsuper,
      rolbypassrls: row.rolbypassrls,
      error: null,
    };
    if (!safe) {
      console.error(
        `[server] FATAL RLS GAP: Postgres role "${row.rolname}" has rolsuper=${row.rolsuper} ` +
          `rolbypassrls=${row.rolbypassrls} — every FORCE ROW LEVEL SECURITY tenant-isolation ` +
          'policy is silently ignored for this connection. See docs/operations/HUMAN-DECISIONS-PENDING.md #3.',
      );
    }
    return cached;
  } catch (err) {
    cached = { ...UNCHECKED, checked: true, safe: false, error: (err as Error).message };
    return cached;
  }
}
