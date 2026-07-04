/**
 * CollectRx API Routes
 *
 * Security applied on every route:
 * • Admin API key — every route except the two Vapi HMAC-signed webhooks requires X-Api-Key
 * • Rate limiting — standardLimiter (120/min) or strictLimiter (10/min)
 * • Input validation — schema-based via security middleware; unexpected fields rejected
 * • Sanitization — strings trimmed + control-chars stripped before DB writes
 * • Webhook auth — HMAC-SHA256 signature verified before processing Vapi events
 *
 * SECRETS: No API keys or secrets are referenced here.
 * All credentials live exclusively in process.env.
 */

const express = require("express");
const router = express.Router();
const { query } = require("./db.cjs");
const { buildQueue, getQueueStats, pauseClaim } = require("./queue/engine");
const { processOutcome, suspendAllQueuedClaims } = require("./outcome/processor.legacy.cjs");
const { dispatchCall, parseWebhook } = require("./vapi/client.legacy.cjs");
const {
  getOpenEscalations,
  acknowledgeEscalation,
  resolveEscalation,
  alertEscalationStaffImmediateRaw,
} = require("./outcome/escalation");
const { createPractice, getPractice, listPractices, updatePractice, deactivatePractice, getPracticeConfig, getPracticeStats } = require("./practices/manager");
const { importClaims, parseCSV } = require("./claims/importer");
const piiVault = require("./pii-vault");
const planService = require("./services/plans/planService.cjs");
const usageService = require("./services/plans/usageService.cjs");
const logger = require("./logger");

// Security middleware — rate limiters, validators, webhook verifier, admin auth
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
  validateCarrierBlockBody,
  verifyVapiWebhook,
  requireApiKey,
} = require("./middleware/security");

// ── Admin API key gate ────────────────────────────────────────────────────────
// Applies to every route below except /webhooks/vapi and /vapi/phi/resolve,
// which authenticate via Vapi's own HMAC signature instead (see requireApiKey's
// PUBLIC_PATHS exemption list in middleware/security.js).
router.use(requireApiKey);

// ─── Helper: send a consistent 400 validation error ──────────────────────────
function validationError(res, errors) {
  return res.status(400).json({ success: false, error: "Validation failed", details: errors });
}

// ─── Queue ────────────────────────────────────────────────────────────────────

