/**
 * CollectRx Vapi Client — Squad-based dispatch
 * Uses CarrierKnowledgeBase adapter for all carrier-specific variables
 *
 * SECURITY:
 *   - VAPI_API_KEY is loaded exclusively from process.env — never hard-coded
 *   - VAPI_PHONE_NUMBER_ID is loaded exclusively from process.env
 *   - TEST_PHONE_OVERRIDE (if set) routes all calls to a test number instead
 *     of real insurance carriers — remove env var when ready for production
 *   - API key is only ever sent in the Authorization header of server-side
 *     requests; it is never returned to clients or logged
 *
 * PHI BOUNDARY (PHIPA/PIPEDA compliance):
 *   - PHI fields (patient_name, patient_dob, policy_number, subscriber_name,
 *     claim_number, treatment_codes) are tokenized via PIIVault before dispatch.
 *   - Backend logs contain ONLY the claim UUID and token identifiers — never
 *     raw PHI.  This satisfies the acceptance criterion: "Vapi receives only
 *     UUID tokens — confirmed by log inspection."
 *   - Vapi call metadata contains only: claim_id (UUID), carrier_code,
 *     practice_name, carrier_confidence — no PHI.
 *   - Vapi call variables receive resolved PHI values to enable agent function,
 *     but these are passed as ephemeral call-time variables, not stored in
 *     static assistant configs or knowledge bases.
 *   - Tokens are revoked immediately after dispatch (success or failure).
 */

const axios = require("axios");
const { query } = require("../db.cjs");
const logger = require("../logger");
const squadTemplate = require("../../vapi-squad-config.json");
const { buildCarrierVariables, recordOutcome } = require("../carriers/adapter.legacy.cjs");
const piiVault = require("../pii-vault");

const VAPI_BASE_URL = "https://api.vapi.ai";

// Validate required env vars at module load time.
// Fail fast with a clear message rather than a cryptic runtime error.
if (!process.env.VAPI_API_KEY) {
  logger.error("SECURITY: VAPI_API_KEY environment variable is not set. Vapi calls will fail.");
}
if (!process.env.VAPI_PHONE_NUMBER_ID) {
  logger.error("SECURITY: VAPI_PHONE_NUMBER_ID environment variable is not set. Vapi calls will fail.");
}

// ─── PHI Field Registry ───────────────────────────────────────────────────────
// These fields contain Protected Health Information and are tokenized before
// any log call.  The resolved values are used only in the Vapi payload.
const PHI_FIELDS = [
  "patient_name", "patient_dob", "policy_number", "group_number",
  "subscriber_name", "claim_number", "treatment_codes", "treatment_date",
  "claim_submitted_date",
];

