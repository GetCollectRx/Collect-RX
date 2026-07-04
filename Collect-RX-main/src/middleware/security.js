/**
 * CollectRx Security Middleware
 *
 * Implements OWASP-aligned security controls:
 * 1. Rate limiting — IP-based, per-endpoint budgets, graceful 429s
 * 2. Input validation helpers — schema-based, type-checked, length-capped
 * 3. Webhook signature verification — HMAC-SHA256 (Vapi)
 * 4. Admin API key auth — static key required on every non-webhook route
 * 5. Secure headers — via helmet
 * 6. CORS — allowlist-based
 *
 * IMPORTANT: No keys or secrets live here. All secrets are loaded
 * exclusively from process.env (set via Railway / .env, never hard-coded).
 */

const rateLimit = require("express-rate-limit");
const crypto = require("crypto"); // built-in — no install needed
const logger = require("../logger");

// ─── 1. RATE LIMITING ────────────────────────────────────────────────────────
//
// Three tiers:
// • standard — 120 req / 1 min per IP (read endpoints)
// • strict — 10 req / 1 min per IP (expensive write operations)
// • webhook — 300 req / 1 min per IP (Vapi can batch-fire events)
//
// All tiers return a JSON 429 with Retry-After header so clients
// can back off gracefully instead of receiving an HTML error page.

const rateLimitResponse = (req, res) => {
  res.status(429).json({
    success: false,
    error: "Too many requests — please slow down and try again shortly.",
    retryAfter: res.getHeader("Retry-After"),
  });
};

/** Standard limiter — applied to all read/reporting endpoints. */
const standardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute window
  max: 120, // 120 requests per window per IP
  standardHeaders: true, // Return RateLimit-* headers (RFC 6585)
  legacyHeaders: false, // Suppress X-RateLimit-* (deprecated)
  handler: rateLimitResponse,
  keyGenerator: (req) => req.ip, // IP-based key
});

/** Strict limiter — applied to queue/run and claims/import (expensive). */
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute window
  max: 10, // Only 10 expensive ops per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitResponse,
  keyGenerator: (req) => req.ip,
  skip: (req) => {
    // In production, never trust loopback: misconfigured `trust proxy` can label clients as 127.0.0.1.
    if (process.env.NODE_ENV === "production") {
      return false;
    }
    if (process.env.ALLOW_STRICT_LIMIT_LOCALHOST_BYPASS !== "true") {
      return false;
    }
    const ip = req.ip || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
});

/** Webhook limiter — higher ceiling because Vapi can send bursts. */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitResponse,
  keyGenerator: (req) => req.ip,
});

// ─── 2. INPUT VALIDATION HELPERS ─────────────────────────────────────────────
//
// Schema-based validation. Each helper returns { valid, errors }.
// Use these at the top of route handlers before touching req.body / req.query.
//
// Rules:
// • Type-check every field
// • Reject unexpected/extra fields (strict mode)
// • Cap string lengths to prevent oversized payloads
// • Whitelist enum values
// • Sanitize strings: trim whitespace, no control characters

const ALLOWED_BUCKETS = ["0-29", "30-59", "60-89", "90-119", "120+"];
const ALLOWED_QUEUE_STATUS = ["queued", "in_progress", "resolved", "escalated", "paused", "excluded"];
const MAX_STRING_LENGTH = 500; // Default max for most text fields
const MAX_NOTES_LENGTH = 2000; // Longer for free-text resolution notes
const MAX_CSV_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB (matches route limit)

/**
 * Sanitize a string: trim, remove ASCII control characters (except \n \r \t).
 * Returns null if the input is not a string.
 */
function sanitizeString(value, maxLen = MAX_STRING_LENGTH) {
  if (typeof value !== "string") return null;
  // Remove control chars except newline/carriage-return/tab
  const clean = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  return clean.slice(0, maxLen);
}

/**
 * Validate query params for GET /api/claims.
 * Returns { valid: true, sanitized } or { valid: false, errors: [...] }.
 */
