// ─────────────────────────────────────────────────────────────────────────────
// planService — the gate the queue dispatcher MUST consult before every call.
//
// Source: collectrx-tiering-strategy.md §7 P0. Without this, no monetization
// works: trials don't pause, paid limits aren't enforced, and there is no
// "upgrade prompt with context" the strategy is built around.
//
// Public API:
//   getOrCreatePlan(practiceId)        → row in `plans`, creating a trial if missing
//   canMakeCall(practiceId)            → { allowed, reason, plan }
//   getFeatures(practiceId)            → tierFeatures entry for current tier
//   getPlanSummary(practiceId)         → shape for GET /api/plan
//   setTier(practiceId, tier, status)  → manual upgrade (used by Stripe webhook + admin)
//
// `reason` codes (stable — UI keys off these):
//   OK
//   TRIAL_LIMIT_REACHED       — outcome-gated trial threshold hit (§3.1)
//   PLAN_LIMIT_REACHED        — paid included-pool exhausted, overage not configured
//   SUBSCRIPTION_PAST_DUE     — Stripe says past_due
//   SUBSCRIPTION_CANCELED     — Stripe says canceled
// ─────────────────────────────────────────────────────────────────────────────

const { getFeatures: featuresForTier, TIER_NAMES } = require('./tierFeatures.cjs');

// db + logger are lazily required so this module is importable in unit tests
// without triggering the project's eager db.cjs → logger.js load chain
// (logger.js fails to parse under vitest because the workspace package.json
// sets "type": "module").
let _query = null;
function query(text, params) {
  if (!_query) _query = require('../../db.cjs').query;
  return _query(text, params);
}
let _logger = null;
function logger() {
  if (_logger) return _logger;
  try { _logger = require('../../logger'); }
  catch (_) { _logger = { info() {}, warn() {}, error() {}, debug() {} }; }
  return _logger;
}

// Default trial threshold: $2,500 in recovered claims (strategy doc §3.1).
// Overridable per-deployment via TRIAL_THRESHOLD_CENTS (e.g. pilot tuning).
// Bounded to a sane range so a typo doesn't disable the trial gate.
const DEFAULT_TRIAL_THRESHOLD_CENTS = (() => {
  const raw = parseInt(process.env.TRIAL_THRESHOLD_CENTS || '', 10);
  if (Number.isFinite(raw) && raw >= 100_00 && raw <= 1_000_000_00) return raw;
  return 250_000;
})();

/**
 * Fetch the practice's Plan row. If none exists, create one in `trial` status
 * with the Professional feature set (the strategy says trials get full Pro).
 */
