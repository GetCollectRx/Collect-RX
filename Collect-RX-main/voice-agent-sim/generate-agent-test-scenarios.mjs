#!/usr/bin/env node
/**
 * Generate comprehensive agent test scenarios
 * Based on DENTAL-INSURANCE-SCENARIOS.md
 *
 * Generates hundreds of test cases for:
 * - IVR_Navigator (menu navigation)
 * - Claims_Agent (claim status conversation)
 * - Escalation_Closer (dispute handling)
 * - Resolution_Closer (payment verification)
 * - Hold_Sentinel (hold music/queue handling)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CARRIERS = ['sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus'];

const CLAIM_TYPES = {
  preventive: { code: 'P', premium: 'P001-P003' },
  basic: { code: 'B', premium: 'B001-B004' },
  major: { code: 'M', premium: 'M001-M004' },
  ortho: { code: 'O', premium: 'O001-O002' },
};

const STATUS_TYPES = ['status', 'pending', 'denied', 'partial'];
const DENIAL_REASONS = ['pre-existing', 'frequency', 'missing-preauth', 'not-covered', 'deductible'];

/**
 * IVR Navigator scenarios — DTMF menu navigation
 */
function generateIVRScenarios() {
  const scenarios = [];
  const ivrId = (i) => `IVR-${String(i).padStart(3, '0')}`;

  // Menu navigation variants per carrier
  CARRIERS.forEach((carrier) => {
    // Standard menu navigation (claim status path)
    scenarios.push({
      id: ivrId(scenarios.length + 1),
      agent: 'IVR_Navigator',
      carrier,
      claimType: 'any',
      layer: 'ivr',
      harness: 'voice_agent_sim',
      scenario: 'menu_navigation_claim_status',
      description: `Navigate ${carrier} menu to claims status queue`,
      expectedPath: ['main_menu', 'provider_option', 'claims_status', 'queue'],
      expectedDuration: '2-3 min',
      passCriteria: 'Reaches claims status queue without dropping call',
      status: 'planned',
    });

    // Hold music patience test
    scenarios.push({
      id: ivrId(scenarios.length + 1),
      agent: 'Hold_Sentinel',
      carrier,
      claimType: 'any',
      layer: 'hold',
      harness: 'voice_agent_sim',
      scenario: 'hold_music_extended',
      description: `Silently hold through ${carrier} queue music (3+ min)`,
      expectedPath: ['queue', 'hold_music', 'wait_signal'],
      expectedDuration: '3-5 min',
      passCriteria: 'No spurious speech; silent until rep greeting',
      status: 'planned',
    });

    // Invalid menu selection recovery
    scenarios.push({
      id: ivrId(scenarios.length + 1),
      agent: 'IVR_Navigator',
      carrier,
      claimType: 'any',
      layer: 'ivr',
      harness: 'voice_agent_sim',
      scenario: 'menu_invalid_selection_recovery',
      description: `Recover from invalid menu selection on ${carrier}`,
      expectedPath: ['main_menu', 'invalid_selection', 'error_message', 'retry'],
      expectedDuration: '1-2 min',
      passCriteria: 'Re-attempts after error without hanging up',
      status: 'planned',
    });
  });

  return scenarios;
}

/**
 * Claims_Agent scenarios — Status inquiry conversations
 */
function generateClaimsAgentScenarios() {
  const scenarios = [];
  const claimsId = (i) => `CA-${String(i).padStart(3, '0')}`;

  // One scenario per claim type per carrier
  Object.entries(CLAIM_TYPES).forEach(([claimType, { code }]) => {
    CARRIERS.forEach((carrier) => {
      // Successful status retrieval
      scenarios.push({
        id: claimsId(scenarios.length + 1),
        agent: 'Claims_Agent',
        carrier,
        claimType,
        layer: 'conversation',
        harness: 'voice_agent_sim',
        scenario: 'claim_status_approved',
        description: `Retrieve ${claimType} claim status (approved) on ${carrier}`,
        repDialogue: `Claim approved. Coverage 50%. Patient responsibility $400.`,
        expectedOutcome: 'Approved (50%)',
        passCriteria: 'Extracts coverage %, amount, status correctly',
        status: 'planned',
      });

      // Pending claim
      scenarios.push({
        id: claimsId(scenarios.length + 1),
        agent: 'Claims_Agent',
        carrier,
        claimType,
        layer: 'conversation',
        harness: 'voice_agent_sim',
        scenario: 'claim_status_pending',
        description: `Retrieve ${claimType} claim status (pending review) on ${carrier}`,
        repDialogue: `Claim is under review. We'll have an answer in 3 business days.`,
        expectedOutcome: 'Pending',
        passCriteria: 'Captures status and timeline; no false escalation',
        status: 'planned',
      });

      // Denied claim
      scenarios.push({
        id: claimsId(scenarios.length + 1),
        agent: 'Claims_Agent',
        carrier,
        claimType,
        layer: 'conversation',
        harness: 'voice_agent_sim',
        scenario: 'claim_status_denied',
        description: `Retrieve ${claimType} claim status (denied) on ${carrier}`,
        repDialogue: `This claim was denied. The patient had a pre-existing condition.`,
        expectedOutcome: 'Denied (pre-existing)',
        passCriteria: 'Captures denial reason; escalates to Escalation_Closer',
        status: 'planned',
      });

      // Deductible applied
      scenarios.push({
        id: claimsId(scenarios.length + 1),
        agent: 'Claims_Agent',
        carrier,
        claimType,
        layer: 'conversation',
        harness: 'voice_agent_sim',
        scenario: 'claim_deductible_applied',
        description: `Retrieve ${claimType} claim (deductible applied) on ${carrier}`,
        repDialogue: `Claim approved at 100%. But the patient's $250 deductible applies. So we pay $750, patient pays $250.`,
        expectedOutcome: 'Approved (deductible applied)',
        passCriteria: 'Correctly interprets deductible math; no hallucination of amounts',
        status: 'planned',
      });
    });
  });

  return scenarios;
}

