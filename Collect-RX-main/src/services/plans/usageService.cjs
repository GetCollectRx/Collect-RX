// ─────────────────────────────────────────────────────────────────────────────
// usageService — increments Plan counters on each terminal call outcome and
// writes one UsageEvent row per call (idempotent on vapi_call_id).
//
// Source: collectrx-tiering-strategy.md §7 P0.
//
// Called by:
//   src/outcome/processor.legacy.cjs after processOutcome() returns.
//   New TS outcome flow can call recordOutcome() directly too.
//
// Mapping (legacy outcome codes → usage event types):
//
//   paid             → resolved_claim (+ recovered_dollars w/ amount)
//   not_covered      → resolved_claim  (AR closed — bill patient)
//   coverage_maxed   → resolved_claim  (AR closed — bill patient)
//   resubmit_required→ resolved_claim  (AR path determined — resubmit)
//   processing       → (none — claim still open at carrier)
//   xray_required    → (none — escalated; the doc says Basic surfaces these in the "$ we couldn't negotiate" tally)
//   docs_required    → (none — escalated)
//   appeal_required  → (none — escalated)
//   no_answer        → (none — not value-bearing)
//   call_failed      → (none)
//   carrier_block    → (none)
//   unknown          → (none — escalated)
//
// Idempotency: vapi_call_id is UNIQUE on usage_events. A redelivered webhook
// is a no-op (returns { recorded: false, reason: 'duplicate' }).
// ─────────────────────────────────────────────────────────────────────────────

// db and logger are lazily required so the pure classifier (classifyForUsage)
// is importable in unit tests without triggering the project's eager
// db.cjs → logger.js chain (logger.js is parsed as ESM under vitest because
// the workspace package.json sets "type": "module").
let _db = null;
function db() {
  if (_db) return _db;
  _db = require('../../db.cjs');
  return _db;
}
let _logger = null;
function logger() {
  if (_logger) return _logger;
  try { _logger = require('../../logger'); }
  catch (_) { _logger = { info() {}, warn() {}, error() {}, debug() {} }; }
  return _logger;
}

/**
 * Outcome codes that count as one AR claim resolved (toward plan limit + overage).
 * "Processing" is intentionally excluded — the claim is still open.
 */
const RESOLVED_CLAIM_OUTCOMES = new Set([
  'paid',
  'not_covered',
  'coverage_maxed',
  'resubmit_required',
]);

/**
 * Classify a legacy outcome code into the usage event type we'll record (if any).
 * Returns `null` when the outcome is not value-bearing.
 */
function classifyForUsage(outcomeCode) {
  if (RESOLVED_CLAIM_OUTCOMES.has(outcomeCode)) return 'resolved_claim';
  return null;
}

/**
 * Record a terminal outcome. Increments plan counters atomically with the
 * usage_events insert; trial threshold is checked off the new counter so a
 * single recovered claim can flip the trial state without a second roundtrip.
 *
 * @param {Object} opts
 * @param {string} opts.practiceId
 * @param {string} opts.claimId
 * @param {string} opts.vapiCallId
 * @param {string} opts.outcomeCode  legacy outcome string (e.g. "paid")
 * @param {number} [opts.amountCents] cents recovered when known (paid only)
 * @returns {Promise<{ recorded: boolean, eventType?: string, reason?: string }>}
 */