async function getOrCreatePlan(practiceId) {
  if (!practiceId) throw new Error('planService: practiceId is required');

  const existing = await query(
    `SELECT * FROM plans WHERE practice_id = $1`,
    [practiceId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await query(
    `INSERT INTO plans (
       practice_id, tier, status,
       trial_recovered_cents, trial_threshold_cents,
       cycle_started_at, created_at, updated_at
     ) VALUES ($1, 'professional', 'trial', 0, $2, NOW(), NOW(), NOW())
     ON CONFLICT (practice_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [practiceId, DEFAULT_TRIAL_THRESHOLD_CENTS]
  );
  logger().info('planService: created trial plan', { practiceId });
  return inserted.rows[0];
}

/**
 * The gate. Called by the queue dispatcher BEFORE every dispatch.
 * Returns `{ allowed, reason, plan }`.
 *
 * Important: this never throws on missing plan — it lazily creates one so the
 * existing queue keeps working the moment the migration is applied.
 */
async function canMakeCall(practiceId) {
  const plan = await getOrCreatePlan(practiceId);

  if (plan.status === 'canceled') {
    return { allowed: false, reason: 'SUBSCRIPTION_CANCELED', plan };
  }
  if (plan.status === 'past_due') {
    return { allowed: false, reason: 'SUBSCRIPTION_PAST_DUE', plan };
  }

  if (plan.status === 'trial') {
    const recovered = BigInt(plan.trial_recovered_cents);
    const threshold = BigInt(plan.trial_threshold_cents);
    if (recovered >= threshold) {
      return { allowed: false, reason: 'TRIAL_LIMIT_REACHED', plan };
    }
    return { allowed: true, reason: 'OK', plan };
  }

  // status === 'active' — check tier's included pool.
  //   • includedStatusCallsPerCycle === null → unlimited
  //   • exhausted + allowOverage=false → PLAN_LIMIT_REACHED (Basic by default)
  //   • exhausted + allowOverage=true  → OVERAGE (caller bills via Stripe meter)
  const features = featuresForTier(plan.tier);
  const statusPoolExhausted =
    features.includedStatusCallsPerCycle !== null &&
    plan.status_calls_used >= features.includedStatusCallsPerCycle;
  const claimPoolExhausted =
    features.includedResolvedClaimsPerCycle !== null &&
    features.includedResolvedClaimsPerCycle > 0 &&
    plan.resolved_claims_used >= features.includedResolvedClaimsPerCycle;

  if ((statusPoolExhausted || claimPoolExhausted) && !features.allowOverage) {
    return { allowed: false, reason: 'PLAN_LIMIT_REACHED', plan };
  }
  if (statusPoolExhausted || claimPoolExhausted) {
    return { allowed: true, reason: 'OVERAGE', plan };
  }

  return { allowed: true, reason: 'OK', plan };
}

function getFeatures(planOrTier) {
  const tier = typeof planOrTier === 'string' ? planOrTier : planOrTier.tier;
  return featuresForTier(tier);
}

/**
 * Read-model for the frontend (GET /api/plan). Numbers/dates only — no
 * BigInts in the JSON payload.
 */
async function getPlanSummary(practiceId) {
  const plan = await getOrCreatePlan(practiceId);
  const features = featuresForTier(plan.tier);
  const trialRecovered = Number(plan.trial_recovered_cents);
  const trialThreshold = Number(plan.trial_threshold_cents);
  return {
    practiceId,
    tier: plan.tier,
    status: plan.status,
    autonomy: features.autonomy,
    abeldentSync: features.abeldentSync,
    valueMetric: features.valueMetric,
    trial: {
      active: plan.status === 'trial',
      recoveredCents: trialRecovered,
      thresholdCents: trialThreshold,
      progress: trialThreshold > 0 ? Math.min(1, trialRecovered / trialThreshold) : 0,
      startedAt: plan.trial_started_at,
      convertedAt: plan.trial_converted_at,
    },
    cycle: {
      startedAt: plan.cycle_started_at,
      statusCallsUsed: plan.status_calls_used,
      statusCallsIncluded: features.includedStatusCallsPerCycle,
      resolvedClaimsUsed: plan.resolved_claims_used,
      resolvedClaimsIncluded: features.includedResolvedClaimsPerCycle,
    },
    lifetime: {
      recoveredCents: Number(plan.recovered_cents_total),
    },
    features,
  };
}

/**
 * Manual tier change. Called by:
 *   - the Stripe webhook on subscription activation
 *   - admin tooling (platform_admin) for backfills
 *
 * Pass `status: 'active'` to convert a trial. Trial conversion stamps
 * trial_converted_at and starts a fresh cycle.
 */
async function setTier(practiceId, tier, status = 'active') {
  if (!TIER_NAMES.includes(tier)) throw new Error(`Unknown tier: ${tier}`);
  const plan = await getOrCreatePlan(practiceId);
  const isTrialConversion = plan.status === 'trial' && status === 'active';

  const updated = await query(
    `UPDATE plans
       SET tier = $2,
           status = $3,
           trial_converted_at = COALESCE(trial_converted_at, $4),
           cycle_started_at = CASE WHEN $5 THEN NOW() ELSE cycle_started_at END,
           status_calls_used = CASE WHEN $5 THEN 0 ELSE status_calls_used END,
           resolved_claims_used = CASE WHEN $5 THEN 0 ELSE resolved_claims_used END,
           updated_at = NOW()
     WHERE practice_id = $1
     RETURNING *`,
    [practiceId, tier, status, isTrialConversion ? new Date() : null, isTrialConversion]
  );
  logger().info('planService: tier updated', { practiceId, tier, status, isTrialConversion });
  return updated.rows[0];
}

module.exports = {
  DEFAULT_TRIAL_THRESHOLD_CENTS,
  getOrCreatePlan,
  canMakeCall,
  getFeatures,
  getPlanSummary,
  setTier,
};
