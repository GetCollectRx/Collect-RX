/**
 * CollectRx Queue Engine
 *
 * Decides WHICH claims get called, in WHAT ORDER, and WHEN.
 * Produces a prioritized call queue based on:
 *   - Days outstanding (older = higher priority)
 *   - Claim value (higher $ = higher priority)
 *   - Previous attempt history (avoid wasting calls)
 *   - Carrier-specific cooldown windows
 *   - Escalation and pause states
 */

const { query } = require("../db.cjs");
const logger = require("../logger");

// ─── Priority Scoring ────────────────────────────────────────────────────────
// Returns a numeric score — higher score = call first.
// Tweak these weights as you learn what works.

const BUCKET_WEIGHTS = {
  "120+":  50,
  "90-119": 35,
  "60-89":  20,
  "30-59":  10,
  "0-29":    0,
};

// Minimum days before we ever attempt a call on a claim
const MIN_DAYS_OUTSTANDING = parseInt(process.env.QUEUE_MIN_DAYS_OUTSTANDING) || 14;

// Minimum claim value to bother calling about
const MIN_CLAIM_VALUE = parseInt(process.env.QUEUE_MIN_CLAIM_VALUE) || 100;

// After this many failed/no-resolution attempts, stop calling and escalate to human
const MAX_ATTEMPTS = parseInt(process.env.QUEUE_MAX_ATTEMPTS_BEFORE_REVIEW) || 3;

// Max calls to dispatch in a single queue run (cost control)
const MAX_CALLS_PER_RUN = parseInt(process.env.QUEUE_MAX_CALLS_PER_RUN) || 20;

// Minimum hours between calls to the SAME CARRIER (avoid hammering)
const CARRIER_COOLDOWN_HOURS = 4;

function scoreClaim(claim) {
  let score = 0;

  // Aging bucket weight
  score += BUCKET_WEIGHTS[claim.aging_bucket] || 0;

  // Value score: $0–500 = 0pts, $500–1000 = 10pts, $1000–2000 = 20pts, $2000+ = 30pts
  const amt = parseFloat(claim.amount_outstanding);
  if (amt >= 2000) score += 30;
  else if (amt >= 1000) score += 20;
  else if (amt >= 500) score += 10;

  // Penalise claims that have already been attempted (each attempt reduces priority)
  // so fresh uncontacted claims get called before repeated failures
  score -= (claim.call_attempts || 0) * 5;

  // Boost claims that have NEVER been called at all
  if (!claim.last_called_at) score += 15;

  return Math.max(score, 0);
}

// ─── Carrier Cooldown Check ───────────────────────────────────────────────────
// Returns true if we're allowed to call this carrier right now.
async function isCarrierAvailable(carrierCode, alreadyQueuedCarriers) {
  // Don't queue more than 3 calls to the same carrier in one run
  // (avoids IVR rate-limiting or flagging)
  const countInRun = alreadyQueuedCarriers.filter(c => c === carrierCode).length;
  if (countInRun >= 3) return false;

  // Check last call to this carrier across ALL claims
  const result = await query(
    `SELECT MAX(started_at) as last_call
     FROM call_attempts
     WHERE carrier_code = $1
       AND status IN ('completed', 'connected')`,
    [carrierCode]
  );

  const lastCall = result.rows[0]?.last_call;
  if (!lastCall) return true;

  const hoursSinceLast = (Date.now() - new Date(lastCall).getTime()) / 1000 / 3600;
  return hoursSinceLast >= CARRIER_COOLDOWN_HOURS;
}

// ─── Build Queue ──────────────────────────────────────────────────────────────
// Returns an ordered array of claims ready to be dispatched to Vapi.

async function buildQueue() {
  logger.info("Building call queue...");

  // Fetch all eligible claims from DB
  const result = await query(
    `SELECT *
     FROM claims
     WHERE queue_status IN ('queued', 'in_progress')
       AND days_outstanding >= $1
       AND amount_outstanding >= $2
       AND call_attempts < $3
       AND escalation_flag IS DISTINCT FROM 'xray_required'
       AND (next_call_at IS NULL OR next_call_at <= NOW())
     ORDER BY days_outstanding DESC, amount_outstanding DESC`,
    [MIN_DAYS_OUTSTANDING, MIN_CLAIM_VALUE, MAX_ATTEMPTS]
  );

  const candidates = result.rows;
  logger.info(`Found ${candidates.length} candidate claims`);

  // Score each claim
  const scored = candidates.map(claim => ({
    ...claim,
    priority_score: scoreClaim(claim),
  })).sort((a, b) => b.priority_score - a.priority_score);

  // Apply carrier cooldown and per-run carrier cap
  const queue = [];
  const carriersInRun = [];

  for (const claim of scored) {
    if (queue.length >= MAX_CALLS_PER_RUN) break;

    const available = await isCarrierAvailable(claim.carrier_code, carriersInRun);
    if (!available) {
      logger.debug(`Carrier ${claim.carrier_code} cooling down, skipping ${claim.id}`);
      continue;
    }

    queue.push(claim);
    carriersInRun.push(claim.carrier_code);
  }

  logger.info(`Queue built: ${queue.length} calls scheduled`);

  // Persist priority scores back to DB
  for (const claim of queue) {
    await query(
      `UPDATE claims SET priority_score = $1, updated_at = NOW() WHERE id = $2`,
      [claim.priority_score, claim.id]
    );
  }

  return queue;
}

// ─── Mark Claim In Progress ───────────────────────────────────────────────────
async function markInProgress(claimId) {
  await query(
    `UPDATE claims
     SET queue_status = 'in_progress', updated_at = NOW()
     WHERE id = $1`,
    [claimId]
  );
}

// ─── Schedule Next Attempt ────────────────────────────────────────────────────
// After a call ends without resolution, schedule the next retry.
async function scheduleNextAttempt(claimId, hoursUntilRetry = 24) {
  const nextCall = new Date(Date.now() + hoursUntilRetry * 3600 * 1000);
  await query(
    `UPDATE claims
     SET queue_status = 'queued',
         next_call_at = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [nextCall, claimId]
  );
  logger.info(`Claim ${claimId} scheduled for retry at ${nextCall.toISOString()}`);
}

// ─── Pause Claim ─────────────────────────────────────────────────────────────
// Used when we're waiting on the clinic (e.g. after x-ray escalation).
// The claim won't be queued again until manually unpaused.
async function pauseClaim(claimId, reason) {
  await query(
    `UPDATE claims
     SET queue_status = 'paused',
         notes = COALESCE(notes, '') || $1,
         updated_at = NOW()
     WHERE id = $2`,
    [`\n[PAUSED: ${reason} at ${new Date().toISOString()}]`, claimId]
  );
  logger.info(`Claim ${claimId} paused: ${reason}`);
}

// ─── Get Queue Status ─────────────────────────────────────────────────────────
async function getQueueStats() {
  const result = await query(
    `SELECT
       queue_status,
       COUNT(*) as count,
       SUM(amount_outstanding) as total_outstanding
     FROM claims
     GROUP BY queue_status
     ORDER BY queue_status`
  );
  return result.rows;
}

module.exports = {
  buildQueue,
  markInProgress,
  scheduleNextAttempt,
  pauseClaim,
  getQueueStats,
  scoreClaim,
};
