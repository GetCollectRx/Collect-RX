/**
 * CollectRx Outcome Processor
 *
 * Receives the result of a completed Vapi call via webhook.
 * Classifies the outcome and triggers the appropriate next action:
 *
 *   OUTCOME CODES:
 *   - processing          → Carrier says claim is being processed. Schedule follow-up.
 *   - paid                → Payment confirmed issued. Mark resolved.
 *   - resubmit_required   → Claim not received or rejected. Trigger resubmission.
 *   - xray_required       → Carrier needs imaging. Escalate to clinic.
 *   - docs_required       → Carrier needs other clinical docs. Escalate to clinic.
 *   - coverage_maxed      → Annual max hit. Move to patient receivables.
 *   - not_covered         → Procedure not covered. Move to patient receivables.
 *   - appeal_required     → Unfair denial. Escalate for human appeal.
 *   - no_answer           → IVR or hold timeout. Retry later.
 *   - call_failed         → Technical failure. Retry later.
 *   - unknown             → Response didn't match known patterns. Escalate.
 */

const { query } = require("../db");
const logger = require("../logger");
const { scheduleNextAttempt, pauseClaim } = require("../queue/engine");
const { sendEscalation } = require("./escalation");

// ─── Outcome Classification ───────────────────────────────────────────────────
// Takes the raw Vapi transcript + end-of-call summary and returns an outcome code.
// In production, Vapi's assistant should be prompted to output a structured
// JSON summary. This function parses that summary.

function classifyOutcome(transcript, vapiSummary) {
  // Vapi should return a structured summary from the assistant.
  // We check the summary first, then fall back to keyword scanning the transcript.

  const text = [vapiSummary, transcript].filter(Boolean).join(' ').toLowerCase();

  if (!text) return "unknown";

  // Payment confirmed
  if (
    text.includes("payment issued") ||
    text.includes("cheque has been sent") ||
    text.includes("eft processed") ||
    text.includes("payment was processed") ||
    text.includes("payment sent")
  ) return "paid";

  // Still processing — most common response
  if (
    text.includes("still processing") ||
    text.includes("under review") ||
    text.includes("in adjudication") ||
    text.includes("being processed") ||
    text.includes("processing time") ||
    text.includes("5 to 10 business days") ||
    text.includes("7 to 10 business days")
  ) return "processing";

  // Claim not on file — needs resubmission
  if (
    text.includes("not on file") ||
    text.includes("no claim found") ||
    text.includes("not received") ||
    text.includes("please resubmit") ||
    text.includes("not in our system")
  ) return "resubmit_required";

  // X-ray / imaging required — ESCALATE
  if (
    text.includes("x-ray") ||
    text.includes("xray") ||
    text.includes("radiograph") ||
    text.includes("imaging required") ||
    text.includes("supporting documentation") && text.includes("radiograph")
  ) return "xray_required";

  // Other clinical documentation required — ESCALATE
  if (
    text.includes("clinical notes") ||
    text.includes("chart notes") ||
    text.includes("treatment notes required") ||
    text.includes("documentation required") ||
    text.includes("predetermination required")
  ) return "docs_required";

  // Coverage maxed
  if (
    text.includes("maximum benefit") ||
    text.includes("annual maximum") ||
    text.includes("benefit limit") ||
    text.includes("maximum has been reached") ||
    text.includes("no remaining benefit")
  ) return "coverage_maxed";

  // Not covered
  if (
    text.includes("not a covered") ||
    text.includes("not covered") ||
    text.includes("excluded procedure") ||
    text.includes("not eligible") ||
    text.includes("not a benefit")
  ) return "not_covered";

  // Appeal situation
  if (
    text.includes("appeal") ||
    text.includes("reconsideration") ||
    text.includes("dispute") ||
    text.includes("internal review")
  ) return "appeal_required";

  // No answer / IVR failure
  if (
    text.includes("no answer") ||
    text.includes("busy signal") ||
    text.includes("hold timeout") ||
    text.includes("call dropped") ||
    text.includes("could not connect")
  ) return "no_answer";

  // Carrier block — automated calling detected and rejected by carrier
  // Triggered when carrier IVR or rep explicitly says they are blocking or
  // flagging our number, or when the JSON summary contains CARRIER_BLOCK.
  if (
    text.includes("carrier_block") ||
    text.includes("your calls are being blocked") ||
    text.includes("automated calling is not permitted") ||
    text.includes("this number has been flagged") ||
    text.includes("call blocking") ||
    text.includes("number is blocked") ||
    text.includes("please do not call again") ||
    text.includes("calls from this number will not be accepted")
  ) return "carrier_block";

  return "unknown";
}

