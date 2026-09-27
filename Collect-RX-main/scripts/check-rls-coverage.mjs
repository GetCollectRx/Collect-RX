#!/usr/bin/env node
/**
 * CI gate (SHIPPABILITY-BACKLOG.md P0-03): fails the build if any
 * practiceId/organizationId-bearing table lacks FORCE ROW LEVEL SECURITY and
 * at least one policy. This is the structural gap that let RLS coverage
 * drift in one migration at a time before 2026-09-26's
 * multi_practice_rls_coverage migration — 29 tenant tables had accumulated
 * with no policy at all, silently, with nothing to catch it.
 *
 * Static half: parses prisma/schema.prisma for every model with a
 * practiceId or organizationId field, resolves each to its actual Postgres
 * table name (the model name itself, or its @@map).
 *
 * Live half: queries pg_class/pg_policies against DATABASE_URL for each of
 * those tables' actual relforcerowsecurity + policy count.
 *
 * A short, explicit, commented ALLOWLIST covers tables with a real, already-
 * documented reason RLS isn't (yet) appropriate — anything not on it must be
 * covered, or this script fails the build. Run: node scripts/check-rls-coverage.mjs
 * (from Collect-RX-main; needs DATABASE_URL pointed at a migrated database).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * Tables intentionally excluded, with the reason on record — see the
 * 2026-09-26 multi_practice_rls_coverage migration's own header comment for
 * the full reasoning behind each entry.
 */
const ALLOWLIST = new Map([
  ['RuleSet', 'confirmed dead code — no non-test call sites (schema comment on the model itself says so)'],
  ['QueuePriority', 'confirmed zero non-test call sites'],
  ['Practice', 'self-referential id-as-tenant-key — a CREATE-time policy needs its own design, not this loop\'s shape (see migration header)'],
  ['BenefitCoverage', 'patientToken-scoped, not practiceId — needs a join-based policy through phi_vault_entries, not yet designed'],
  ['PlanYear', 'patientToken-scoped, not practiceId — same as BenefitCoverage'],
  ['EligibilityCall', 'patientToken-scoped, not practiceId — same as BenefitCoverage'],
  ['PatientBenefits', 'patientToken-scoped, not practiceId — same as BenefitCoverage'],
  ['ReconciliationLog', 'patientId/claimId-scoped, not practiceId — needs a join-based policy through insurance_claims, not yet designed'],
  ['InsurancePlan', 'patientId-scoped, not practiceId — same as ReconciliationLog'],
]);

function parseSchemaModels(schemaText) {
  const models = [];
  const modelBlockRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = modelBlockRe.exec(schemaText))) {
    const [, name, body] = m;
    const hasPracticeId = /^\s*practiceId\s+String/m.test(body);
    const hasOrganizationId = /^\s*organizationId\s+String/m.test(body);
    if (!hasPracticeId && !hasOrganizationId) continue;
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    const tableName = mapMatch ? mapMatch[1] : name;
    models.push({ name, tableName, hasPracticeId, hasOrganizationId });
  }
  return models;
}

async function main() {
  const schemaText = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const models = parseSchemaModels(schemaText);
  const toCheck = models.filter((m) => !ALLOWLIST.has(m.name));

  if (!process.env.DATABASE_URL) {
    console.error('check-rls-coverage: DATABASE_URL is not set — cannot verify live RLS state.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const failures = [];
  try {
    for (const model of toCheck) {
      const { rows } = await client.query(
        `SELECT c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind = 'r'`,
        [model.tableName],
      );
      if (rows.length === 0) {
        failures.push(`${model.name} (table "${model.tableName}"): table not found in the database — schema/migration drift?`);
        continue;
      }
      const { relforcerowsecurity, policy_count } = rows[0];
      if (!relforcerowsecurity || Number(policy_count) === 0) {
        failures.push(
          `${model.name} (table "${model.tableName}"): FORCE ROW LEVEL SECURITY=${relforcerowsecurity}, policies=${policy_count} — needs both.`,
        );
      }
    }
  } finally {
    await client.end();
  }

  if (failures.length > 0) {
    console.error(`check-rls-coverage: ${failures.length} tenant table(s) missing RLS coverage:\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      '\nEither add FORCE ROW LEVEL SECURITY + a policy (mirroring prisma/migrations/20260926200000_multi_practice_rls_coverage), or add the table to ALLOWLIST in this script with a real, documented reason.',
    );
    process.exit(1);
  }

  console.log(`check-rls-coverage: ${toCheck.length} tenant table(s) checked, all covered. ${ALLOWLIST.size} allowlisted.`);
}

main().catch((err) => {
  console.error('check-rls-coverage: unexpected error', err);
  process.exit(1);
});
