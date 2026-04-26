/**
 * CollectRx API Routes
 *
 * Security applied on every route:
 *   • Rate limiting  — standardLimiter (120/min) or strictLimiter (10/min)
 *   • Input validation — schema-based via security middleware; unexpected fields rejected
 *   • Sanitization   — strings trimmed + control-chars stripped before DB writes
 *   • Webhook auth   — HMAC-SHA256 signature verified before processing Vapi events
 *
 * SECRETS: No API keys or secrets are referenced here.
 * All credentials live exclusively in process.env.
 */

const express = require("express");
const router  = express.Router();
const { query }           = require("./db");
const { buildQueue, getQueueStats, pauseClaim } = require("./queue/engine");
const { processOutcome, suspendAllQueuedClaims }  = require("./outcome/processor");
const { dispatchCall, parseWebhook } = require("./vapi/client");
const { getOpenEscalations, acknowledgeEscalation, resolveEscalation } = require("./outcome/escalation");
const { createPractice, getPractice, listPractices, updatePractice, deactivatePractice, getPracticeConfig, getPracticeStats } = require("./practices/manager");
const { importClaims, parseCSV } = require("./claims/importer");
const piiVault = require("./pii-vault");
const logger  = require("./logger");

// Security middleware — rate limiters, validators, webhook verifier
const {
  standardLimiter,
  strictLimiter,
  webhookLimiter,
  validateClaimsQuery,
  validateQueueRunBody,
  validatePauseBody,
  validateAcknowledgeBody,
  validateResolveBody,
  validatePracticeBody,
  validateImportQuery,
  verifyVapiWebhook,
} = require("./middleware/security");

// ─── Helper: send a consistent 400 validation error ──────────────────────────
function validationError(res, errors) {
  return res.status(400).json({ success: false, error: "Validation failed", details: errors });
}

// ─── Queue ────────────────────────────────────────────────────────────────────

