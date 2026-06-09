// ─────────────────────────────────────────────────────────────────────────────
// meteringService — reports billable usage to Stripe.
//
// Source: collectrx-tiering-strategy.md §4.2 ("hybrid platform fee + success
// component") and §7 P2 ("Per-resolved-claim metering + overage billing —
// Stripe webhook route already exists — extend it").
//
// Called by usageService.recordOutcome after a value-bearing event lands.
//
// Stripe API: this uses the v2 Meter API (billing.meterEvents.create), which
// is the modern way to record usage on a metered price. Falls back to the
// legacy subscriptionItems.createUsageRecord when the plan row carries a
// stripe_subscription_item_id instead of a meter event name.
//
// PILOT-SAFE NO-OP: this module never throws and never blocks the caller.
//
// Overage unit price is defined in tierFeatures (PRO_OVERAGE_CENTS_PER_CLAIM env,
// default $22/claim). Your Stripe metered price MUST match that rate.
// ─────────────────────────────────────────────────────────────────────────────

let _stripe = null;
function stripe() {
  if (_stripe !== null) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) { _stripe = false; return _stripe; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stripe = require('stripe');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  } catch (_) {
    _stripe = false;
  }
  return _stripe;
}

let _logger = null;
function logger() {
  if (_logger) return _logger;
  try { _logger = require('../../logger'); }
  catch (_) { _logger = { info() {}, warn() {}, error() {}, debug() {} }; }
  return _logger;
}

let _db = null;
function db() {
  if (_db) return _db;
  _db = require('../../db.cjs');
  return _db;
}

/**
 * Report a billable usage event to Stripe. The shape varies by what's
 * configured on the plan row:
 *
 *   plan.stripe_meter_event_name  → uses v2 Meter API (preferred)
 *   plan.stripe_subscription_item_id → uses legacy createUsageRecord
 *   (neither set) → no-op (pilot mode)
 *
 * @param {Object} opts
 * @param {string} opts.practiceId
 * @param {string} opts.stripeCustomerId  pulled from Practice
 * @param {string} opts.eventType         'resolved_claim' | 'resolved_status_call'
 * @param {number} opts.quantity          1 per event (count) or cents for $-based meters
 * @param {string} opts.idempotencyKey    typically the vapi_call_id (no double-bills)
 * @returns {Promise<{ reported: boolean, reason?: string, mode?: string }>}
 */
async function reportUsage({ practiceId, stripeCustomerId, eventType, quantity, idempotencyKey }) {
  const s = stripe();
  if (!s) return { reported: false, reason: 'stripe_not_configured' };

  // Pull metering identifiers from the plan row.
  const planRes = await db().query(
    `SELECT stripe_meter_event_name, stripe_subscription_item_id
       FROM plans
      WHERE practice_id = $1`,
    [practiceId]
  );
  const row = planRes.rows[0];
  if (!row) return { reported: false, reason: 'plan_not_found' };

  const meterEventName = row.stripe_meter_event_name;
  const subscriptionItemId = row.stripe_subscription_item_id;

  try {
    if (meterEventName) {
      // v2 Meter API. The event payload's `value` is what the meter aggregates.
      await s.billing.meterEvents.create(
        {
          event_name: meterEventName,
          payload: {
            value: String(Math.max(1, Math.floor(quantity))),
            stripe_customer_id: stripeCustomerId,
            // Useful for reconciliation in Stripe's event log.
            collectrx_event_type: eventType,
            collectrx_practice_id: practiceId,
          },
        },
        idempotencyKey ? { idempotencyKey } : undefined
      );
      logger().info('metering: reported via v2 Meter', { practiceId, eventType, quantity });
      return { reported: true, mode: 'meter' };
    }

    if (subscriptionItemId) {
      // Legacy metered-price API.
      await s.subscriptionItems.createUsageRecord(
        subscriptionItemId,
        {
          quantity: Math.max(1, Math.floor(quantity)),
          action: 'increment',
          timestamp: Math.floor(Date.now() / 1000),
        },
        idempotencyKey ? { idempotencyKey } : undefined
      );
      logger().info('metering: reported via legacy usage record', {
        practiceId,
        eventType,
        quantity,
      });
      return { reported: true, mode: 'usage_record' };
    }

    return { reported: false, reason: 'no_metering_id' };
  } catch (err) {
    // Never throw — Stripe outages must not break the webhook ack.
    logger().error('metering: Stripe call failed (non-fatal)', {
      error: err.message,
      practiceId,
      eventType,
    });
    return { reported: false, reason: 'stripe_error' };
  }
}

module.exports = {
  reportUsage,
};