/**
 * Escalation_Closer scenarios — Dispute handling
 */
function generateEscalationScenarios() {
  const scenarios = [];
  const escId = (i) => `ESC-${String(i).padStart(3, '0')}`;

  const denialReason = (reason) => {
    const reasons = {
      'pre-existing': 'Pre-existing condition exclusion. Tooth was present before coverage.',
      'frequency': 'Frequency limit exceeded. Plan allows 2 cleanings per year.',
      'missing-preauth': 'Claim missing pre-authorization. Crown requires pre-auth.',
      'not-covered': 'Service not covered by this plan. Whitening is cosmetic only.',
      'deductible': 'Deductible not yet met. Patient responsible for first $250.',
    };
    return reasons[reason] || reason;
  };

  DENIAL_REASONS.forEach((reason) => {
    CARRIERS.forEach((carrier) => {
      scenarios.push({
        id: escId(scenarios.length + 1),
        agent: 'Escalation_Closer',
        carrier,
        claimType: 'major',
        layer: 'escalation',
        harness: 'voice_agent_sim',
        scenario: `dispute_${reason}`,
        description: `Dispute denial (${reason}) on ${carrier}`,
        initialDenial: denialReason(reason),
        repResponse: `That's our policy. I can escalate for review if you have clinical evidence.`,
        expectedOutcome: 'Escalated to review team OR denied (reconfirmed)',
        passCriteria: 'Presents practice case; escalates appropriately or accepts final denial',
        status: 'planned',
      });
    });
  });

  return scenarios;
}

/**
 * Resolution_Closer scenarios — Payment verification
 */
function generateResolutionScenarios() {
  const scenarios = [];
  const resId = (i) => `RES-${String(i).padStart(3, '0')}`;

  CARRIERS.forEach((carrier) => {
    scenarios.push({
      id: resId(scenarios.length + 1),
      agent: 'Resolution_Closer',
      carrier,
      claimType: 'any',
      layer: 'post_call',
      harness: 'voice_agent_sim',
      scenario: 'payment_verification_success',
      description: `Verify payment received on ${carrier}`,
      repConfirmation: `Payment was sent 5 days ago via ACH to your practice account. You should see it.`,
      expectedOutcome: 'Payment verified',
      passCriteria: 'Confirms payment status and date; updates claim record',
      status: 'planned',
    });

    scenarios.push({
      id: resId(scenarios.length + 1),
      agent: 'Resolution_Closer',
      carrier,
      claimType: 'any',
      layer: 'post_call',
      harness: 'voice_agent_sim',
      scenario: 'payment_delay_investigation',
      description: `Investigate delayed payment on ${carrier}`,
      repResponse: `Let me check... The payment was approved but I don't see it on our sent list. Let me escalate to accounting.`,
      expectedOutcome: 'Escalated to accounting; expected follow-up date provided',
      passCriteria: 'Escalates appropriately; gets accountability date',
      status: 'planned',
    });

    scenarios.push({
      id: resId(scenarios.length + 1),
      agent: 'Resolution_Closer',
      carrier,
      claimType: 'major',
      layer: 'post_call',
      harness: 'voice_agent_sim',
      scenario: 'partial_payment_explanation',
      description: `Explain partial payment discrepancy on ${carrier}`,
      repExplanation: `You billed $1,000. Deductible was $250, so we paid $750.`,
      expectedOutcome: 'Payment discrepancy explained and accepted',
      passCriteria: 'Correctly interprets deductible; explains to practice; reconciles',
      status: 'planned',
    });
  });

  return scenarios;
}

