/**
 * CollectRx — Carrier Knowledge Base Adapter
 *
 * Bridges your existing CarrierKnowledgeBase JSON configs
 * into the variables the Vapi Squad payload needs.
 *
 * Takes a carrier JSON + claim object and produces:
 *   - carrier_ivr_instructions  → feeds IVR_Navigator
 *   - carrier_specific_notes    → feeds Claims_Agent
 *   - known_carrier_issues      → feeds Claims_Agent
 *   - carrier_best_practices    → feeds Claims_Agent
 *   - hold_limit_minutes        → cost control for IVR_Navigator
 *   - phone_number              → who Vapi actually calls
 *   - practice config           → authentication fields
 */

const CarrierKnowledgeBase = require('./knowledge-base.cjs');
const logger = require('../logger');

// Singleton KB instance — loaded once at startup
let _kb = null;

async function getKB() {
  if (!_kb) {
    _kb = new CarrierKnowledgeBase('./carriers');
    await _kb.loadCarriers();
    logger.info('Carrier knowledge base loaded', { stats: _kb.getStats() });
  }
  return _kb;
}

// ─── IVR Instructions Formatter ───────────────────────────────────────────────
// Converts the structured ivr_navigation.steps array into a plain-English
// instruction string the IVR_Navigator assistant can follow step by step.

function formatIVRInstructions(carrier) {
  const nav = carrier.ivr_navigation;
  if (!nav || !nav.steps || nav.steps.length === 0) {
    return 'No specific IVR instructions available. Listen carefully to the menu and select the option for claims or provider services.';
  }

  const lines = [];

  lines.push(`IVR TYPE: ${nav.ivr_type || 'touchtone'}`);
  lines.push('');
  lines.push('NAVIGATION STEPS:');

  for (const step of nav.steps) {
    lines.push(`Step ${step.step_number}:`);
    lines.push(`  IVR says: "${step.expected_prompt}"`);
    lines.push(`  Action: ${step.action}`);
    if (step.alternative_actions && step.alternative_actions.length > 0) {
      lines.push(`  Alternative: ${step.alternative_actions.join(' or ')}`);
    }
    if (step.notes) {
      lines.push(`  ⚠️  Note: ${step.notes}`);
    }
    if (step.wait_time) {
      lines.push(`  Wait: ~${step.wait_time} seconds`);
    }
    lines.push('');
  }

  if (nav.shortcuts && nav.shortcuts.length > 0) {
    lines.push('SHORTCUTS:');
    for (const s of nav.shortcuts) {
      lines.push(`  ${s.shortcut} → ${s.destination}`);
    }
    lines.push('');
  }

  if (nav.last_verified) {
    lines.push(`Last verified: ${nav.last_verified}`);
  }

  return lines.join('\n');
}

// ─── Carrier-Specific Notes Formatter ────────────────────────────────────────
// Builds the carrier-specific guidance section for Claims_Agent.
// Includes tone, key phrases, things to avoid, and escalation triggers.

function formatCarrierNotes(carrier) {
  const guidance = carrier.ai_agent_guidance;
  if (!guidance) return '';

  const lines = [];

  if (guidance.representative_script_hints) {
    lines.push(`REPRESENTATIVE BEHAVIOUR: ${guidance.representative_script_hints}`);
    lines.push('');
  }

  if (guidance.tone) {
    lines.push(`RECOMMENDED TONE: ${guidance.tone}`);
    lines.push('');
  }

  // Hours and best times
  if (carrier.contact_info?.hours_of_operation) {
    lines.push(`HOURS: ${carrier.contact_info.hours_of_operation}`);
  }
  if (carrier.call_metrics?.best_times_to_call?.length > 0) {
    lines.push(`BEST TIMES TO CALL: ${carrier.call_metrics.best_times_to_call.join(', ')}`);
  }
  if (carrier.call_metrics?.average_hold_time_minutes) {
    lines.push(`AVERAGE HOLD TIME: ${carrier.call_metrics.average_hold_time_minutes} minutes`);
  }
  lines.push('');

  return lines.join('\n');
}

