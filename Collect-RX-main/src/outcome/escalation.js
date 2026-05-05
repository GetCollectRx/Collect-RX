/**
 * CollectRx Escalation Handler
 *
 * When the agent can't resolve a claim autonomously, this fires a notification
 * to the front desk with everything they need to take action.
 *
 * 1. DB row (source of truth)
 * 2. Immediate staff SMS + optional voice (Twilio) — no dependency on Slack
 * 3. Webhook (Slack/Teams/custom) when configured
 */

const axios = require("axios");
const twilioSdk = require("twilio");
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

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return null;
  return twilioSdk(sid, token);
}

/** E.164 for CA/US-style numbers in env (comma-separated supported). */
function normalizeToE164(raw) {
  if (!raw || typeof raw !== "string") return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length >= 10 && raw.trim().startsWith("+")) return `+${d}`;
  return "";
}

function parseStaffPhones() {
  const raw = (process.env.ESCALATION_STAFF_PHONE || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => normalizeToE164(s.trim()))
    .filter(Boolean);
}

/** urgent | all | never — default urgent so the desk phone rings on serious AI/human handoffs only */
function staffVoiceRingMode() {
  const v = String(process.env.ESCALATION_STAFF_VOICE_RING || "urgent").toLowerCase();
  if (v === "all" || v === "always" || v === "1") return "all";
  if (v === "never" || v === "off" || v === "0" || v === "false") return "never";
  return "urgent";
}

function shouldRingVoice(urgent) {
  const mode = staffVoiceRingMode();
  if (mode === "never") return false;
  if (mode === "all") return true;
  return !!urgent;
}

function escapeForTwiMLSay(text) {
  return String(text || "")
    .replace(/&/g, " and ")
    .replace(/</g, " ")
    .replace(/>/g, " ")
    .replace(/"/g, " ")
    .replace(/'/g, " ")
    .slice(0, 450);
}

/**
 * Immediate front-desk path: SMS (always when Twilio + numbers configured) and
 * optional outbound voice so a desk line actually rings.
 */
async function alertEscalationStaffImmediate({
  urgent,
  escalationId,
  reason,
  label,
  smsBody,
  voiceLine,
}) {
  const phones = parseStaffPhones();
  const client = getTwilioClient();
  if (!phones.length) {
    return;
  }
  if (!client) {
    logger.error(
      "ESCALATION_STAFF_PHONE is set but Twilio is not fully configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER) — staff will NOT get instant SMS/voice"
    );
    return;
  }

  const from = process.env.TWILIO_FROM_NUMBER;
  const ring = shouldRingVoice(urgent);
  const sayText =
    escapeForTwiMLSay(
      voiceLine ||
        `CollectRx needs the front desk. ${label || reason || "Escalation"}. Reference ${escalationId || "unknown"}.`
    );
  const twiml = `<Response><Say voice="Polly.Joanna">${sayText}</Say></Response>`;

  const tasks = [];
  for (const to of phones) {
    tasks.push(
      client.messages.create({
        to,
        from,
        body: String(smsBody).slice(0, 1600),
      })
    );
    if (ring) {
      tasks.push(
        client.calls.create({
          to,
          from,
          twiml,
        })
      );
    }
  }

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    logger.error("Escalation staff Twilio notify partial failure", {
      escalationId,
      failed: failed.length,
      errors: failed.map((f) => f.reason?.message || String(f.reason)),
    });
  } else {
    logger.info("Escalation staff Twilio notify sent", {
      escalationId,
      phones: phones.length,
      voiceRing: ring,
    });
  }
}

/**
 * Manual / API-only escalations (e.g. carrier block) where there is no claim row in sendEscalation.
 */
async function alertEscalationStaffImmediateRaw({
  urgent = true,
  escalationId,
  title,
  detail,
}) {
  const smsBody = [
    urgent ? "URGENT CollectRx — " : "CollectRx — ",
    title || "Action required",
    escalationId ? `\nRef: ${escalationId}` : "",
    "\nOpen CollectRx for full details.",
  ].join("");
  const voiceLine = `${title || "CollectRx alert"}. Reference ${escalationId || "unknown"}.`.slice(0, 400);
  await alertEscalationStaffImmediate({
    urgent,
    escalationId,
    reason: "manual",
    label: title,
    smsBody,
    voiceLine,
  });
}

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
  const message = buildEscalationWebhookPayload({ reason, label, urgent, escalationId, claimId: claim.id });

  // SMS: IDs + reason only — names, policy, procedures, and amounts stay in the app (HIPAA / non-BAA channels).
  const smsBody = [
    urgent ? "URGENT — CollectRx escalation\n" : "CollectRx escalation\n",
    `${label}\n`,
    `Ref: ${escalationId}\n`,
    `Claim: ${claim.id}\n`,
    `\nOpen CollectRx for patient and financial details.`,
  ].join("");

  const voiceLine = `${urgent ? "Urgent. " : ""}CollectRx. ${label.replace(/[^\w\s.-]/g, "")}. Claim ${String(claim.id).slice(0, 8)}. Please open CollectRx.`;

  await alertEscalationStaffImmediate({
    urgent,
    escalationId,
    reason,
    label,
    smsBody,
    voiceLine,
  });

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

/**
 * Slack/Teams webhook payload without PHI (no names, policy, procedure text, amounts, or free-text details).
 * Use only after a BAA covers the vendor if you re-introduce identifiers or clinical/financial fields.
 */
function buildEscalationWebhookPayload({ reason, label, urgent, escalationId, claimId }) {
  return {
    text: urgent ? "🚨 *URGENT: CollectRx Escalation*" : "📬 *CollectRx Escalation*",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: urgent ? `🚨 ${label}` : label },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Escalation #:*\n${escalationId}` },
          { type: "mrkdwn", text: `*Claim ID:*\n${claimId}` },
          { type: "mrkdwn", text: `*Reason code:*\n${reason}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Next step:*\nOpen CollectRx in the browser for full claim and patient context. This notification intentionally omits PHI.",
        },
      },
      { type: "divider" },
    ],
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

module.exports = {
  sendEscalation,
  getOpenEscalations,
  acknowledgeEscalation,
  resolveEscalation,
  alertEscalationStaffImmediateRaw,
};