// GET /api/queue/build — dry-run: score and return today's call queue (no calls made)
// With no practice_id, this now builds a combined queue across every active
// practice (each scored against its own thresholds) plus any legacy claims
// that have no practice_id assigned at all.
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
// Optional body: { practice_id: 1 } — restrict the run to a single practice.
// Omit practice_id to run every active practice in one pass; each claim is
// dispatched using ITS OWN practice's config, not a single shared config.
router.post("/queue/run", strictLimiter, async (req, res) => {
  // Validate + sanitize body
  const v = validateQueueRunBody(req.body || {});
  if (!v.valid) return validationError(res, v.errors);

  try {
    const practiceId = v.sanitized.practice_id || null;
    const queue = await buildQueue(practiceId);

    if (queue.length === 0) {
      return res.json({ success: true, message: "No eligible claims in queue", dispatched: 0 });
    }

    // Cache each practice's config so a multi-practice run doesn't refetch
    // the same practice's config once per claim.
    const configCache = new Map();
    async function configFor(pid) {
      const key = pid || 0;
      if (!configCache.has(key)) configCache.set(key, await getPracticeConfig(pid));
      return configCache.get(key);
    }

    const results = [];
    let gateBlock = null; // Set when planService blocks a practice mid-run
    for (const claim of queue) {
      // ── Plan/subscription gate (collectrx-tiering-strategy.md §7 P0) ──
      // Consult planService BEFORE every dispatch. The claim row carries
      // practice_id; the per-run practiceId param is a fallback for the
      // legacy single-tenant path.
      const claimPracticeId = claim.practice_id || practiceId;
      const gate = claimPracticeId ? await planService.canMakeCall(claimPracticeId) : { allowed: true };
      if (!gate.allowed) {
        logger.warn("Queue run: practice gated, skipping its claims", {
          practiceId: claimPracticeId,
          reason: gate.reason,
        });
        results.push({ claimId: claim.id, success: false, blocked: true, reason: gate.reason });
        gateBlock = { practiceId: claimPracticeId, reason: gate.reason };
        // Only skip this claim (and effectively the rest of this one
        // practice's claims, since the same gate will keep firing for
        // them). Do NOT break the whole run — other practices in a
        // multi-practice pass must still get their calls dispatched.
        continue;
      }

      const practiceConfig = await configFor(claimPracticeId);
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
      gate_block: gateBlock,
      results,
    });
  } catch (err) {
    logger.error("Queue run error", { error: err.message });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /api/queue/stats — queue status breakdown counts
// Optional ?practice_id=1 to scope to a single practice; omit for the
// platform-wide breakdown.
router.get("/queue/stats", standardLimiter, async (req, res) => {
  try {
    const practiceId = req.query.practice_id ? parseInt(req.query.practice_id, 10) : null;
    const stats = await getQueueStats(practiceId || null);
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── Vapi Webhook ──────────────────────────────────────────────────────────────

// POST /api/webhooks/vapi — receives call-ended events from Vapi
// verifyVapiWebhook checks the x-vapi-secret HMAC header before processing.
// webhookLimiter allows 300 req/min to handle Vapi event bursts.
// Exempt from requireApiKey (see PUBLIC_PATHS) — auth is the HMAC signature.
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

    // ── Usage metering (collectrx-tiering-strategy.md §7 P0) ─────────────
    // Record value-bearing terminal outcomes against the practice's Plan.
    // Idempotent on vapi_call_id — webhook redeliveries are no-ops.
    try {
      const claimRow = await query(
        `SELECT practice_id FROM claims WHERE id = $1`,
        [parsed.claimId]
      );
      const practiceIdForUsage = claimRow.rows[0]?.practice_id;
      if (practiceIdForUsage) {
        const amountCents = outcome.outcomeCode === "paid"
          ? await usageService.recoveredCentsForClaim(parsed.claimId)
          : 0;
        await usageService.recordOutcome({
          practiceId: practiceIdForUsage,
          claimId: parsed.claimId,
          vapiCallId: parsed.vapiCallId,
          outcomeCode: outcome.outcomeCode,
          amountCents,
        });
      }
    } catch (usageErr) {
      // Usage metering must never break the webhook ack — log and move on.
      logger.error("Usage recording failed (non-fatal)", { error: usageErr.message });
    }

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
    const params = [];

    if (bucket) { params.push(bucket); conditions.push(`aging_bucket = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (carrier) { params.push(carrier); conditions.push(`carrier_code = $${params.length}`); }
    if (queue_status) { params.push(queue_status); conditions.push(`queue_status = $${params.length}`); }

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
        SUM(CASE WHEN aging_bucket = '0-29' THEN amount_outstanding ELSE 0 END) as "0_29",
        SUM(CASE WHEN aging_bucket = '30-59' THEN amount_outstanding ELSE 0 END) as "30_59",
        SUM(CASE WHEN aging_bucket = '60-89' THEN amount_outstanding ELSE 0 END) as "60_89",
        SUM(CASE WHEN aging_bucket = '90-119' THEN amount_outstanding ELSE 0 END) as "90_119",
        SUM(CASE WHEN aging_bucket = '120+' THEN amount_outstanding ELSE 0 END) as "120_plus"
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
    const { getKBStats } = require("./carriers/adapter.legacy.cjs");
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
// Body: { practice_id, claim_id?, reason? } — practice_id is REQUIRED.
//
// Effect:
// 1. Logs a CARRIER_BLOCK event to the escalations table
// 2. Suspends queued/in-progress claims for THAT PRACTICE ONLY (queue_status → 'paused')
//
// practice_id is required because a carrier block is tied to one practice's
// caller ID / calling pattern — it must never suspend another practice's
// claims just because they happen to use the same carrier.
//
// To resume after review: use POST /api/claims/:id/unpause on individual claims
// or issue a bulk unpause from the dashboard.
router.post("/carriers/:code/block", strictLimiter, async (req, res) => {
  const { code } = req.params;
  const v = validateCarrierBlockBody(req.body || {});
  if (!v.valid) return validationError(res, v.errors);
  const { practice_id: practiceId, claim_id: claimId, reason } = v.sanitized;

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
        claimId || null,
        `CARRIER_BLOCK event for carrier '${code}' (practice ${practiceId}) at ${new Date().toISOString()}. ${blockReason}`,
      ]
    );
    const escalationId = escResult.rows[0]?.id;

    await alertEscalationStaffImmediateRaw({
      urgent: true,
      escalationId,
      title: `Carrier block: ${code}`,
      detail: blockReason,
    });

    // Suspend queued/in-progress claims for THIS PRACTICE ONLY.
    const suspendResult = await query(
      `UPDATE claims
       SET queue_status = 'paused',
           notes = COALESCE(notes, '') || $1,
           updated_at = NOW()
       WHERE practice_id = $2
         AND queue_status IN ('queued', 'in_progress')`,
      [`\n[CARRIER_BLOCK: ${code} at ${new Date().toISOString()}. ${blockReason}]`, practiceId]
    );

    logger.warn(`CARRIER_BLOCK logged for ${code}`, {
      escalationId,
      practiceId,
      claimsSuspended: suspendResult.rowCount,
      reason: blockReason,
    });

    res.json({
      success: true,
      carrier: code,
      practice_id: practiceId,
      escalation_id: escalationId,
      claims_suspended: suspendResult.rowCount,
      message: `Carrier block logged. ${suspendResult.rowCount} queued claims suspended for practice ${practiceId}.`,
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
// 1. webhookLimiter — rate-limited to prevent brute-force token guessing
// 2. verifyVapiWebhook — HMAC signature must be valid (Vapi-signed request)
// 3. Tokens expire after 1 hour and are revoked after each call completes
//
// This endpoint is the "Token-to-PHI mapping resolved exclusively within the
// Node.js backend" stated in the PHI Vault requirement.
// Exempt from requireApiKey (see PUBLIC_PATHS) — auth is the HMAC signature.

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
    event: "PHI_TOKEN_RESOLVED",
    token: token.slice(0, 12) + "...", // partial token for audit trail, not full
    ip: req.ip,
  });

  res.json({ success: true, value });
});

// ─── Claims Import ────────────────────────────────────────────────────────────

// POST /api/claims/import — import claims from AbelDent CSV or JSON array
// Strict rate limit: parsing large CSVs is expensive
// Accepts:
//   Content-Type: text/csv — raw CSV in body
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
      const practiceId = qv.sanitized.practice_id || null;
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

// ─── Plan / monetization (collectrx-tiering-strategy.md §7 P0) ────────────────

// GET /api/plan?practice_id=...
// Returns the practice's current plan summary: tier, trial state, included-
// pool usage, features. The frontend uses this to render the in-console
// upgrade prompt and to gate UI surfaces (white-label toggle, REST keys, …).
router.get("/plan", standardLimiter, async (req, res) => {
  try {
    const practiceId = String(req.query.practice_id || "").trim();
    if (!practiceId) {
      return res.status(400).json({ success: false, error: "practice_id is required" });
    }
    const summary = await planService.getPlanSummary(practiceId);
    res.json({ success: true, plan: summary });
  } catch (err) {
    logger.error("Plan read error", { error: err.message });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/plan/tier { practice_id, tier, status? }
// Used by Stripe webhook on subscription activation and by platform_admin for
// backfills. Now gated by requireApiKey at the router level (see top of file).
router.post("/plan/tier", strictLimiter, async (req, res) => {
  try {
    const { practice_id, tier, status } = req.body || {};
    if (!practice_id || !tier) {
      return res.status(400).json({ success: false, error: "practice_id and tier required" });
    }
    const plan = await planService.setTier(String(practice_id), String(tier), status || "active");
    res.json({ success: true, plan });
  } catch (err) {
    logger.error("Plan tier update error", { error: err.message });
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
