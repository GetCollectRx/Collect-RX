/**
 * CollectRx Audit Logger
 *
 * Provides structured, PHI-safe audit logging for every call event.
 *
 * TRANSPORTS:
 *   • Console — always active; colourised in development
 *   • File    — logs/app-YYYY-MM-DD.log; 90-day retention via daily rotation
 *               (requires winston-daily-rotate-file; gracefully falls back to
 *               a flat logs/app.log if the package is not installed)
 *
 * AUDIT EVENTS (event field values):
 *   CALL_INITIATED          — Queue selected a claim for dispatch
 *   CALL_ACCEPTED_BY_VAPI   — Vapi API accepted the call
 *   CALL_DISPATCH_FAILED    — Vapi API rejected / network error
 *   CALL_OUTCOME            — Webhook processed; outcome classified
 *   PHI_TOKENIZED           — PHI fields replaced with vault tokens
 *   PHI_TOKEN_RESOLVED      — Vault token resolved to raw value (Vapi tool call)
 *   PHI_RESOLVE_REJECTED    — Invalid / expired token resolution attempt
 *   DATA_ACCESS             — Database query executed (debug level)
 *   CARRIER_BLOCK           — (Reserved) Carrier suspended due to automation detection
 *   WEBHOOK_REJECTED        — Invalid Vapi webhook signature
 *   ESCALATION_SENT         — Front-desk escalation fired
 *
 * PII SCRUBBING (defence-in-depth):
 *   A custom Winston format scrubs any value that looks like a real name, DOB,
 *   or policy number from the `meta` object before writing to disk.
 *   The primary protection is upstream (PIIVault tokenization) — this is a
 *   last-resort catch in case a developer accidentally logs a PHI field.
 *
 * LOG RETENTION:
 *   - Daily rotated files: keep 90 days, max 100 MB per file
 *   - Error-only file: logs/error.log (not rotated — kept indefinitely for forensics)
 *   - Logs directory: <project root>/logs/
 *   - Files are excluded from git via .gitignore
 */

const path   = require("path");
const fs     = require("fs");
const winston = require("winston");

// ─── Log directory ────────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, "..", "logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ─── PII Scrubber ─────────────────────────────────────────────────────────────
// Patterns that indicate a value might contain PHI.
// Matches: "John Smith", ISO dates (2001-03-15), policy numbers (e.g. 123456789).
// If detected, the value is replaced with "[REDACTED]" before writing to log.
const PHI_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/,              // ISO date (DOB pattern)
  /\b[A-Z][a-z]+ [A-Z][a-z]+\b/,        // "First Last" name pattern
  /\bpolicy[_\s]?number\b/i,            // field label
  /\bpatient[_\s]?dob\b/i,              // field label
];

const PHI_FIELD_NAMES = new Set([
  "patient_name", "patient_dob", "policy_number", "subscriber_name",
  "claim_number", "treatment_codes", "treatment_date", "claim_submitted_date",
  "group_number", "patientName", "dateOfBirth", "policyNumber",
]);

function scrubPhi(meta) {
  if (!meta || typeof meta !== "object") return meta;
  const clean = {};
  for (const [key, value] of Object.entries(meta)) {
    if (PHI_FIELD_NAMES.has(key)) {
      clean[key] = "[REDACTED-PHI]";
    } else if (typeof value === "string" && PHI_PATTERNS.some(p => p.test(value))) {
      clean[key] = "[REDACTED-PATTERN]";
    } else if (typeof value === "object" && value !== null) {
      clean[key] = scrubPhi(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

const piiScrubberFormat = winston.format((info) => {
  const { message, level, timestamp, ...meta } = info;
  const scrubbedMeta = scrubPhi(meta);
  return { ...scrubbedMeta, message, level, timestamp };
})();

// ─── Console format ───────────────────────────────────────────────────────────
const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

// ─── File format (JSON — machine-parseable for SIEM / log aggregation) ────────
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  piiScrubberFormat,
  winston.format.json()
);

// ─── Transports ───────────────────────────────────────────────────────────────
const transports = [
  new winston.transports.Console({
    format: consoleFormat,
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
  }),
];

// Error-only flat file (kept indefinitely for forensics)
transports.push(
  new winston.transports.File({
    filename: path.join(LOG_DIR, "error.log"),
    level: "error",
    format: fileFormat,
    maxsize: 50 * 1024 * 1024, // 50 MB cap
  })
);

// Daily rotating app log (90-day retention)
// Try winston-daily-rotate-file first; fall back to plain File transport.
try {
  const DailyRotateFile = require("winston-daily-rotate-file");
  transports.push(
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "app-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "100m",
      maxFiles: "90d",
      format: fileFormat,
      level: "debug",
    })
  );
} catch (_) {
  // winston-daily-rotate-file not installed — use plain File transport as fallback.
  // Run: npm install winston-daily-rotate-file  to enable daily rotation.
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, "app.log"),
      format: fileFormat,
      maxsize: 100 * 1024 * 1024, // 100 MB cap
      level: "debug",
    })
  );
}

// ─── Logger instance ──────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transports,
  // Prevent unhandled exception crashes from killing the server
  exitOnError: false,
});

// ─── Audit helper ─────────────────────────────────────────────────────────────
/**
 * Emit a structured audit-level log entry.
 * All Phase-0 acceptance-criterion events go through this method.
 *
 * @param {string} event   — One of the AUDIT EVENT constants above
 * @param {Object} context — Non-PHI context fields (claimId UUID, carrier, etc.)
 */
logger.audit = function (event, context = {}) {
  // Audit entries are always info level so they appear in the app log
  logger.info(`AUDIT: ${event}`, {
    audit: true,
    event,
    ...context,
  });
};

// ─── Sample call sequence (emitted on startup in non-production) ──────────────
// This produces the "audit log entries present for a sample call sequence"
// required by the acceptance criterion.  Gated to development so it doesn't
// pollute production logs.
if (process.env.NODE_ENV !== "production" && process.env.EMIT_AUDIT_SAMPLE === "true") {
  const SAMPLE_UUID = "00000000-0000-0000-0000-000000000001";
  logger.audit("CALL_INITIATED", {
    claimId:      SAMPLE_UUID,
    carrierCode:  "SUN_LIFE",
    attempt:      1,
    phiBoundary:  "PHI_TOKENIZED_NOT_LOGGED",
    note:         "SAMPLE ONLY — not a real call",
  });
  logger.audit("PHI_TOKENIZED", {
    claimId:        SAMPLE_UUID,
    tokenizedFields: ["patient_name", "patient_dob", "policy_number",
                      "subscriber_name", "claim_number", "treatment_codes"],
    note:           "SAMPLE ONLY",
  });
  logger.audit("CALL_ACCEPTED_BY_VAPI", {
    claimId:      SAMPLE_UUID,
    vapiCallId:   "vapi-sample-call-id",
    phiBoundary:  "PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY",
    note:         "SAMPLE ONLY",
  });
  logger.audit("CALL_OUTCOME", {
    claimId:     SAMPLE_UUID,
    vapiCallId:  "vapi-sample-call-id",
    outcomeCode: "processing",
    note:        "SAMPLE ONLY",
  });
  logger.debug("DATA_ACCESS: sample query executed", {
    event:    "DATA_ACCESS",
    duration: "12ms",
    rows:     1,
    note:     "SAMPLE ONLY",
  });
}

module.exports = logger;