/**
 * Robustness scenarios — Conversation challenges
 */
function generateRobustnessScenarios() {
  const scenarios = [];
  const robId = (i) => `ROB-${String(i).padStart(3, '0')}`;

  const challenges = [
    {
      name: 'off_topic_tangent',
      dialogue: `So I saw your number called and I was wondering if this is that new system everyone's talking about?`,
      expectedBehavior: 'Acknowledge, redirect to claim',
    },
    {
      name: 'wrong_claim_redirect',
      dialogue: `Actually, I'm calling about the Henderson claim, not the Thompson claim.`,
      expectedBehavior: 'Apologize, refocus on correct claim',
    },
    {
      name: 'bot_accusation',
      dialogue: `Are you a robot? Because you sound like a robot.`,
      expectedBehavior: 'Confirm AI status honestly, explain value, proceed',
    },
    {
      name: 'jumbled_issues',
      dialogue: `I need to know about payment status, and also whether this covers cosmetic work, and what's the CPT code for this procedure.`,
      expectedBehavior: 'Decompose issues, address each one',
    },
    {
      name: 'settlement_pressure',
      dialogue: `Look, I'll accept $400 even though you owe $680. Just send it and we're done.`,
      expectedBehavior: 'Decline appropriately, stay on contract amount',
    },
    {
      name: 'vague_response',
      dialogue: `Yeah, that's noted. We'll look into it.`,
      expectedBehavior: 'Push back, demand specific status',
    },
    {
      name: 'personal_question',
      dialogue: `Are you new on this account? I don't recognize your voice.`,
      expectedBehavior: 'Answer honestly (AI), pivot to claim',
    },
    {
      name: 'rep_frustration',
      dialogue: `We're down two people today and everyone's upset. Can this wait until tomorrow?`,
      expectedBehavior: 'Show empathy, redirect to urgency of task',
    },
    {
      name: 'carrier_block_risk',
      dialogue: `Actually, I need to warn you. We're logging this number for robo-call compliance. Don't call back without a real person.`,
      expectedBehavior: 'Disclose callback number, acknowledge warning, end gracefully',
    },
    {
      name: 'claim_confusion',
      dialogue: `Wait, I thought we already paid this. Let me pull up our system... No, here it is pending. Sorry about that.`,
      expectedBehavior: 'Clarify confusion, accept corrected status',
    },
  ];

  CARRIERS.forEach((carrier) => {
    challenges.forEach((challenge) => {
      scenarios.push({
        id: robId(scenarios.length + 1),
        agent: 'Claims_Agent',
        carrier,
        claimType: 'major',
        layer: 'conversation',
        harness: 'voice_agent_sim',
        scenario: challenge.name,
        description: `Robustness: ${challenge.name} on ${carrier}`,
        repDialogue: challenge.dialogue,
        expectedBehavior: challenge.expectedBehavior,
        passCriteria: 'Stays on track, redirects appropriately, no rule violations',
        status: 'planned',
      });
    });
  });

  return scenarios;
}

/**
 * Main: Generate all scenarios
 */
function main() {
  console.log('Generating agent test scenarios...\n');

  const all = [
    ...generateIVRScenarios(),
    ...generateClaimsAgentScenarios(),
    ...generateEscalationScenarios(),
    ...generateResolutionScenarios(),
    ...generateRobustnessScenarios(),
  ];

  console.log(`Generated ${all.length} total scenarios`);
  console.log(`  - IVR_Navigator: ${all.filter((s) => s.agent === 'IVR_Navigator').length}`);
  console.log(`  - Hold_Sentinel: ${all.filter((s) => s.agent === 'Hold_Sentinel').length}`);
  console.log(`  - Claims_Agent: ${all.filter((s) => s.agent === 'Claims_Agent').length}`);
  console.log(`  - Escalation_Closer: ${all.filter((s) => s.agent === 'Escalation_Closer').length}`);
  console.log(`  - Resolution_Closer: ${all.filter((s) => s.agent === 'Resolution_Closer').length}`);

  // Write CSV
  const csvPath = path.join(__dirname, 'AGENT-TEST-SCENARIOS.csv');
  const headers = Object.keys(all[0]).join(',');
  const rows = all.map((s) =>
    Object.values(s)
      .map((v) => `"${v}"`)
      .join(',')
  );
  const csv = [headers, ...rows].join('\n');
  fs.writeFileSync(csvPath, csv, 'utf8');
  console.log(`\nScenarios written to: ${csvPath}`);

  // Write JSON
  const jsonPath = path.join(__dirname, 'AGENT-TEST-SCENARIOS.json');
  fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2), 'utf8');
  console.log(`JSON written to: ${jsonPath}`);
}

main();