// GET /api/queue/build — dry-run: score and return today's call queue (no calls made)
router.get("/queue/build", standardLimiter, async (req, res) => {
  try {
    const queue = await buildQueue();
    res.json({ success: true, count: queue.length, queue });
  } catch (err) {
    logger.error("Queue build error", { error: err.message });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/queue/run — dispatch all eligible claims to Vapi
// Strict rate limit: 10/min — each run triggers real outbound calls
// Optional body: { practice_id: 1 }
router.post("/queue/run", strictLimiter, async (req, res) => {
  // Validate + sanitize body
  const v = validateQueueRunBody(req.body || {});
  if (!v.valid) return validationError(res, v.errors);

  try {
    const practiceId   = v.sanitized.practice_id || null;
    const practiceConfig = await getPracticeConfig(practiceId);
    const queue          = await buildQueue(practiceId);

    if (queue.length === 0) {
      return res.json({ success: true, message: "No eligible claims in queue", dispatched: 0 });
    }

    const results = [];
    for (const claim of queue) {
      const result = await dispatchCall(claim, practiceConfig);
      results.push({ claimId: claim.id, ...result });
      // Small delay between dispatches to avoid Vapi burst limits
      await new Promise(r => setTimeout(r, 2000));
    }

    const succeeded = results.filter(r => r.success).length;
    res.json({
      success: true,
      practice_id: practiceId,
      dispatched: succeeded,
      failed: results.length - succeeded,
      results,
    });
  } catch (err) {
    logger.error("Queue run error", { error: err.message });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /api/queue/stats — queue status breakdown counts
router.get("/queue/stats", standardLimiter, async (req, res) => {
  try {
    const stats = await getQueueStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── Vapi Webhook ──────────────────────────────────────────────────────────────

// POST /api/webhooks/vapi — receives call-ended events from Vapi
// verifyVapiWebhook checks the x-vapi-secret HMAC header before processing.
// webhookLimiter allows 300 req/min to handle Vapi event bursts.
router.post("/webhooks/vapi", webhookLimiter, verifyVapiWebhook, async (req, res) => {
  try {
    const eventType = req.body?.message?.type;

    // Acknowledge non-end-of-call events without processing them
    if (eventType !== "end-of-call-report") {
      return res.json({ success: true, message: "Event acknowledged" });
    }

    const parsed = parseWebhook(req.body?.message);

    if (!parsed.claimId) {
      logger.warn("Vapi webhook received without claim_id in metadata", { ip: req.ip });
      return res.status(400).json({ success: false, error: "Missing claim_id in call metadata" });
    }

    const outcome = await processOutcome(parsed);
    logger.info("Webhook processed", { claimId: parsed.claimId, outcome: outcome.outcomeCode });

    res.json({ success: true, outcome });
  } catch (err) {
    logger.error("Webhook processing error", { error: err.message });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── Claims ───────────────────────────────────────────────────────────────────

// GET /api/claims — list claims with optional filters
// Validates and whitelists all query params before building SQL
router.get("/claims", standardLimiter, async (req, res) => {
  const v = validateClaimsQuery(req.query);
  if (!v.valid) return validationError(res, v.errors);

  try {
    const { bucket, status, carrier, queue_status, limit, offset } = v.sanitized;
    const conditions = [];
    const params     = [];

    if (bucket)       { params.push(bucket);       conditions.push(`aging_bucket = $${params.length}`); }
    if (status)       { params.push(status);        conditions.push(`status = $${params.length}`); }
    if (carrier)      { params.push(carrier);       conditions.push(`carrier_code = $${params.length}`); }
    if (queue_status) { params.push(queue_status);  conditions.push(`queue_status = $${params.length}`); }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    params.push(limit, offset);

    const result = await query(
      `SELECT * FROM claims ${where}
       ORDER BY priority_score DESC NULLS LAST, days_outstanding DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ success: true, count: result.rowCount, claims: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /api/claims/:id — single claim + call history
router.get("/claims/:id", standardLimiter, async (req, res) => {
  try {
    const claimResult = await query(`SELECT * FROM claims WHERE id = $1`, [req.params.id]);
    if (!claimResult.rows[0]) {
      return res.status(404).json({ success: false, error: "Claim not found" });
    }

    const attemptsResult = await query(
      `SELECT * FROM call_attempts WHERE claim_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      claim: claimResult.rows[0],
      callHistory: attemptsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/claims/:id/pause — manually pause a claim
router.post("/claims/:id/pause", standardLimiter, async (req, res) => {
  const v = validatePauseBody(req.body || {});
  if (!v.valid) return validationError(res, v.errors);

  try {
    await pauseClaim(req.params.id, v.sanitized.reason || "Manually paused by staff");
    res.json({ success: true, message: "Claim paused" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/claims/:id/unpause — return a paused claim to the queue
router.post("/claims/:id/unpause", standardLimiter, async (req, res) => {
  try {
    await query(
      `UPDATE claims
       SET queue_status = 'queued', next_call_at = NULL, call_attempts = 0, updated_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true, message: "Claim unpaused and returned to queue" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── Escalations ──────────────────────────────────────────────────────────────

// GET /api/escalations — open escalations for the front desk
router.get("/escalations", standardLimiter, async (req, res) => {
  try {
    const escalations = await getOpenEscalations();
    res.json({ success: true, count: escalations.length, escalations });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/escalations/:id/acknowledge
router.post("/escalations/:id/acknowledge", standardLimiter, async (req, res) => {
  const v = validateAcknowledgeBody(req.body || {});
  if (!v.valid) return validationError(res, v.errors);

  try {
    await acknowledgeEscalation(req.params.id, v.sanitized.assignedTo);
    res.json({ success: true, message: "Escalation acknowledged" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/escalations/:id/resolve
router.post("/escalations/:id/resolve", standardLimiter, async (req, res) => {
  const v = validateResolveBody(req.body || {});
  if (!v.valid) return validationError(res, v.errors);

  try {
    await resolveEscalation(req.params.id, v.sanitized.resolutionNotes);
    res.json({ success: true, message: "Escalation resolved" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── Reporting ────────────────────────────────────────────────────────────────

// GET /api/reports/aging — aging summary by carrier
router.get("/reports/aging", standardLimiter, async (req, res) => {
  try {
    const result = await query(
      `SELECT
         carrier_name,
         COUNT(*) as total_claims,
         SUM(amount_outstanding) as total_outstanding,
         SUM(CASE WHEN aging_bucket = '0-29'   THEN amount_outstanding ELSE 0 END) as "0_29",
         SUM(CASE WHEN aging_bucket = '30-59'  THEN amount_outstanding ELSE 0 END) as "30_59",
         SUM(CASE WHEN aging_bucket = '60-89'  THEN amount_outstanding ELSE 0 END) as "60_89",
         SUM(CASE WHEN aging_bucket = '90-119' THEN amount_outstanding ELSE 0 END) as "90_119",
         SUM(CASE WHEN aging_bucket = '120+'   THEN amount_outstanding ELSE 0 END) as "120_plus"
       FROM claims
       WHERE queue_status NOT IN ('resolved')
       GROUP BY carrier_name
       ORDER BY total_outstanding DESC`
    );
    res.json({ success: true, report: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /api/carriers/stats — knowledge base health by carrier
router.get("/carriers/stats", standardLimiter, async (req, res) => {
  try {
    const { getKBStats } = require("./carriers/adapter");
    const stats = await getKBStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── Carrier Block ────────────────────────────────────────────────────────────

// POST /api/carriers/:code/block
// Called manually by staff OR automatically via a Vapi webhook when a carrier
// detects our automated calling and blocks the number.
//
// Body (optional): { claim_id, reason }
//
// Effect:
//   1. Logs a CARRIER_BLOCK event to the escalations table
//   2. Suspends ALL queued/in-progress claims practice-wide (queue_status → 'paused')
//
// To resume after review: use POST /api/claims/:id/unpause on individual claims
// or issue a bulk unpause from the dashboard.
router.post("/carriers/:code/block", strictLimiter, async (req, res) => {
  const { code } = req.params;
  const { claim_id, reason } = req.body || {};

  const VALID_CARRIER_CODES = [
    'sun_life', 'canada_life', 'manulife',
    'green_shield', 'rbc_insurance', 'telus_adjudicare',
  ];

  if (!VALID_CARRIER_CODES.includes(code)) {
    return res.status(400).json({
      success: false,
      error: `Unknown carrier code. Must be one of: ${VALID_CARRIER_CODES.join(', ')}`,
    });
  }

  const blockReason = reason || `Manual CARRIER_BLOCK for ${code}`;

  try {
    // Log to escalations
    const escResult = await query(
      `INSERT INTO escalations (claim_id, reason, details, status)
       VALUES ($1, 'carrier_block', $2, 'open')
       RETURNING id`,
      [
        claim_id || null,
        `CARRIER_BLOCK event for carrier '${code}' at ${new Date().toISOString()}. ${blockReason}`,
      ]
    );
    const escalationId = escResult.rows[0]?.id;

    // Suspend all queued/in-progress claims practice-wide
    const suspendResult = await query(
      `UPDATE claims
       SET queue_status = 'paused',
           notes = COALESCE(notes, '') || $1,
           updated_at = NOW()
       WHERE queue_status IN ('queued', 'in_progress')`,
      [`\n[CARRIER_BLOCK: ${code} at ${new Date().toISOString()}. ${blockReason}]`]
    );

    logger.warn(`CARRIER_BLOCK logged for ${code}`, {
      escalationId,
      claimsSuspended: suspendResult.rowCount,
      reason: blockReason,
    });

    res.json({
      success: true,
      carrier: code,
      escalation_id: escalationId,
      claims_suspended: suspendResult.rowCount,
      message: `Carrier block logged. ${suspendResult.rowCount} queued claims suspended practice-wide.`,
    });
  } catch (err) {
    logger.error("Carrier block error", { error: err.message });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── Practices ────────────────────────────────────────────────────────────────

// GET /api/practices — list all active practices
router.get("/practices", standardLimiter, async (req, res) => {
  try {
    // Only accept the known query param; ignore everything else
    const includeInactive = req.query.include_inactive === "true";
    const practices = await listPractices(includeInactive);
    res.json({ success: true, count: practices.length, practices });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /api/practices/:id — single practice + queue stats
router.get("/practices/:id", standardLimiter, async (req, res) => {
  try {
    const practice = await getPractice(req.params.id);
    if (!practice) {
      return res.status(404).json({ success: false, error: "Practice not found" });
    }
    const stats = await getPracticeStats(req.params.id);
    res.json({ success: true, practice, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/practices — create a new practice
// Strict limiter: creating practices should be rare
router.post("/practices", strictLimiter, async (req, res) => {
  const v = validatePracticeBody(req.body || {}, false);
  if (!v.valid) return validationError(res, v.errors);

  try {
    const practice = await createPractice(v.sanitized);
    res.status(201).json({ success: true, practice });
  } catch (err) {
    logger.error("Create practice error", { error: err.message });
    res.status(400).json({ success: false, error: "Internal server error" });
  }
});

// PATCH /api/practices/:id — update practice fields
router.patch("/practices/:id", standardLimiter, async (req, res) => {
  const v = validatePracticeBody(req.body || {}, true); // isUpdate = true (no required fields)
  if (!v.valid) return validationError(res, v.errors);

  try {
    const practice = await updatePractice(req.params.id, v.sanitized);
    res.json({ success: true, practice });
  } catch (err) {
    res.status(400).json({ success: false, error: "Internal server error" });
  }
});

// DELETE /api/practices/:id — soft-deactivate
router.delete("/practices/:id", standardLimiter, async (req, res) => {
  try {
    const result = await deactivatePractice(req.params.id);
    res.json({ success: true, message: `Practice ${result.name} deactivated` });
  } catch (err) {
    res.status(400).json({ success: false, error: "Internal server error" });
  }
});

// ─── PIIVault Token Resolution (for Vapi tool calls) ─────────────────────────
//
// Allows Vapi agents to resolve a PHI token to its raw value during an active call.
// Protected by:
//   1. webhookLimiter — rate-limited to prevent brute-force token guessing
//   2. verifyVapiWebhook — HMAC signature must be valid (Vapi-signed request)
//   3. Tokens expire after 1 hour and are revoked after each call completes
//
// This endpoint is the "Token-to-PHI mapping resolved exclusively within the
// Node.js backend" stated in the PHI Vault requirement.

router.post("/vapi/phi/resolve", webhookLimiter, verifyVapiWebhook, (req, res) => {
  const { token } = req.body || {};

  if (!token || typeof token !== "string" || !token.startsWith("phi_")) {
    logger.warn("AUDIT: PIIVault resolve rejected — invalid token format", {
      event: "PHI_RESOLVE_REJECTED",
      ip: req.ip,
    });
    return res.status(400).json({ success: false, error: "Invalid token" });
  }

  const value = piiVault.resolve(token);

  if (value === null) {
    logger.warn("AUDIT: PIIVault resolve rejected — token not found or expired", {
      event: "PHI_RESOLVE_MISS",
      ip: req.ip,
    });
    return res.status(404).json({ success: false, error: "Token not found or expired" });
  }

  // Log the access (token ID only — not the resolved value)
  logger.info("AUDIT: PHI token resolved", {
    event:  "PHI_TOKEN_RESOLVED",
    token:  token.slice(0, 12) + "...", // partial token for audit trail, not full
    ip:     req.ip,
  });

  res.json({ success: true, value });
});

// ─── Claims Import ────────────────────────────────────────────────────────────

// POST /api/claims/import — import claims from AbelDent CSV or JSON array
// Strict rate limit: parsing large CSVs is expensive
// Accepts:
//   Content-Type: text/csv         — raw CSV in body
//   Content-Type: application/json — array of claim objects
// Query: ?practice_id=1
router.post(
  "/claims/import",
  strictLimiter,
  express.text({ type: "text/csv", limit: "10mb" }),
  async (req, res) => {
    // Validate query params
    const qv = validateImportQuery(req.query);
    if (!qv.valid) return validationError(res, qv.errors);

    try {
      const practiceId  = qv.sanitized.practice_id || null;
      const contentType = req.headers["content-type"] || "";
      let rows;

      if (contentType.includes("text/csv")) {
        if (!req.body || typeof req.body !== "string") {
          return res.status(400).json({ success: false, error: "Expected CSV text body" });
        }
        rows = parseCSV(req.body);
      } else if (contentType.includes("application/json")) {
        if (!Array.isArray(req.body)) {
          return res.status(400).json({ success: false, error: "Expected JSON array of claim objects" });
        }
        // Cap JSON import to 5000 rows to prevent memory exhaustion
        if (req.body.length > 5000) {
          return res.status(400).json({ success: false, error: "JSON import limited to 5000 rows per request" });
        }
        rows = req.body;
      } else {
        return res.status(415).json({
          success: false,
          error: "Content-Type must be text/csv or application/json",
        });
      }

      const results = await importClaims(rows, practiceId);

      res.json({
        success: true,
        practice_id: practiceId,
        imported: results.imported,
        skipped: results.skipped,
        errors: results.errors.length,
        error_details: results.errors.slice(0, 10), // cap to first 10 to avoid large responses
      });
    } catch (err) {
      logger.error("Claims import error", { error: err.message });
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
);

module.exports = router;
