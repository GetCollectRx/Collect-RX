// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — PostgreSQL RLS role guard
//
// Row-level security (migration 20260712000000_rls_and_phi_vault_practice)
// is enforced with FORCE ROW LEVEL SECURITY on tenant tables, and Prisma sets
// app.practice_id / app.rls_bypass per request (src/lib/prismaRls.ts). But
// Postgres superusers and any role with the BYPASSRLS attribute silently
// ignore FORCE RLS — no error, no log line, queries just stop being
// tenant-scoped at the database layer. CI proves the policies are correct
// under a purpose-built NOSUPERUSER NOBYPASSRLS role
// (.github/workflows/collectrx-ci.yml's rls-strict job, tests/rls.strict.test.ts)
// but nothing had ever checked that the role the *running app* connects as
// meets that condition — see docs/operations/HUMAN-DECISIONS-PENDING.md item 3.
// This guard makes that failure mode loud instead of silent.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client';

export interface RlsRoleFlags {
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/** Queries pg_roles for the currently-connected role's superuser/bypassrls attributes. */
export async function fetchCurrentRoleRlsFlags(prisma: PrismaClient): Promise<RlsRoleFlags> {
  const rows = await prisma.$queryRaw<RlsRoleFlags[]>`
    SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  const row = rows[0];
  if (!row) {
    throw new Error('could not resolve current_user in pg_roles');
  }
  return row;
}

export type RlsRoleGuardAction =
  | { kind: 'skip'; reason: string }
  | { kind: 'ok' }
  | { kind: 'unsafe'; message: string };

/**
 * Pure decision logic, kept separate from the Prisma/process side effects so
 * every branch is unit-testable without a real database connection.
 */
export function evaluateRlsRoleGuard(
  flags: RlsRoleFlags,
  env: { nodeEnv: string | undefined; rlsEnabled: boolean },
): RlsRoleGuardAction {
  if (env.nodeEnv !== 'production') {
    return { kind: 'skip', reason: 'not production' };
  }
  if (!env.rlsEnabled) {
    return { kind: 'skip', reason: 'COLLECTRX_RLS_ENABLED=0 — RLS intentionally off, role check does not apply' };
  }
  if (!flags.rolsuper && !flags.rolbypassrls) {
    return { kind: 'ok' };
  }
  const attrs = [flags.rolsuper && 'a superuser', flags.rolbypassrls && 'BYPASSRLS'].filter(Boolean).join(' and ');
  return {
    kind: 'unsafe',
    message:
      `the production database role is ${attrs} — PostgreSQL row-level security silently ` +
      'no-ops for this connection, so tenant isolation (FORCE RLS on insurance_claim, ' +
      'phi_vault_entry, and related tables) is not enforced at the database layer. ' +
      'Provision a NOSUPERUSER NOBYPASSRLS application role and point DATABASE_URL at it ' +
      '(see docs/operations/HUMAN-DECISIONS-PENDING.md item 3 for the exact verification ' +
      'queries). Set COLLECTRX_RLS_ROLE_GUARD=0 to bypass this check temporarily while fixing ' +
      'the role — never as a permanent setting.',
  };
}

/**
 * Fails closed in production when the connected role would silently bypass
 * RLS. A diagnostic-query failure (e.g. insufficient privilege to read
 * pg_roles) is logged but does not crash the process — this guard adds
 * detection, it should never become a new way for the app to go down.
 *
 * Escape hatch: COLLECTRX_RLS_ROLE_GUARD=0 skips the check, for the window
 * between discovering an unsafe role and rotating DATABASE_URL to a fixed
 * one — not a long-term setting.
 */
export async function assertRlsRoleSafeInProduction(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.COLLECTRX_RLS_ROLE_GUARD === '0') {
    console.warn('[server] RLS role guard skipped — COLLECTRX_RLS_ROLE_GUARD=0');
    return;
  }

  let flags: RlsRoleFlags;
  try {
    flags = await fetchCurrentRoleRlsFlags(prisma);
  } catch (err) {
    console.error('[server] Could not verify DB role RLS safety (non-fatal):', (err as Error).message);
    return;
  }

  const action = evaluateRlsRoleGuard(flags, {
    nodeEnv: process.env.NODE_ENV,
    rlsEnabled: process.env.COLLECTRX_RLS_ENABLED !== '0',
  });

  if (action.kind === 'unsafe') {
    console.error(`[server] FATAL: ${action.message}`);
    process.exit(1);
  } else if (action.kind === 'ok') {
    console.log('[server] DB role RLS safety verified (NOSUPERUSER, NOBYPASSRLS)');
  }
}
