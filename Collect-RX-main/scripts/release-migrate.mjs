#!/usr/bin/env node
/**
 * Fly release_command wrapper: diagnose, then run `prisma migrate deploy`.
 *
 * Why it exists: on 2026-10-02 a production migration failed with "permission denied for schema
 * public". Prisma then marked it failed and refused every later migration (P3009), so every deploy
 * after it aborted with an error that did not say what to fix. This wrapper checks the two causes
 * before migrating and prints the exact repair steps.
 *
 * Rules:
 *  - Never prints DATABASE_URL or any secret.
 *  - Never repairs anything on its own. A failed migration is a human decision.
 *  - Fails open: if the diagnostic itself cannot run, it still runs `prisma migrate deploy`, so a bug
 *    here can never be the reason a release is blocked.
 *  - The final step is the same command the release ran before: `npx prisma migrate deploy`.
 *
 * Set RELEASE_PREFLIGHT=off to skip the diagnostic.
 */
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', 'prisma', 'migrations');

/** Rows of _prisma_migrations that started but never finished and were not rolled back. */
export function failedMigrations(rows) {
  return (rows || []).filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
}

/** Migration folders on disk that the database has not recorded as applied. */
export function pendingMigrations(onDisk, appliedNames) {
  const applied = new Set(appliedNames || []);
  return (onDisk || []).filter((n) => !applied.has(n)).sort();
}

/**
 * Decide the outcome from facts. Returns { block, messages }.
 * block is true only when `prisma migrate deploy` is certain to fail.
 */
export function evaluate({ role, canCreate, failed, pending }) {
  const messages = [];
  let block = false;

  if (failed.length > 0) {
    block = true;
    messages.push(
      `BLOCKED: ${failed.length} migration(s) are recorded as failed in this database: ${failed.join(', ')}.`,
      'Prisma will not apply anything new until each one is resolved. Nothing was changed by this check.',
      'Fix:',
      '  1. Find out why it failed (see the earlier release log for that migration).',
      '  2. Look for objects it left behind (tables, enums, indexes) and remove them, or confirm none exist.',
      ...failed.map((n) => `  3. npx prisma migrate resolve --rolled-back ${n}   (or --applied ${n} if every object it creates exists)`),
      '  4. Re-run the deploy.',
      'Runbook: docs/runbooks/deploy-migration-failure.md',
    );
  }

  if (!canCreate && pending.length > 0) {
    block = true;
    messages.push(
      `BLOCKED: database role "${role}" has no CREATE privilege on schema public, and ${pending.length} migration(s) are pending: ${pending.join(', ')}.`,
      'They would fail with "permission denied for schema public" and leave a failed migration behind.',
      'Fix: as the database owner run  GRANT USAGE, CREATE ON SCHEMA public TO "' + role + '";',
      'or point the release at an owner-role connection string instead. Then re-run the deploy.',
      'Runbook: docs/runbooks/deploy-migration-failure.md',
    );
  } else if (!canCreate) {
    messages.push(
      `WARNING: database role "${role}" has no CREATE privilege on schema public. No migrations are pending, so this release is unaffected, but the next one with a migration will fail.`,
    );
  }

  return { block, messages };
}

async function collectFacts(databaseUrl) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const who = await client.query(
      `SELECT current_user AS role, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`,
    );
    let rows = [];
    try {
      const r = await client.query('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations');
      rows = r.rows;
    } catch (e) {
      if (e && e.code !== '42P01') throw e; // 42P01: fresh database, no history table yet
    }
    const onDisk = existsSync(MIGRATIONS_DIR)
      ? readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : [];
    const appliedNames = rows.filter((r) => r.finished_at).map((r) => r.migration_name);
    return {
      role: who.rows[0].role,
      canCreate: who.rows[0].can_create === true,
      failed: failedMigrations(rows),
      pending: pendingMigrations(onDisk, appliedNames),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if ((process.env.RELEASE_PREFLIGHT || '').toLowerCase() !== 'off' && process.env.DATABASE_URL) {
    try {
      const facts = await collectFacts(process.env.DATABASE_URL);
      const { block, messages } = evaluate(facts);
      for (const m of messages) console.error(`[release-preflight] ${m}`);
      if (block) process.exit(1);
      console.log(`[release-preflight] ok: role=${facts.role}, ${facts.pending.length} pending, 0 failed`);
    } catch (e) {
      console.error(`[release-preflight] could not run the check (${e && e.message ? e.message : e}); continuing to migrate deploy`);
    }
  }
  const res = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
  process.exit(res.status === null ? 1 : res.status);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
