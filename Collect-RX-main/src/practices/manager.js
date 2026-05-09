/**
 * CollectRx — Practices Manager
 *
 * CRUD for dental practice records.
 * Replaces the env-var-based single-practice config with a proper multi-tenant model.
 *
 * Each practice that subscribes to CollectRx gets a row in the `practices` table.
 * The queue engine and Vapi client load practice config from here instead of from .env.
 */

const { query } = require('../db.cjs');
const logger = require('../logger');

// ─── Create ───────────────────────────────────────────────────────────────────

async function createPractice(data) {
  const {
    name,
    abeldent_id,
    phone,
    fax,
    email,
    address,
    npi,
    tax_id,
    provider_id,
    cdcp_provider_number,
    escalation_webhook_url,
    escalation_email,
    min_claim_value,
    min_days_outstanding,
    max_call_attempts,
    max_calls_per_run,
  } = data;

  if (!name) throw new Error('Practice name is required');

  const result = await query(
    `INSERT INTO practices (
       name, abeldent_id, phone, fax, email, address,
       npi, tax_id, provider_id, cdcp_provider_number,
       escalation_webhook_url, escalation_email,
       min_claim_value, min_days_outstanding, max_call_attempts, max_calls_per_run
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      name,
      abeldent_id || null,
      phone || null,
      fax || null,
      email || null,
      address || null,
      npi || null,
      tax_id || null,
      provider_id || null,
      cdcp_provider_number || null,
      escalation_webhook_url || null,
      escalation_email || null,
      min_claim_value || 100.00,
      min_days_outstanding || 14,
      max_call_attempts || 3,
      max_calls_per_run || 20,
    ]
  );

  logger.info(`Practice created: ${result.rows[0].id} — ${name}`);
  return result.rows[0];
}

// ─── Read ─────────────────────────────────────────────────────────────────────

async function getPractice(id) {
  const result = await query(`SELECT * FROM practices WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function listPractices(includeInactive = false) {
  const where = includeInactive ? '' : `WHERE status = 'active'`;
  const result = await query(
    `SELECT * FROM practices ${where} ORDER BY name ASC`
  );
  return result.rows;
}

// ─── Update ───────────────────────────────────────────────────────────────────

async function updatePractice(id, data) {
  const allowed = [
    'name', 'abeldent_id', 'phone', 'fax', 'email', 'address',
    'npi', 'tax_id', 'provider_id', 'cdcp_provider_number',
    'escalation_webhook_url', 'escalation_email',
    'min_claim_value', 'min_days_outstanding', 'max_call_attempts',
    'max_calls_per_run', 'status',
  ];

  const fields = Object.keys(data).filter(k => allowed.includes(k));
  if (fields.length === 0) throw new Error('No valid fields to update');

  const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map(f => data[f]);

  const result = await query(
    `UPDATE practices SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...values]
  );

  if (result.rowCount === 0) throw new Error(`Practice ${id} not found`);
  logger.info(`Practice updated: ${id}`);
  return result.rows[0];
}

// ─── Deactivate (soft delete) ─────────────────────────────────────────────────

async function deactivatePractice(id) {
  const result = await query(
    `UPDATE practices SET status = 'inactive', updated_at = NOW() WHERE id = $1 RETURNING id, name`,
    [id]
  );
  if (result.rowCount === 0) throw new Error(`Practice ${id} not found`);
  logger.info(`Practice deactivated: ${id}`);
  return result.rows[0];
}

// ─── Get practice config (shaped for Vapi client) ────────────────────────────
// Returns the same shape that routes.js used to build from process.env.
// This lets the Vapi client stay unchanged — just swap the source.

async function getPracticeConfig(practiceId) {
  let practice = null;

  if (practiceId) {
    practice = await getPractice(practiceId);
    if (!practice) throw new Error(`Practice ${practiceId} not found`);
  }

  // Fallback to env vars for backward compatibility with single-practice mode
  return {
    practice_id:              practice?.id || null,
    practice_name:            practice?.name            || process.env.PRACTICE_NAME        || 'the dental practice',
    practice_phone:           practice?.phone           || process.env.PRACTICE_PHONE       || '',
    practice_npi:             practice?.npi             || process.env.PRACTICE_NPI         || '',
    practice_tax_id:          practice?.tax_id          || process.env.PRACTICE_TAX_ID      || '',
    practice_address:         practice?.address         || process.env.PRACTICE_ADDRESS     || '',
    provider_id:              practice?.provider_id     || process.env.PRACTICE_PROVIDER_ID || '',
    cdcp_provider_number:     practice?.cdcp_provider_number || process.env.PRACTICE_CDCP_PROVIDER_NUMBER || '',
    escalation_webhook_url:   practice?.escalation_webhook_url || process.env.ESCALATION_WEBHOOK_URL || null,
    // Queue overrides (per-practice settings take priority over env defaults)
    min_claim_value:          practice?.min_claim_value    ?? parseFloat(process.env.QUEUE_MIN_CLAIM_VALUE || '100'),
    min_days_outstanding:     practice?.min_days_outstanding ?? parseInt(process.env.QUEUE_MIN_DAYS_OUTSTANDING || '14'),
    max_call_attempts:        practice?.max_call_attempts   ?? parseInt(process.env.QUEUE_MAX_ATTEMPTS_BEFORE_REVIEW || '3'),
    max_calls_per_run:        practice?.max_calls_per_run   ?? parseInt(process.env.QUEUE_MAX_CALLS_PER_RUN || '20'),
  };
}

// ─── Practice stats ───────────────────────────────────────────────────────────

async function getPracticeStats(practiceId) {
  const result = await query(
    `SELECT
       queue_status,
       COUNT(*) as count,
       SUM(amount_outstanding) as total_outstanding
     FROM claims
     WHERE practice_id = $1
     GROUP BY queue_status
     ORDER BY queue_status`,
    [practiceId]
  );
  return result.rows;
}

module.exports = {
  createPractice,
  getPractice,
  listPractices,
  updatePractice,
  deactivatePractice,
  getPracticeConfig,
  getPracticeStats,
};