async function recordOutcome({ practiceId, claimId, vapiCallId, outcomeCode, amountCents }) {
  if (!practiceId) {
    return { recorded: false, reason: 'missing_practice_id' };
  }

  const eventType = classifyForUsage(outcomeCode);
  if (!eventType) {
    return { recorded: false, reason: 'not_value_bearing' };
  }

  // For non-paid outcomes, amount is 0. For paid, default to 0 if caller didn't
  // resolve a dollar value — usage is still counted (resolved_claim) but
  // trial-progress only ticks via recovered_dollars amount > 0.
  const amount = Math.max(0, Math.floor(Number(amountCents || 0)));

  const client = await db().pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotent insert keyed on vapi_call_id.
    const insertRes = await client.query(
      `INSERT INTO usage_events
         (practice_id, claim_id, vapi_call_id, event_type, amount_cents, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (vapi_call_id) DO NOTHING
       RETURNING id`,
      [
        practiceId,
        claimId || null,
        vapiCallId || null,
        eventType,
        amount,
        JSON.stringify({ outcomeCode }),
      ]
    );

    if (insertRes.rowCount === 0) {
      await client.query('ROLLBACK');
      logger().debug('usageService: duplicate event, skipping increment', { vapiCallId });
      return { recorded: false, reason: 'duplicate' };
    }

    // Increment the right counters on the plan row. Trial progress is
    // tracked separately because it caps the gate.
    if (eventType === 'resolved_claim') {
      await client.query(
        `UPDATE plans
           SET resolved_claims_used = resolved_claims_used + 1,
               recovered_cents_total = recovered_cents_total + $2,
               trial_recovered_cents = CASE WHEN status = 'trial'
                                            THEN trial_recovered_cents + $2
                                            ELSE trial_recovered_cents END,
               updated_at = NOW()
         WHERE practice_id = $1`,
        [practiceId, amount]
      );
    }

    await client.query('COMMIT');

    // Stripe overage metering — only bill claims beyond the included pool.
    if (eventType === 'resolved_claim') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getFeatures: tierFeatures } = require('./tierFeatures.cjs');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { reportUsage } = require('./meteringService.cjs');
        const planRow = await db().query(
          `SELECT tier, resolved_claims_used FROM plans WHERE practice_id = $1`,
          [practiceId]
        );
        const tier = planRow.rows[0]?.tier;
        const used = planRow.rows[0]?.resolved_claims_used ?? 0;
        const features = tierFeatures(tier);
        const included = features.includedResolvedClaimsPerCycle;
        const inOverage =
          features.allowOverage &&
          included != null &&
          included > 0 &&
          used > included;
        if (inOverage) {
          const practiceRes = await db().query(
            `SELECT "stripeCustomerId" AS stripe_customer_id FROM "Practice" WHERE id = $1`,
            [practiceId]
          );
          const stripeCustomerId = practiceRes.rows[0]?.stripe_customer_id;
          if (stripeCustomerId) {
            await reportUsage({
              practiceId,
              stripeCustomerId,
              eventType,
              quantity: 1,
              idempotencyKey: vapiCallId,
            });
          }
        }
      } catch (_) {
        /* metering must never fail the caller */
      }
    }

    logger().info('usageService: recorded', {
      practiceId,
      eventType,
      outcomeCode,
      amount,
      vapiCallId,
    });

    return { recorded: true, eventType };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger().error('usageService: recordOutcome failed', { error: err.message, vapiCallId });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Look up the claim's outstanding amount as the recovered total when an
 * outcome of `paid` arrives without an explicit dollar figure. Falls back to 0.
 *
 * Returns cents (BigInt-safe via Number floor — claims fit comfortably in int).
 */
async function recoveredCentsForClaim(claimId) {
  if (!claimId) return 0;
  // Try the legacy `claims` table first (raw-SQL queue), then `insurance_claims`.
  try {
    const legacy = await db().query(
      `SELECT amount_outstanding FROM claims WHERE id = $1`,
      [claimId]
    );
    const amt = parseFloat(legacy.rows[0]?.amount_outstanding);
    if (Number.isFinite(amt)) return Math.round(amt * 100);
  } catch (_) {
    /* table may not exist in newer environments */
  }
  try {
    const modern = await db().query(
      `SELECT outstanding_amount FROM insurance_claims WHERE id = $1`,
      [claimId]
    );
    const amt = parseFloat(modern.rows[0]?.outstanding_amount);
    if (Number.isFinite(amt)) return Math.round(amt * 100);
  } catch (_) {}
  return 0;
}

/**
 * Reset cycle counters. Called by the billing layer at the start of each
 * billing period (P2 — Stripe invoice.paid webhook).
 */
async function startNewCycle(practiceId) {
  await db().query(
    `UPDATE plans
       SET cycle_started_at = NOW(),
           status_calls_used = 0,
           resolved_claims_used = 0,
           updated_at = NOW()
     WHERE practice_id = $1`,
    [practiceId]
  );
}

module.exports = {
  classifyForUsage,
  recordOutcome,
  recoveredCentsForClaim,
  startNewCycle,
};