function validateClaimsQuery(query) {
  const errors = [];
  const sanitized = {};

  if (query.bucket !== undefined) {
    if (!ALLOWED_BUCKETS.includes(query.bucket)) {
      errors.push(`bucket must be one of: ${ALLOWED_BUCKETS.join(", ")}`);
    } else {
      sanitized.bucket = query.bucket;
    }
  }

  if (query.queue_status !== undefined) {
    if (!ALLOWED_QUEUE_STATUS.includes(query.queue_status)) {
      errors.push(`queue_status must be one of: ${ALLOWED_QUEUE_STATUS.join(", ")}`);
    } else {
      sanitized.queue_status = query.queue_status;
    }
  }

  if (query.carrier !== undefined) {
    const s = sanitizeString(query.carrier, 100);
    if (!s) errors.push("carrier must be a non-empty string");
    else sanitized.carrier = s;
  }

  if (query.status !== undefined) {
    const s = sanitizeString(query.status, 50);
    if (!s) errors.push("status must be a non-empty string");
    else sanitized.status = s;
  }

  // Limit: 1–500, default 100
  const limit = query.limit !== undefined ? parseInt(query.limit, 10) : 100;
  if (isNaN(limit) || limit < 1 || limit > 500) {
    errors.push("limit must be an integer between 1 and 500");
  } else {
    sanitized.limit = limit;
  }

  // Offset: 0+, default 0
  const offset = query.offset !== undefined ? parseInt(query.offset, 10) : 0;
  if (isNaN(offset) || offset < 0) {
    errors.push("offset must be a non-negative integer");
  } else {
    sanitized.offset = offset;
  }

  return errors.length ? { valid: false, errors } : { valid: true, sanitized };
}

/**
 * Validate body for POST /api/queue/run.
 * practice_id is optional; if present must be a positive integer.
 */
