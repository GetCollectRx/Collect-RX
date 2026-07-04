/**
 * One-off migration script: create a real `practices` row for Tenth Line
 * Family Dentistry, sourced from the existing PRACTICE_* env vars, so
 * production runs through the multi-tenant path instead of the env-var
 * fallback.
 *
 * WHY THIS EXISTS: as of this PR, the `practices` table has zero rows —
 * Tenth Line's config has only ever lived in environment variables. This
 * script reads those same env vars (server-side, at runtime) and inserts
 * them as a real practice row. It never touches or displays secret values
 * itself; it just copies whatever is already configured on the running
 * server into the database.
 *
 * USAGE (run once, on the Fly machine, after this PR is deployed):
 *   node scripts/seed-tenth-line.js
 *
 * To ALSO reassign any existing claims that have no practice_id (i.e. claims
 * imported before multi-tenancy existed) to this new practice, pass:
 *   node scripts/seed-tenth-line.js --assign-legacy-claims
 *
 * Safe to re-run: if a practice with this name already exists, the script
 * exits without creating a duplicate.
 */

const { query } = require("../src/db.cjs");
const { createPractice, listPractices } = require("../src/practices/manager");

const PRACTICE_NAME = process.env.PRACTICE_NAME || "Tenth Line Family Dentistry";

async function main() {
  const assignLegacyClaims = process.argv.includes("--assign-legacy-claims");

  const existing = await listPractices(true); // includeInactive, so we don't duplicate a deactivated one either
  const already = existing.find(p => p.name === PRACTICE_NAME);
  if (already) {
    console.log(`Practice "${PRACTICE_NAME}" already exists as id=${already.id}. Nothing to do.`);
    process.exit(0);
  }

  const practice = await createPractice({
    name: PRACTICE_NAME,
    phone: process.env.PRACTICE_PHONE || null,
    email: process.env.PRACTICE_EMAIL || null,
    address: process.env.PRACTICE_ADDRESS || null,
    npi: process.env.PRACTICE_NPI || null,
    tax_id: process.env.PRACTICE_TAX_ID || null,
    provider_id: process.env.PRACTICE_PROVIDER_ID || null,
    cdcp_provider_number: process.env.PRACTICE_CDCP_PROVIDER_NUMBER || null,
    escalation_webhook_url: process.env.ESCALATION_WEBHOOK_URL || null,
    min_claim_value: process.env.QUEUE_MIN_CLAIM_VALUE ? parseFloat(process.env.QUEUE_MIN_CLAIM_VALUE) : undefined,
    min_days_outstanding: process.env.QUEUE_MIN_DAYS_OUTSTANDING ? parseInt(process.env.QUEUE_MIN_DAYS_OUTSTANDING, 10) : undefined,
    max_call_attempts: process.env.QUEUE_MAX_ATTEMPTS_BEFORE_REVIEW ? parseInt(process.env.QUEUE_MAX_ATTEMPTS_BEFORE_REVIEW, 10) : undefined,
    max_calls_per_run: process.env.QUEUE_MAX_CALLS_PER_RUN ? parseInt(process.env.QUEUE_MAX_CALLS_PER_RUN, 10) : undefined,
  });

  console.log(`Created practice "${practice.name}" as id=${practice.id}.`);

  if (assignLegacyClaims) {
    const result = await query(
      `UPDATE claims SET practice_id = $1, updated_at = NOW() WHERE practice_id IS NULL RETURNING id`,
      [practice.id]
    );
    console.log(`Reassigned ${result.rowCount} legacy claim(s) with no practice_id to practice ${practice.id}.`);
  } else {
    console.log(
      "Legacy claims with no practice_id were left untouched. " +
      "Re-run with --assign-legacy-claims if you want them reassigned to this practice."
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed script failed:", err.message);
  process.exit(1);
});