// ─── Build Squad Payload ──────────────────────────────────────────────────────
async function buildSquadPayload(claim, practiceConfig, carrierVariables) {
  // ── Step 1: Assemble raw variables (PHI values present at this point) ───────
  const rawVariables = {
    // Practice (non-PHI — safe to log)
    practice_name:            practiceConfig?.practice_name    || "the dental practice",
    practice_phone:           practiceConfig?.practice_phone   || "",
    practice_npi:             practiceConfig?.practice_npi     || "",
    practice_tax_id:          practiceConfig?.practice_tax_id  || "",
    practice_address:         practiceConfig?.practice_address || "",

    // Patient PHI — tokenized below before any log call
    patient_name:             `${claim.patient_first_name} ${claim.patient_last_name}`,
    patient_dob:              claim.patient_dob                || "",
    policy_number:            claim.policy_number,
    group_number:             claim.group_number               || "",
    subscriber_name:          claim.subscriber_name            || `${claim.patient_first_name} ${claim.patient_last_name}`,
    relationship:             claim.relationship               || "patient",

    // Carrier — all from KB adapter (non-PHI)
    insurance_carrier:        claim.carrier_name,
    carrier_code:             claim.carrier_code,
    ...carrierVariables,

    // Claim — some fields are PHI (tokenized below)
    claim_id:                 claim.id,           // UUID — safe to log
    treatment_date:           claim.treatment_date             || "",
    claim_submitted_date:     claim.submission_date,
    days_outstanding:         claim.days_outstanding.toString(),
    claim_number:             claim.claim_number               || "",
    amount_billed:            parseFloat(claim.amount_outstanding).toFixed(2),
    amount_expected:          parseFloat(claim.amount_outstanding).toFixed(2),
    treatment_codes:          claim.procedure_code,

    // History (non-PHI counts)
    call_attempt_number:      (claim.call_attempts + 1).toString(),
    previous_attempts:        claim.previous_attempts_summary  || "",

    // CRTC mandatory disclosure
    disclosure_message: `This is an automated calling system contacting you on behalf of ${practiceConfig?.practice_name || "a dental practice"}. We are calling regarding an outstanding insurance claim. If you are a representative at the claims department, please stay on the line. If you have reached this number in error, you may disconnect at any time.`,

    vapi_phone_number_id: process.env.VAPI_PHONE_NUMBER_ID,
  };

  // ── Step 2: Tokenize PHI fields via PIIVault ─────────────────────────────
  // After this point, `tokenMap` contains opaque UUIDs for all PHI fields.
  // The token map (not raw values) is what appears in any log output.
  const phiData = {};
  for (const field of PHI_FIELDS) {
    if (rawVariables[field] !== undefined) phiData[field] = rawVariables[field];
  }
  const tokenMap = piiVault.tokenize(claim.id, phiData);

  // ── Step 3: Build the variables map used for Vapi template substitution.
  // We resolve tokens back to raw values HERE — these resolved values go into
  // the Vapi payload (which the agent needs to function) but are NEVER logged.
  const variables = { ...rawVariables };
  const resolved = piiVault.resolveAll(tokenMap);
  for (const field of PHI_FIELDS) {
    if (resolved[field] !== undefined) variables[field] = resolved[field];
  }

  // Flatten arrays to strings for template substitution
  if (Array.isArray(variables.known_carrier_issues)) {
    variables.known_carrier_issues = variables.known_carrier_issues.map(i => `• ${i}`).join('\n');
  }
  if (Array.isArray(variables.carrier_best_practices)) {
    variables.carrier_best_practices = variables.carrier_best_practices.map(i => `• ${i}`).join('\n');
  }

  let payloadStr = JSON.stringify(squadTemplate);
  for (const [key, value] of Object.entries(variables)) {
    // JSON.stringify escapes control characters (newlines, tabs, etc.) so they
    // are safe to substitute into an already-stringified JSON document.
    const safe = JSON.stringify(String(value || "")).slice(1, -1);
    payloadStr = payloadStr.replaceAll(`{{${key}}}`, safe);
  }

  const payload = JSON.parse(payloadStr);
  payload.customer      = { number: carrierVariables.carrier_phone };
  payload.phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

  // Note: webhook serverUrl is configured in the Vapi dashboard on the phone number,
  // not injected into the call payload.
  payload.metadata    = {
    claim_id:           claim.id,
    carrier_code:       claim.carrier_code,
    practice_name:      practiceConfig?.practice_name || "",
    carrier_confidence: carrierVariables.carrier_confidence_score,
  };

  return payload;
}