function formatKnownIssues(carrier) {
  const guidance = carrier.ai_agent_guidance;
  const processing = carrier.claim_processing;
  const issues = [];

  // Avoid phrases become known issues
  if (guidance?.avoid_phrases?.length > 0) {
    for (const phrase of guidance.avoid_phrases) {
      issues.push(`DO NOT SAY: ${phrase}`);
    }
  }

  // Top denial reasons
  if (processing?.common_denial_reasons?.length > 0) {
    const topDenials = processing.common_denial_reasons
      .filter(d => d.frequency === 'very_common' || d.frequency === 'common')
      .slice(0, 4);
    for (const denial of topDenials) {
      issues.push(`Common denial — ${denial.code}: "${denial.description}" → ${denial.resolution}`);
    }
  }

  // CDCP-specific issues
  if (carrier.cdcp_specific?.common_eligibility_issues?.length > 0) {
    for (const issue of carrier.cdcp_specific.common_eligibility_issues.slice(0, 3)) {
      issues.push(`CDCP eligibility issue: ${issue}`);
    }
  }

  return issues;
}

function formatBestPractices(carrier) {
  const guidance = carrier.ai_agent_guidance;
  const practices = [];

  if (guidance?.key_phrases?.length > 0) {
    for (const phrase of guidance.key_phrases) {
      practices.push(`Use phrase: "${phrase}"`);
    }
  }

  if (guidance?.escalation_triggers?.length > 0) {
    for (const trigger of guidance.escalation_triggers) {
      practices.push(`Escalate if: ${trigger}`);
    }
  }

  // Required attachments — agent needs to know what docs may be needed
  const attachments = carrier.claim_processing?.required_attachments || [];
  if (attachments.length > 0) {
    practices.push(`Common required docs: ${attachments.join(', ')}`);
  }

  return practices;
}

// ─── Hold Limit ───────────────────────────────────────────────────────────────
// Determines max hold time in minutes based on claim value and carrier metrics.

function getHoldLimitMinutes(carrier, amountOutstanding) {
  const amount = parseFloat(amountOutstanding) || 0;
  const avgHold = carrier.call_metrics?.average_hold_time_minutes || 15;

  // Base limit: slightly above carrier average, capped by claim value
  let limit = Math.min(avgHold + 5, 15);

  // High-value claims get more patience
  if (amount >= 1000) limit = Math.min(avgHold + 10, 20);

  // CDCP has notoriously long holds — give it more room
  if (carrier.carrier_type === 'CDCP') limit = Math.min(limit + 10, 25);

  return limit;
}

// ─── Authentication Block ─────────────────────────────────────────────────────
// Formats auth requirements for the IVR_Navigator and Claims_Agent.

function formatAuthBlock(carrier, practiceConfig) {
  const auth = carrier.authentication;
  if (!auth) return '';

  const lines = ['AUTHENTICATION REQUIREMENTS:'];

  if (auth.required_fields?.length > 0) {
    for (const field of auth.required_fields) {
      const value = practiceConfig?.[field] || `[${field.toUpperCase()}]`;
      lines.push(`  ${field}: ${value}`);
    }
  }

  if (auth.notes) {
    lines.push(`  Note: ${auth.notes}`);
  }

  if (auth.patient_lookup_fields?.length > 0) {
    lines.push(`  Patient lookup uses: ${auth.patient_lookup_fields.join(', ')}`);
  }

  return lines.join('\n');
}

// ─── Main Adapter Function ────────────────────────────────────────────────────
// This is what the Vapi client calls instead of building variables manually.
// Returns an object ready to be merged into buildSquadPayload().

