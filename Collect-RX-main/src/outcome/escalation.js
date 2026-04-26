/**
 * CollectRx Escalation Handler
 *
 * When the agent can't resolve a claim autonomously, this fires a notification
 * to the front desk with everything they need to take action.
 *
 * Currently supports webhook (Slack/Teams/custom) and logs to DB.
 * Easy to extend with email (SendGrid) later.
 */

const axios = require("axios");
const { query } = require("../db");
const logger = require("../logger");

const REASON_LABELS = {
  xray_required:     "📋 X-Ray Required",
  docs_required:     "📋 Documentation Required",
  resubmit_required: "🔄 Resubmission Required",
  coverage_maxed:    "💰 Coverage Maxed — Bill Patient",
  not_covered:       "💰 Not Covered — Bill Patient",
  appeal_required:   "⚖️ Appeal May Be Required",
  max_attempts:      "🔁 Max Attempts Reached",
  unknown_response:  "❓ Unexpected Carrier Response",
  carrier_block:     "🚫 CARRIER BLOCK — All Calls Suspended",
};

async function sendEscalation({ claimId, attemptId, reason, details, urgent = false }) {
  logger.info(`Sending escalation for claim ${claimId}`, { reason, urgent });

  // Fetch claim details for the notification
  const claimResult = await query(
    `SELECT c.*, ca.transcript, ca.outcome_summary
     FROM claims c
     LEFT JOIN call_attempts ca ON ca.id = $1
     WHERE c.id = $2`,
    [attemptId, claimId]
  );
  const claim = claimResult.rows[0];
  if (!claim) {
    logger.error(`Cannot escalate — claim ${claimId} not found`);
    return;
  }

  // Save escalation to DB
  const escResult = await query(
    `INSERT INTO escalations (claim_id, call_attempt_id, reason, details, status)
     VALUES ($1, $2, $3, $4, 'open')
     RETURNING id`,
    [claimId, attemptId, reason, details]
  );
  const escalationId = escResult.rows[0]?.id;

  // Build notification payload
  const label = REASON_LABELS[reason] || "⚠️ Action Required";
  const message = buildEscalationMessage({ claim, reason, details, label, urgent, escalationId });

  // Fire webhook if configured (Slack, Teams, or custom endpoint)
  const webhookUrl = process.env.ESCALATION_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await axios.post(webhookUrl, message);
      logger.info(`Escalation webhook sent for claim ${claimId}`);
    } catch (err) {
      logger.error(`Escalation webhook failed for claim ${claimId}`, { error: err.message });
      // Don't throw — escalation is still saved in DB
    }
  }

  return escalationId;
}

function buildEscalationMessage({ claim, reason, details, label, urgent, escalationId }) {
  // Slack-compatible webhook format
  // Swap this out for Teams adaptive card or plain JSON as needed
  return {
    text: urgent ? "🚨 *URGENT: CollectRx Escalation*" : "📬 *CollectRx Escalation*",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: urgent ? `🚨 ${label}` : label }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Claim ID:*\n${claim.id}` },
          { type: "mrkdwn", text: `*Patient:*\n${claim.patient_first_name} ${claim.patient_last_name}` },
          { type: "mrkdwn", text: `*Carrier:*\n${claim.carrier_name}` },
          { type: "mrkdwn", text: `*Policy:*\n${claim.policy_number}` },
          { type: "mrkdwn", text: `*Outstanding:*\n$${parseFloat(claim.amount_outstanding).toFixed(2)}` },
          { type: "mrkdwn", text: `*Days Outstanding:*\n${claim.days_outstanding} days` },
          { type: "mrkdwn", text: `*Procedure:*\n${claim.procedure_code} — ${claim.procedure_description}` },
          { type: "mrkdwn", text: `*Escalation #:*\n${escalationId}` },
        ]
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Action Required:*\n${details}` }
      },
      { type: "divider" }
    ]
  };
}

// Get open escalations (for dashboard)
async function getOpenEscalations() {
  const result = await query(
    `SELECT e.*, c.patient_first_name, c.patient_last_name, c.carrier_name,
            c.amount_outstanding, c.days_outstanding, c.procedure_code
     FROM escalations e
     JOIN claims c ON c.id = e.claim_id
     WHERE e.status = 'open'
     ORDER BY e.created_at DESC`
  );
  return result.rows;
}

// Acknowledge an escalation (front desk has seen it)
async function acknowledgeEscalation(escalationId, assignedTo) {
  await query(
    `UPDATE escalations
     SET status = 'acknowledged', assigned_to = $1
     WHERE id = $2`,
    [assignedTo, escalationId]
  );
}

// Resolve an escalation
async function resolveEscalation(escalationId, resolutionNotes) {
  await query(
    `UPDATE escalations
     SET status = 'resolved', resolved_at = NOW(), resolution_notes = $1
     WHERE id = $2`,
    [resolutionNotes, escalationId]
  );
}

module.exports = { sendEscalation, getOpenEscalations, acknowledgeEscalation, resolveEscalation };