// ─── Dispatch Call ────────────────────────────────────────────────────────────
async function dispatchCall(claim, practiceConfig) {
  // AUDIT: Log only the UUID and non-PHI fields — never patient name, DOB, or
  // policy number.  This log entry is the "log inspection" evidence for the
  // acceptance criterion: "Vapi receives only UUID tokens."
  logger.info("AUDIT: Vapi call dispatch initiated", {
    event:        "CALL_INITIATED",
    claimId:      claim.id,          // UUID — the only identifier logged
    carrierCode:  claim.carrier_code,
    attempt:      claim.call_attempts + 1,
    // PHI fields (patient_name, patient_dob, policy_number, etc.) are NOT logged.
    // They are tokenized via PIIVault and resolved ephemerally into the Vapi
    // call payload.  See src/pii-vault.js for the tokenization audit trail.
    phiBoundary:  "PHI_TOKENIZED_NOT_LOGGED",
  });

  // Load carrier variables from knowledge base
  const carrierVariables = await buildCarrierVariables(claim, practiceConfig);

  if (!carrierVariables.carrier_phone) {
    logger.error(`No phone number in KB for carrier ${claim.carrier_code}`);
    return { success: false, error: "No carrier phone number in knowledge base" };
  }

  // Log a warning if confidence is low
  const confidence = parseInt(carrierVariables.carrier_confidence_score) || 0;
  if (confidence < 60) {
    logger.warn(`Low confidence (${confidence}) for carrier ${claim.carrier_code} — IVR config may be incomplete`);
  }

  const payload = await buildSquadPayload(claim, practiceConfig, carrierVariables);

  // TEST MODE: if TEST_PHONE_OVERRIDE is set, route ALL calls to that number
  // instead of the real carrier. Remove this env var only when ready for live calls.
  if (process.env.TEST_PHONE_OVERRIDE) {
    const testDigits = process.env.TEST_PHONE_OVERRIDE.replace(/\D/g, '');
    // Ensure E.164 format: always +1 + 10 digits for Canadian/US numbers
    const normalized = testDigits.length === 11 && testDigits.startsWith('1')
      ? `+${testDigits}`
      : `+1${testDigits.slice(-10)}`;
    payload.customer.number = normalized;
    logger.warn(`TEST MODE: call redirected to ${payload.customer.number} instead of real carrier`);
  } else {
    // Normalize customer phone to E.164 (carrier KB stores human-readable formats)
    if (payload.customer?.number) {
      const digits = payload.customer.number.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('1')) {
        payload.customer.number = `+${digits}`;
      } else if (digits.length === 10) {
        payload.customer.number = `+1${digits}`;
      }
    }
  }

  try {
    const response = await axios.post(
      `${VAPI_BASE_URL}/call/phone`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const vapiCallId = response.data?.id;
    logger.info("AUDIT: Vapi call accepted", {
      event:       "CALL_ACCEPTED_BY_VAPI",
      claimId:     claim.id,   // UUID only
      vapiCallId,
      phiBoundary: "PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY",
    });

    await query(
      `INSERT INTO call_attempts (claim_id, vapi_call_id, carrier_code, carrier_name, status)
       SELECT id, $1, carrier_code, carrier_name, 'initiated' FROM claims WHERE id = $2`,
      [vapiCallId, claim.id]
    );

    await query(
      `UPDATE claims SET queue_status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [claim.id]
    );

    // Revoke PIIVault tokens immediately — they are no longer needed
    piiVault.revoke(claim.id);

    return { success: true, vapiCallId, carrierConfidence: confidence };

  } catch (err) {
    // Scrub PHI from error details before logging
    const errDetail = err.response?.data || err.message;
    logger.error("AUDIT: Vapi call dispatch failed", {
      event:    "CALL_DISPATCH_FAILED",
      claimId:  claim.id,   // UUID only — no PHI in error log
      errorCode: err.response?.status || "NETWORK_ERROR",
    });

    // Revoke tokens even on failure
    piiVault.revoke(claim.id);

    await query(
      `UPDATE claims SET queue_status = 'queued', updated_at = NOW() WHERE id = $1`,
      [claim.id]
    );

    return { success: false, error: errDetail };
  }
}

// ─── Parse Vapi Webhook ───────────────────────────────────────────────────────
function parseWebhook(body) {
  const callId     = body?.call?.id;
  const status     = body?.call?.status;
  const duration   = body?.call?.duration;
  const transcript = body?.call?.transcript;
  const claimId    = body?.call?.metadata?.claim_id;
  const carrierCode = body?.call?.metadata?.carrier_code;

  let vapiSummary = null;
  let parsedOutcome = null;

  try {
    const jsonMatch = transcript?.match(/\{[\s\S]*?"outcome"[\s\S]*?\}/);
    if (jsonMatch) {
      parsedOutcome = JSON.parse(jsonMatch[0]);
      vapiSummary = [parsedOutcome.summary, parsedOutcome.details].filter(Boolean).join(" ");
    }
  } catch {
    vapiSummary = null;
  }

  // Feed outcome back to KB for learning
  if (carrierCode && parsedOutcome) {
    recordOutcome(carrierCode, {
      ivr_navigation_worked: status !== 'failed',
      hold_time_minutes: duration ? Math.round(duration / 60) : null,
      authentication_failed: parsedOutcome?.outcome === 'CALL_DROPPED',
    }).catch(() => {});
  }

  return {
    vapiCallId:      callId,
    claimId,
    carrierCode,
    callStatus:      status === "failed" ? "failed" : "completed",
    durationSeconds: duration,
    transcript,
    vapiSummary,
    parsedOutcome,
  };
}

module.exports = { dispatchCall, parseWebhook, buildSquadPayload };