// ─── Process Outcome ──────────────────────────────────────────────────────────
// Main function called by the Vapi webhook handler.

async function processOutcome({ claimId, vapiCallId, transcript, vapiSummary, durationSeconds, callStatus }) {
  logger.info(`Processing outcome for claim ${claimId}`, { vapiCallId, callStatus });

  const outcomeCode = callStatus === "failed" ? "call_failed" : classifyOutcome(transcript, vapiSummary);
  logger.info(`Outcome classified: ${outcomeCode}`, { claimId });

  // Log the call attempt
  const attemptResult = await query(
    `INSERT INTO call_attempts
       (claim_id, vapi_call_id, carrier_code, carrier_name, ended_at, duration_seconds, status, outcome_code, outcome_summary, transcript)
     SELECT
       id, $1, carrier_code, carrier_name, NOW(), $2, $3, $4, $5, $6
     FROM claims WHERE id = $7
     RETURNING id`,
    [vapiCallId, durationSeconds, callStatus || "completed", outcomeCode, vapiSummary, transcript, claimId]
  );
  const attemptId = attemptResult.rows[0]?.id;

  // Increment attempt counter on claim
  await query(
    `UPDATE claims
     SET call_attempts = call_attempts + 1,
         last_called_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [claimId]
  );

  // Route based on outcome
  switch (outcomeCode) {

    case "paid":
      await resolveClaim(claimId, "paid", "Payment confirmed by carrier during call.");
      break;

    case "processing":
      // Retry in 3 business days (72 hours)
      await scheduleNextAttempt(claimId, 72);
      logger.info(`Claim ${claimId} still processing — retry in 72h`);
      break;

    case "resubmit_required":
      await resolveClaim(claimId, "resubmitted", "Claim not found by carrier — flagged for resubmission.");
      await sendEscalation({
        claimId,
        attemptId,
        reason: "resubmit_required",
        details: "Carrier has no record of this claim. The claim needs to be resubmitted from AbelDent.",
      });
      break;

    case "xray_required":
      await pauseClaim(claimId, "Carrier requires radiographic documentation before adjudication.");
      await query(
        `UPDATE call_attempts SET escalation_required = TRUE, escalation_reason = $1 WHERE id = $2`,
        ["xray_required", attemptId]
      );
      await sendEscalation({
        claimId,
        attemptId,
        reason: "xray_required",
        details: "Carrier is requesting pre-operative radiographic documentation. Please pull x-rays and resubmit.",
        urgent: true,
      });
      break;

    case "docs_required":
      await pauseClaim(claimId, "Carrier requires additional clinical documentation.");
      await sendEscalation({
        claimId,
        attemptId,
        reason: "docs_required",
        details: "Carrier is requesting clinical notes or treatment documentation. Please review and resubmit.",
        urgent: true,
      });
      break;

    case "coverage_maxed":
      await resolveClaim(claimId, "patient_receivable", "Annual maximum exhausted — moved to patient receivables.");
      await sendEscalation({
        claimId,
        attemptId,
        reason: "coverage_maxed",
        details: "Patient's annual benefit maximum has been reached. Outstanding balance should be billed directly to patient.",
        urgent: false,
      });
      break;

    case "not_covered":
      await resolveClaim(claimId, "patient_receivable", "Procedure not covered — moved to patient receivables.");
      await sendEscalation({
        claimId,
        attemptId,
        reason: "not_covered",
        details: "Carrier confirmed this procedure is not a covered benefit. Patient should be billed directly.",
        urgent: false,
      });
      break;

    case "appeal_required":
      await pauseClaim(claimId, "Carrier denial may be appealable — requires human review.");
      await sendEscalation({
        claimId,
        attemptId,
        reason: "appeal_required",
        details: "Carrier response suggests an appeal or reconsideration may be appropriate. Human review required.",
        urgent: true,
      });
      break;

    case "no_answer":
    case "call_failed":
      // Check if we've hit max attempts
      const claimResult = await query(`SELECT call_attempts FROM claims WHERE id = $1`, [claimId]);
      const attempts = claimResult.rows[0]?.call_attempts || 0;

      if (attempts >= parseInt(process.env.QUEUE_MAX_ATTEMPTS_BEFORE_REVIEW || 3)) {
        await query(
          `UPDATE claims SET queue_status = 'max_attempts', updated_at = NOW() WHERE id = $1`,
          [claimId]
        );
        await sendEscalation({
          claimId,
          attemptId,
          reason: "max_attempts",
          details: `Agent has attempted this claim ${attempts} times without resolution. Manual follow-up required.`,
          urgent: false,
        });
      } else {
        // Retry in 4 hours
        await scheduleNextAttempt(claimId, 4);
      }
      break;

    case "carrier_block":
      // Carrier has blocked or flagged our number — suspend ALL calls practice-wide.
      await suspendAllQueuedClaims(claimId, "CARRIER_BLOCK: carrier has flagged or blocked outbound calls.");
      await sendEscalation({
        claimId,
        attemptId,
        reason: "carrier_block",
        details: "The carrier indicated that automated calls from this number are blocked or flagged. ALL queued claims have been suspended practice-wide. Manual intervention is required before calls can resume.",
        urgent: true,
      });
      logger.warn(`CARRIER_BLOCK detected on claim ${claimId} — all queued claims suspended`);
      break;

    case "unknown":
    default:
      // Unexpected response — don't keep retrying blindly, escalate
      await pauseClaim(claimId, "Unclassified carrier response — human review needed.");
      await sendEscalation({
        claimId,
        attemptId,
        reason: "unknown_response",
        details: `Agent received an unexpected response from carrier. Transcript: ${transcript?.slice(0, 500)}`,
        urgent: false,
      });
      break;
  }

  return { outcomeCode, attemptId };
}

// ─── Suspend All Queued Claims (CARRIER_BLOCK) ────────────────────────────────
// Pauses every queued/in-progress claim practice-wide so no further automated
// calls are dispatched until staff reviews the situation and manually unpauses.
async function suspendAllQueuedClaims(triggerClaimId, reason) {
  // Identify which practice the triggering claim belongs to
  const claimRow = await query(
    `SELECT practice_id FROM claims WHERE id = $1`,
    [triggerClaimId]
  );
  const practiceId = claimRow.rows[0]?.practice_id;

  const whereClause = practiceId
    ? `WHERE queue_status IN ('queued', 'in_progress') AND practice_id = $1`
    : `WHERE queue_status IN ('queued', 'in_progress')`;
  const params = practiceId ? [practiceId] : [];

  const result = await query(
    `UPDATE claims
     SET queue_status = 'paused',
         notes = COALESCE(notes, '') || $${params.length + 1},
         updated_at = NOW()
     ${whereClause}`,
    [...params, `\n[CARRIER_BLOCK SUSPENSION: ${reason} at ${new Date().toISOString()}]`]
  );

  logger.warn(`CARRIER_BLOCK suspension: paused ${result.rowCount} claims (practice_id=${practiceId ?? 'all'})`);

  // Record the block event in escalations
  await query(
    `INSERT INTO escalations (claim_id, reason, details, status)
     VALUES ($1, 'carrier_block', $2, 'open')`,
    [
      triggerClaimId,
      `CARRIER_BLOCK event at ${new Date().toISOString()}. ${result.rowCount} claims suspended practice-wide. ${reason}`,
    ]
  );
}

// ─── Resolve Claim ────────────────────────────────────────────────────────────
async function resolveClaim(claimId, resolutionType, notes) {
  await query(
    `UPDATE claims
     SET queue_status = 'resolved',
         resolution_type = $1,
         resolved_at = NOW(),
         notes = COALESCE(notes, '') || $2,
         updated_at = NOW()
     WHERE id = $3`,
    [resolutionType, `\n[RESOLVED: ${notes} at ${new Date().toISOString()}]`, claimId]
  );
  logger.info(`Claim ${claimId} resolved as: ${resolutionType}`);
}

module.exports = { processOutcome, classifyOutcome, suspendAllQueuedClaims };
