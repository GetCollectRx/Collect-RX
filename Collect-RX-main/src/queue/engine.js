/**
 * CollectRx Queue Engine
 *
 * Decides WHICH claims get called, in WHAT ORDER, and WHEN.
 * Produces a prioritized call queue based on:
 * - Days outstanding (older = higher priority)
 * - Claim value (higher $ = higher priority)
 * - Previous attempt history (avoid wasting calls)
 * - Carrier-specific cooldown windows
 * - Escalation and pause states
 *
 * MULTI-TENANCY: buildQueue() operates per-practice. Each active practice is
 * scored against its OWN thresholds (from practices/manager.js getPracticeConfig)
 * and has its OWN carrier-cooldown window, so one practice's calling activity
 * never affects another practice's queue or carrier availability. Claims with
 * no practice_id (legacy / pre-migration data) are still handled as their own
 * pool using the env-var defaults, so nothing existing breaks.
 */

const { query } = require("../db.cjs");
const logger = require("../logger");
const { listPractices, getPracticeConfig } = require("../practices/manager");

// ─── Priority Scoring ────────────────────────────────────────────────────────
// Returns a numeric score — higher score = call first.
// Tweak these weights as you learn what works.

const BUCKET_WEIGHTS = {
  "120+": 50,
  "90-119": 35,
  "60-89": 20,
  "30-59": 10,
  "0-29": 0,
};

// Fallback thresholds — only used for practices with no override in the
// practices table, and for the legacy no-practice_id pool.
const DEFAULT_MIN_DAYS_OUTSTANDING = parseInt(process.env.QUEUE_MIN_DAYS_OUTSTANDING) || 14;
const DEFAULT_MIN_CLAIM_VALUE = parseInt(process.env.QUEUE_MIN_CLAIM_VALUE) || 100;
const DEFAULT_MAX_ATTEMPTS = parseInt(process.env.QUEUE_MAX_ATTEMPTS_BEFORE_REVIEW) || 3;
const DEFAULT_MAX_CALLS_PER_RUN = parseInt(process.env.QUEUE_MAX_CALLS_PER_RUN) || 20;

// Minimum hours between calls to the SAME CARRIER, scoped per-practice (see
// isCarrierAvailable below) — practice A calling a carrier never blocks
// practice B from calling that same carrier.
const CARRIER_COOLDOWN_HOURS = parseInt(process.env.QUEUE_CARRIER_COOLDOWN_HOURS) || 4;

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
// Returns true if we're allowed to call this carrier right now, scoped to a
// single practice. Joins through claims (rather than requiring a practice_id
// column on call_attempts) so no schema migration is needed.
async function isCarrierAvailable(carrierCode, alreadyQueuedCarriers, practiceId) {
  // Don't queue more than 3 calls to the same carrier in one run
  // (avoids IVR rate-limiting or flagging)
  const countInRun = alreadyQueuedCarriers.filter(c => c === carrierCode).length;
  if (countInRun >= 3) return false;

  // Check last call to this carrier for THIS PRACTICE ONLY (practiceId may be
  // null for the legacy no-practice pool, in which case we scope to other
  // claims that also have no practice_id).
  const result = await query(
    `SELECT MAX(ca.started_at) as last_call
     FROM call_attempts ca
     JOIN claims c ON c.id = ca.claim_id
     WHERE ca.carrier_code = $1
       AND ca.status IN ('completed', 'connected')
       AND ( ($2::int IS NULL AND c.practice_id IS NULL) OR c.practice_id = $2 )`,
    [carrierCode, practiceId]
  );

  const lastCall = result.rows[0]?.last_call;
  if (!lastCall) return true;

  const hoursSinceLast = (Date.now() - new Date(lastCall).getTime()) / 1000 / 3600;
  return hoursSinceLast >= CARRIER_COOLDOWN_HOURS;
}