function validateQueueRunBody(body = {}) {
  const errors = [];
  const sanitized = {};

  // Reject unexpected fields (strict mode)
  const allowed = new Set(["practice_id"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push(`Unexpected field: '${key}'`);
  }

  if (body.practice_id !== undefined) {
    const id = parseInt(body.practice_id, 10);
    if (isNaN(id) || id < 1) errors.push("practice_id must be a positive integer");
    else sanitized.practice_id = id;
  }

  return errors.length ? { valid: false, errors } : { valid: true, sanitized };
}

/**
 * Validate body for POST /api/claims/:id/pause.
 */
function validatePauseBody(body = {}) {
  const errors = [];
  const sanitized = {};

  const allowed = new Set(["reason"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push(`Unexpected field: '${key}'`);
  }

  if (body.reason !== undefined) {
    const s = sanitizeString(body.reason, MAX_STRING_LENGTH);
    if (s === null) errors.push("reason must be a string");
    else sanitized.reason = s;
  }

  return errors.length ? { valid: false, errors } : { valid: true, sanitized };
}

/**
 * Validate body for POST /api/escalations/:id/acknowledge.
 */
function validateAcknowledgeBody(body = {}) {
  const errors = [];
  const sanitized = {};

  const allowed = new Set(["assignedTo"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push(`Unexpected field: '${key}'`);
  }

  if (body.assignedTo !== undefined) {
    const s = sanitizeString(body.assignedTo, 200);
    if (s === null) errors.push("assignedTo must be a string");
    else sanitized.assignedTo = s;
  }

  return errors.length ? { valid: false, errors } : { valid: true, sanitized };
}

/**
 * Validate body for POST /api/escalations/:id/resolve.
 */
function validateResolveBody(body = {}) {
  const errors = [];
  const sanitized = {};

  const allowed = new Set(["resolutionNotes"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push(`Unexpected field: '${key}'`);
  }

  if (body.resolutionNotes !== undefined) {
    const s = sanitizeString(body.resolutionNotes, MAX_NOTES_LENGTH);
    if (s === null) errors.push("resolutionNotes must be a string");
    else sanitized.resolutionNotes = s;
  }

  return errors.length ? { valid: false, errors } : { valid: true, sanitized };
}

/**
 * Validate body for POST /api/practices and PATCH /api/practices/:id.
 * Enforces types, lengths, and URL format for escalation_webhook_url (SSRF prevention).
 */
function validatePracticeBody(body = {}, isUpdate = false) {
  const errors = [];
  const sanitized = {};

  const ALLOWED_FIELDS = new Set([
    "name", "phone", "fax", "email", "address", "city", "province", "postal_code",
    "npi", "tax_id", "primary_dentist", "secondary_dentist", "escalation_email",
    "escalation_webhook_url", "max_call_attempts", "min_claim_value",
    "min_days_outstanding", "cooldown_hours", "max_calls_per_run",
  ]);

  // Reject unexpected fields (strict mode)
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) errors.push(`Unexpected field: '${key}'`);
  }

  // Required fields for creation
  if (!isUpdate) {
    if (!body.name) errors.push("name is required");
    if (!body.phone) errors.push("phone is required");
    if (!body.npi) errors.push("npi is required");
    if (!body.tax_id) errors.push("tax_id is required");
  }

  // String fields with length limits
  const stringFields = {
    name: 200, phone: 30, fax: 30, email: 254, address: 300,
    city: 100, province: 50, postal_code: 20, npi: 20, tax_id: 20,
    primary_dentist: 200, secondary_dentist: 200, escalation_email: 254,
  };

  for (const [field, maxLen] of Object.entries(stringFields)) {
    if (body[field] !== undefined) {
      const s = sanitizeString(body[field], maxLen);
      if (s === null) errors.push(`${field} must be a string`);
      else if (!isUpdate && !s && ["name","phone","npi","tax_id"].includes(field)) {
        errors.push(`${field} cannot be empty`);
      } else {
        sanitized[field] = s;
      }
    }
  }

  // escalation_webhook_url — must be https:// only (prevent SSRF to internal services)
  if (body.escalation_webhook_url !== undefined) {
    const url = sanitizeString(body.escalation_webhook_url, 500);
    if (url === null) {
      errors.push("escalation_webhook_url must be a string");
    } else if (url && !url.match(/^https:\/\/.+/)) {
      // Only allow https:// URLs to prevent SSRF to internal/local addresses
      errors.push("escalation_webhook_url must start with https://");
    } else {
      sanitized.escalation_webhook_url = url;
    }
  }

  // Numeric fields — must be positive integers within sensible bounds
  const numericFields = {
    max_call_attempts: { min: 1, max: 20 },
    min_claim_value: { min: 0, max: 100000 },
    min_days_outstanding: { min: 0, max: 3650 },
    cooldown_hours: { min: 1, max: 168 }, // 1 hour – 1 week
    max_calls_per_run: { min: 1, max: 100 },
  };

  for (const [field, { min, max }] of Object.entries(numericFields)) {
    if (body[field] !== undefined) {
      const n = parseInt(body[field], 10);
      if (isNaN(n) || n < min || n > max) {
        errors.push(`${field} must be an integer between ${min} and ${max}`);
      } else {
        sanitized[field] = n;
      }
    }
  }

  return errors.length ? { valid: false, errors } : { valid: true, sanitized };
}

/**
 * Validate query param ?practice_id for POST /api/claims/import.
 */
function validateImportQuery(query = {}) {
  const errors = [];
  const sanitized = {};

  if (query.practice_id !== undefined) {
    const id = parseInt(query.practice_id, 10);
    if (isNaN(id) || id < 1) errors.push("practice_id must be a positive integer");
    else sanitized.practice_id = id;
  }

  return errors.length ? { valid: false, errors } : { valid: true, sanitized };
}

/**
 * Validate body for POST /api/carriers/:code/block.
 * practice_id is required — carrier blocks must be scoped to the practice
 * whose calls triggered them, never applied platform-wide.
 */
function validateCarrierBlockBody(body = {}) {
  const errors = [];
  const sanitized = {};

  const allowed = new Set(["practice_id", "claim_id", "reason"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push(`Unexpected field: '${key}'`);
  }

  const practiceId = parseInt(body.practice_id, 10);
  if (isNaN(practiceId) || practiceId < 1) {
    errors.push("practice_id is required and must be a positive integer");
  } else {
    sanitized.practice_id = practiceId;
  }

  if (body.claim_id !== undefined) {
    const s = sanitizeString(body.claim_id, 100);
    if (s === null) errors.push("claim_id must be a string");
    else sanitized.claim_id = s;
  }

  if (body.reason !== undefined) {
    const s = sanitizeString(body.reason, MAX_STRING_LENGTH);
    if (s === null) errors.push("reason must be a string");
    else sanitized.reason = s;
  }

  return errors.length ? { valid: false, errors } : { valid: true, sanitized };
}

// ─── 3. WEBHOOK SIGNATURE VERIFICATION ───────────────────────────────────────
//
// Vapi signs each webhook POST with HMAC-SHA256.
// The signature is sent in the `x-vapi-secret` header.
//
// SETUP: In the Vapi dashboard → Phone Numbers → Server URL,
// set a "Server Secret". Store that secret as VAPI_WEBHOOK_SECRET
// in Railway environment variables (never in source code).
//
// If VAPI_WEBHOOK_SECRET is not set, verification is skipped with a
// warning — this allows the app to start in environments where the
// secret hasn't been configured yet, but will log prominently.

function verifyVapiWebhook(req, res, next) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;

  if (!secret) {
    // Warn loudly but don't block — allows development without the secret.
    // In production, set VAPI_WEBHOOK_SECRET to reject forged webhooks.
    logger.warn(
      "SECURITY: VAPI_WEBHOOK_SECRET is not set — webhook signature verification is DISABLED. " +
      "Set this env var in production to prevent forged webhook injection."
    );
    return next();
  }

  const signature = req.headers["x-vapi-secret"];

  if (!signature) {
    logger.warn("Webhook rejected: missing x-vapi-secret header", { ip: req.ip });
    return res.status(401).json({ success: false, error: "Missing webhook signature" });
  }

  // Constant-time comparison to prevent timing attacks
  try {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    const sigBuffer = Buffer.from(signature, "hex");
    const expBuffer = Buffer.from(expected, "hex");

    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      logger.warn("Webhook rejected: invalid signature", { ip: req.ip });
      return res.status(401).json({ success: false, error: "Invalid webhook signature" });
    }
  } catch (err) {
    logger.error("Webhook signature verification error", { error: err.message });
    return res.status(401).json({ success: false, error: "Signature verification failed" });
  }

  next();
}

// ─── 4. ADMIN API KEY AUTH ────────────────────────────────────────────────────
//
// Every /api/* route except the two Vapi-signed webhook endpoints requires a
// static API key in the X-Api-Key header. This exists because — before this
// change — NOTHING checked who was calling these routes: rate limiting and
// input validation are not authentication, and CORS only restricts browser
// callers (curl/Postman/server-to-server calls bypass it entirely).
//
// SETUP: set ADMIN_API_KEY as a Fly secret. Requests without a matching
// X-Api-Key header are rejected with 401. If ADMIN_API_KEY is not configured
// at all, every request is rejected with 503 — fail closed, never open.

const PUBLIC_PATHS = new Set([
  "/webhooks/vapi",    // authenticated separately via verifyVapiWebhook (HMAC)
  "/vapi/phi/resolve", // authenticated separately via verifyVapiWebhook (HMAC)
]);

function safeCompare(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requireApiKey(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();

  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    logger.error(
      "SECURITY: ADMIN_API_KEY is not set — rejecting all admin API requests (fail closed).",
      { event: "AUTH_MISCONFIGURED", path: req.path }
    );
    return res.status(503).json({ success: false, error: "Service misconfigured" });
  }

  const provided = req.headers["x-api-key"];
  if (!provided || !safeCompare(provided, expected)) {
    logger.warn("AUDIT: rejected unauthenticated API request", {
      event: "AUTH_REJECTED",
      path: req.path,
      ip: req.ip,
    });
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  next();
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  // Rate limiters
  standardLimiter,
  strictLimiter,
  webhookLimiter,

  // Validators
  validateClaimsQuery,
  validateQueueRunBody,
  validatePauseBody,
  validateAcknowledgeBody,
  validateResolveBody,
  validatePracticeBody,
  validateImportQuery,
  validateCarrierBlockBody,

  // Webhook verification
  verifyVapiWebhook,

  // Admin API key auth
  requireApiKey,

  // Utility (exported for testing)
  sanitizeString,
};