async function buildCarrierVariables(claim, practiceConfig) {
  const kb = await getKB();

  // Find carrier — try by carrier_code first, then by name
  let carrier = kb.getCarrier(claim.carrier_code?.toLowerCase());
  if (!carrier) {
    carrier = kb.findCarrierByName(claim.carrier_name);
  }

  if (!carrier) {
    logger.warn(`No carrier config found for ${claim.carrier_code} / ${claim.carrier_name}. Using defaults.`);
    return buildDefaultVariables(claim, practiceConfig);
  }

  logger.info(`Carrier config loaded: ${carrier.carrier_id}`, {
    confidence: carrier.metadata?.confidence_score,
    lastVerified: carrier.ivr_navigation?.last_verified,
  });

  // Warn if config is stale (over 90 days)
  const lastVerified = carrier.ivr_navigation?.last_verified;
  if (lastVerified) {
    const daysSince = Math.floor((Date.now() - new Date(lastVerified)) / (1000 * 60 * 60 * 24));
    if (daysSince > 90) {
      logger.warn(`Carrier config for ${carrier.carrier_id} is ${daysSince} days old — IVR may have changed`);
    }
  }

  return {
    // Core contact
    carrier_phone:            carrier.contact_info?.provider_phone || '',
    carrier_fax:              carrier.contact_info?.fax || '',
    carrier_portal_url:       carrier.contact_info?.portal_url || '',
    insurance_address:        carrier.contact_info?.email || '',

    // IVR — feeds directly into IVR_Navigator system prompt
    carrier_ivr_instructions: formatIVRInstructions(carrier),
    hold_limit_minutes:       getHoldLimitMinutes(carrier, claim.amount_outstanding).toString(),

    // Authentication — feeds into IVR_Navigator and Claims_Agent
    auth_block:               formatAuthBlock(carrier, practiceConfig),

    // Claims_Agent carrier-specific context
    carrier_specific_notes:   formatCarrierNotes(carrier),
    known_carrier_issues:     formatKnownIssues(carrier),
    carrier_best_practices:   formatBestPractices(carrier),

    // Claim processing context
    typical_processing_days:  carrier.claim_processing?.typical_processing_time_days?.toString() || '15',
    follow_up_threshold_days: carrier.claim_processing?.follow_up_threshold_days?.toString() || '30',

    // CDCP flag
    is_cdcp:                  (carrier.carrier_type === 'CDCP').toString(),
    cdcp_copay_tiers:         carrier.cdcp_specific?.copay_tiers?.join(', ') || '',

    // Metadata
    carrier_confidence_score: carrier.metadata?.confidence_score?.toString() || '50',
    carrier_type:             carrier.carrier_type,
  };
}

// ─── Default Variables ────────────────────────────────────────────────────────
// Used when no carrier config is found — generic fallback.

function buildDefaultVariables(claim, practiceConfig) {
  logger.warn(`Using default carrier variables for ${claim.carrier_name}`);
  return {
    carrier_phone:            '',
    carrier_fax:              '',
    carrier_portal_url:       '',
    insurance_address:        '',
    carrier_ivr_instructions: 'No specific IVR instructions available. Listen carefully to all menu options. Select the option for dental provider services or claims. When asked to enter information, enter digits individually. Stay on the line until a human representative answers.',
    hold_limit_minutes:       '8',
    auth_block:               '',
    carrier_specific_notes:   'No carrier-specific notes available. Follow standard protocol.',
    known_carrier_issues:     [],
    carrier_best_practices:   [],
    typical_processing_days:  '15',
    follow_up_threshold_days: '30',
    is_cdcp:                  'false',
    cdcp_copay_tiers:         '',
    carrier_confidence_score: '0',
    carrier_type:             'PRIVATE',
  };
}

// ─── Lookup denial resolution ─────────────────────────────────────────────────
// Called by outcome processor when a denial code comes back from the carrier.

async function getDenialResolution(carrierCode, denialCode) {
  const kb = await getKB();
  const carrier = kb.getCarrier(carrierCode?.toLowerCase()) || kb.findCarrierByName(carrierCode);
  if (!carrier) return 'Unknown carrier — manual review required';
  return kb.findDenialResolution(carrier.carrier_id, denialCode);
}

// ─── Record call outcome back to KB ──────────────────────────────────────────
// Feeds outcomes back into the KB so it improves over time.

async function recordOutcome(carrierCode, outcome) {
  try {
    const kb = await getKB();
    const carrier = kb.getCarrier(carrierCode?.toLowerCase());
    if (!carrier) return;
    await kb.recordCallOutcome(carrier.carrier_id, outcome);
  } catch (err) {
    logger.error('Failed to record call outcome to KB', { error: err.message });
  }
}

// ─── KB Stats ─────────────────────────────────────────────────────────────────
async function getKBStats() {
  const kb = await getKB();
  return kb.getStats();
}

module.exports = {
  buildCarrierVariables,
  getDenialResolution,
  recordOutcome,
  getKBStats,
  formatIVRInstructions,
  formatCarrierNotes,
};