// ─── Build Queue For One Practice ─────────────────────────────────────────────
// practiceId may be null, which selects the legacy pool of claims with no
// practice_id assigned at all (pre-migration data / env-var-only mode).
async function buildQueueForPractice(practiceId, config) {
  const minDays = config?.min_days_outstanding ?? DEFAULT_MIN_DAYS_OUTSTANDING;
  const minValue = config?.min_claim_value ?? DEFAULT_MIN_CLAIM_VALUE;
  const maxAttempts = config?.max_call_attempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxPerRun = config?.max_calls_per_run ?? DEFAULT_MAX_CALLS_PER_RUN;

  const result = await query(
    `SELECT * FROM claims
     WHERE queue_status IN ('queued', 'in_progress')
       AND days_outstanding >= $1
       AND amount_outstanding >= $2
       AND call_attempts < $3
       AND escalation_flag IS DISTINCT FROM 'xray_required'
       AND (next_call_at IS NULL OR next_call_at <= NOW())
       AND ( ($4::int IS NULL AND practice_id IS NULL) OR practice_id = $4 )
     ORDER BY days_outstanding DESC, amount_outstanding DESC`,
    [minDays, minValue, maxAttempts, practiceId]
  );

  const candidates = result.rows;
  logger.info(`Found ${candidates.length} candidate claims`, { practiceId });

  // Score each claim
  const scored = candidates.map(claim => ({
    ...claim,
    priority_score: scoreClaim(claim),
  })).sort((a, b) => b.priority_score - a.priority_score);

  // Apply carrier cooldown and per-run carrier cap
  const queue = [];
  const carriersInRun = [];

  for (const claim of scored) {
    if (queue.length >= maxPerRun) break;

    const available = await isCarrierAvailable(claim.carrier_code, carriersInRun, practiceId);
    if (!available) {
      logger.debug(`Carrier ${claim.carrier_code} cooling down for practice, skipping ${claim.id}`, { practiceId });
      continue;
    }

    queue.push(claim);
    carriersInRun.push(claim.carrier_code);
  }

  logger.info(`Queue built for practice: ${queue.length} calls scheduled`, { practiceId });

  // Persist priority scores back to DB
  for (const claim of queue) {
    await query(
      `UPDATE claims SET priority_score = $1, updated_at = NOW() WHERE id = $2`,
      [claim.priority_score, claim.id]
    );
  }

  return queue;
}

// ─── Build Queue ──────────────────────────────────────────────────────────────
// Returns an ordered array of claims ready to be dispatched to Vapi.
//
// - buildQueue(practiceId) — builds the queue for a single practice only.
//   Used for a manual, one-off single-practice run.
// - buildQueue() — loops every active practice (each scored against its own
//   thresholds and its own carrier cooldown), plus the legacy pool of claims
//   with no practice_id at all, then returns the merged result. This is the
//   normal path once more than one practice is onboarded.
async function buildQueue(practiceId = null) {
  if (practiceId) {
    logger.info("Building call queue for a single practice", { practiceId });
    const config = await getPracticeConfig(practiceId);
    return buildQueueForPractice(practiceId, config);
  }

  logger.info("Building call queue across all active practices...");
  const practices = await listPractices();

  let queue = [];
  for (const practice of practices) {
    const config = await getPracticeConfig(practice.id);
    const practiceQueue = await buildQueueForPractice(practice.id, config);
    queue = queue.concat(practiceQueue);
  }

  // Legacy pool: claims with no practice_id (pre-migration data / env-var-only mode)
  const legacyConfig = await getPracticeConfig(null);
  const legacyQueue = await buildQueueForPractice(null, legacyConfig);
  queue = queue.concat(legacyQueue);

  logger.info(`Queue built across ${practices.length} practice(s) + legacy pool: ${queue.length} total calls scheduled`);
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
// Optional practiceId to scope the breakdown to a single practice; omit for
// the platform-wide breakdown (existing default behavior, unchanged).
async function getQueueStats(practiceId = null) {
  const where = practiceId ? `WHERE practice_id = $1` : "";
  const params = practiceId ? [practiceId] : [];
  const result = await query(
    `SELECT
      queue_status,
      COUNT(*) as count,
      SUM(amount_outstanding) as total_outstanding
     FROM claims
     ${where}
     GROUP BY queue_status
     ORDER BY queue_status`,
    params
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
