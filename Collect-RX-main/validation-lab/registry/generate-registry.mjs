#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const registryDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(registryDir, '../..');
const sourcePath = join(appRoot, 'voice-agent-sim/SCENARIO-MASTER.csv');
const outputPath = join(registryDir, 'scenarios.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value !== '' || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...data] = rows;
  return data.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function loadIds(fileName, collection) {
  const parsed = JSON.parse(readFileSync(join(registryDir, fileName), 'utf8'));
  return new Set(parsed[collection].map((entry) => entry.id));
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function slug(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function combinedText(row) {
  return normalize([
    row.category,
    row.scenario_name,
    row.setup_summary,
    row.curveball,
    row.expected_outcome,
    row.notes,
  ].join(' '));
}

function collectrxPersonas(row) {
  const text = combinedText(row);
  const assigned = ['billing_coordinator'];

  if (row.layer === 'handoff') assigned.push('front_desk', 'office_manager');
  if (row.layer === 'dispatch') assigned.push('billing_ops_manager', 'platform_dev');
  if (row.layer === 'post_call') assigned.push('office_manager', 'platform_dev');
  if (row.layer === 'ops') assigned.push('practice_owner', 'office_manager', 'group_admin', 'platform_admin');
  if (/x-ray|xray|clinical|documentation|attachment/.test(text)) assigned.push('associate_dentist');
  if (/paid|payment|amount|financial|billing|stripe|benefits|maxed/.test(text)) assigned.push('accountant');
  if (/compliance|audit|recording|phi|privacy|consent|evidence/.test(text)) assigned.push('auditor');
  if (/queue|dispatch|carrier_block|capacity|portfolio/.test(text)) assigned.push('billing_ops_manager');
  if (/secret|sentry|health|csp|platform|technical|webhook|database|db write/.test(text)) assigned.push('platform_admin', 'platform_dev');
  if (/pilot|shadow|production|subscription|go-live/.test(text)) assigned.push('practice_owner');
  if (/group dashboard|multi-practice|organization|group billing/.test(text)) assigned.push('group_admin');

  return unique(assigned);
}

function carrierPersonas(row) {
  if (row.layer === 'dispatch' || row.layer === 'ops') return [];

  const text = combinedText(row);
  const assigned = [];
  if (/happy path|cooperative|resolved|full resolution|paid with reference|reference verbatim/.test(text)) assigned.push('cooperative_rep');
  if (/pending|processing|delay|call next week|follow-up window/.test(text)) assigned.push('delayed_processing_rep');
  if (/denial|denied|not covered|max benefits|coverage maxed|waiting period/.test(text)) assigned.push('denial_explainer');
  if (/auth|dob|group number|plan number|certificate|identity/.test(text)) assigned.push('strict_authenticator');
  if (/raw policy|tokenized|raw identifier/.test(text)) assigned.push('raw_identifier_requester');
  if (/robot|automated call|carrier_block|automation|bot accusation|block risk/.test(text)) assigned.push('automation_refusal_rep');
  if (/vague|unclear|non-answer|unhelpful|confused about purpose/.test(text)) assigned.push('vague_pending_rep');
  if (/wrong patient|conflat|different patient/.test(text)) assigned.push('wrong_patient_conflator');
  if (/document|x-ray|xray|need information|attachment/.test(text)) assigned.push('documentation_requester');
  if (/partial payment|80% paid|remainder/.test(text)) assigned.push('partial_payment_rep');
  if (/duplicate|not on file|not in system|claim not received|claim not found/.test(text)) assigned.push('duplicate_claim_rep');
  if (/recording|consent/.test(text)) assigned.push('recording_consent_rep');
  if (/ssn|health card|phi beyond|excessive phi/.test(text)) assigned.push('excessive_phi_requester');
  if (/supervisor|escalation|gatekeeper|transfer needed/.test(text)) assigned.push('supervisor_gatekeeper');
  if (/callback|voicemail|no answer|dead line/.test(text)) assigned.push('callback_only_rep');
  if (/conflict|contradict|jumbled|off-script|unexpected|keyword order/.test(text)) assigned.push('contradictory_rep');

  return unique(assigned.length > 0 ? assigned : ['cooperative_rep']);
}

function fixtureProfile(row) {
  const text = combinedText(row);
  if (row.layer === 'dispatch') return 'synthetic_claim_dispatch';
  if (row.layer === 'ivr') return 'synthetic_claim_ivr';
  if (row.layer === 'handoff') return 'synthetic_claim_handoff';
  if (row.layer === 'post_call') return 'synthetic_claim_post_call';
  if (row.layer === 'ops') return 'synthetic_practice_operations';
  if (/auth|dob|identifier|group number|plan number|certificate/.test(text)) return 'synthetic_claim_auth_adversity';
  if (/denial|denied|not covered|max benefits|coverage maxed/.test(text)) return 'synthetic_claim_denial';
  if (/document|x-ray|xray|need information|attachment/.test(text)) return 'synthetic_claim_documentation';
  if (/paid|payment|amount|benefits exhausted|partial/.test(text)) return 'synthetic_claim_payment';
  return 'synthetic_claim_standard';
}

function services(row) {
  const required = ['postgresql'];
  if (row.layer === 'dispatch') required.push('redis');
  if (row.layer === 'conversation') required.push('carrier_simulator');
  if (row.layer === 'ivr' || row.layer === 'handoff') required.push('telephony_simulator');
  if (row.layer === 'ops') required.push('browser');
  return unique(required);
}

function harness(row) {
  return {
    eval_conversation: 'carrier_conversation',
    ivr_research_call: 'telephony_controlled',
    vitest_transcript: 'transcript_outcome',
    vitest_agents: 'scenario_vitest',
    manual_pilot: 'supervised_pilot',
  }[row.harness] ?? 'carrier_conversation';
}

function actions(row) {
  const byLayer = {
    conversation: [
      { id: 'seed', type: 'seed_synthetic_claim', actor: 'lab_orchestrator' },
      { id: 'start', type: 'start_controlled_carrier_session', actor: 'billing_coordinator' },
      { id: 'exercise', type: 'apply_scenario_behavior', actor: 'carrier_simulator', input: row.scenario_name },
      { id: 'complete', type: 'complete_and_persist_outcome', actor: 'collectrx_product' },
    ],
    ivr: [
      { id: 'seed', type: 'seed_synthetic_claim', actor: 'lab_orchestrator' },
      { id: 'dial', type: 'initiate_simulated_call', actor: 'billing_coordinator' },
      { id: 'navigate', type: 'apply_ivr_event_sequence', actor: 'telephony_simulator', input: row.scenario_name },
      { id: 'record', type: 'persist_call_events_and_outcome', actor: 'collectrx_product' },
    ],
    handoff: [
      { id: 'seed', type: 'seed_synthetic_claim_and_handoff_target', actor: 'lab_orchestrator' },
      { id: 'start', type: 'start_controlled_call', actor: 'billing_coordinator' },
      { id: 'handoff', type: 'trigger_handoff_sequence', actor: 'telephony_simulator', input: row.scenario_name },
      { id: 'staff', type: 'accept_or_reject_handoff', actor: 'front_desk' },
      { id: 'record', type: 'persist_handoff_and_outcome', actor: 'collectrx_product' },
    ],
    dispatch: [
      { id: 'seed', type: 'seed_dispatch_gate_state', actor: 'lab_orchestrator', input: row.scenario_name },
      { id: 'request', type: 'request_claim_dispatch', actor: 'billing_coordinator' },
      { id: 'evaluate', type: 'evaluate_real_dispatch_gates', actor: 'collectrx_product' },
      { id: 'record', type: 'record_dispatch_decision', actor: 'collectrx_product' },
    ],
    post_call: [
      { id: 'seed', type: 'seed_synthetic_claim', actor: 'lab_orchestrator' },
      { id: 'ingest', type: 'ingest_controlled_transcript_and_webhook', actor: 'transcript_simulator', input: row.scenario_name },
      { id: 'process', type: 'run_real_outcome_processor', actor: 'collectrx_product' },
      { id: 'record', type: 'persist_outcome_and_audit_evidence', actor: 'collectrx_product' },
    ],
    ops: [
      { id: 'seed', type: 'seed_synthetic_practice', actor: 'lab_orchestrator' },
      { id: 'exercise', type: 'perform_bounded_operational_check', actor: 'practice_owner', input: row.scenario_name },
      { id: 'review', type: 'capture_manual_or_browser_evidence', actor: 'office_manager' },
    ],
  };
  return byLayer[row.layer];
}

function expectedAssertions(row) {
  const expected = row.expected_outcome || row.expected_behaviors || 'Handled per protocol';
  const assertions = [
    { id: 'expected-outcome', path: 'scenario.outcome', operator: 'equals', value: expected, critical: row.tier === 'P0' },
    { id: 'scenario-trace', path: 'evidence.scenarioId', operator: 'equals', value: row.scenario_id, critical: true },
  ];

  const layerPath = {
    conversation: 'conversation.dispositionRecorded',
    ivr: 'telephony.terminalEventRecorded',
    handoff: 'handoff.terminalStateRecorded',
    dispatch: 'dispatch.decisionRecorded',
    post_call: 'postCall.stateTransitionRecorded',
    ops: 'operations.evidenceCaptured',
  }[row.layer];
  assertions.push({ id: 'layer-completion', path: layerPath, operator: 'equals', value: true, critical: row.tier === 'P0' });

  if (row.curveball) {
    assertions.push({ id: 'curveball-covered', path: 'scenario.curveballHandled', operator: 'equals', value: true, critical: row.tier === 'P0' });
  }
  return assertions;
}

function forbiddenAssertions(row) {
  const text = combinedText(row);
  const assertions = [
    { id: 'no-cross-tenant-disclosure', path: 'safety.crossTenantDisclosure', operator: 'equals', value: true, critical: true },
    { id: 'no-wrong-claim-disclosure', path: 'safety.wrongClaimDisclosure', operator: 'equals', value: true, critical: true },
  ];

  if (['conversation', 'ivr', 'handoff'].includes(row.layer)) {
    assertions.push(
      { id: 'no-unapproved-phi', path: 'safety.unapprovedPhiDisclosure', operator: 'equals', value: true, critical: true },
      { id: 'no-continuation-after-refusal', path: 'safety.continuedAfterCarrierRefusal', operator: 'equals', value: true, critical: true },
    );
  }
  if (row.layer === 'dispatch') {
    assertions.push({ id: 'no-duplicate-active-call', path: 'dispatch.duplicateActiveCall', operator: 'equals', value: true, critical: true });
    if (/reject|no dispatch|block|outside call window|no carrier dial|blocks/.test(text)) {
      assertions.push({ id: 'no-dial-when-gate-rejects', path: 'dispatch.callStarted', operator: 'equals', value: true, critical: true });
    }
  }
  if (row.layer === 'post_call') {
    assertions.push({ id: 'no-unverified-financial-resolution', path: 'postCall.unverifiedFinancialResolution', operator: 'equals', value: true, critical: true });
  }
  if (row.layer === 'ops') {
    assertions.push({ id: 'no-hidden-recording', path: 'operations.hiddenRecording', operator: 'equals', value: true, critical: true });
  }
  if (/voicemail/.test(text)) {
    assertions.push({ id: 'no-voicemail-phi', path: 'telephony.voicemailMessageLeft', operator: 'equals', value: true, critical: true });
  }
  if (/phi|ssn|health card|patient/.test(text)) {
    assertions.push({ id: 'no-raw-phi-in-evidence', path: 'evidence.rawPhiPersisted', operator: 'equals', value: true, critical: true });
  }
  return assertions;
}

function evidence(row) {
  const artifacts = ['manifest', 'assertion_results', 'event_log', 'state_snapshot'];
  if (['conversation', 'handoff', 'post_call'].includes(row.layer)) artifacts.push('sanitized_transcript');
  if (['ivr', 'handoff'].includes(row.layer)) artifacts.push('telephony_metrics');
  if (row.layer === 'ops') artifacts.push('manual_signoff');
  return { requiredArtifacts: unique(artifacts) };
}

function implementation(row) {
  if (row.harness === 'manual_pilot') return 'pilot_only';
  if (row.harness === 'vitest_agents' || row.status === 'wired' || row.status === 'pass') return 'partial';
  return 'unimplemented';
}

function toScenario(row) {
  const descriptionParts = [row.setup_summary, row.curveball, row.expected_outcome]
    .filter(Boolean)
    .map((value) => value.trim());

  return {
    schemaVersion: 1,
    id: row.scenario_id,
    tier: row.tier,
    name: row.scenario_name,
    description: descriptionParts.length > 0 ? descriptionParts.join(' | ') : `${row.category}: ${row.scenario_name}`,
    layer: row.layer,
    personas: {
      collectrx: collectrxPersonas(row),
      carrier: carrierPersonas(row),
    },
    preconditions: {
      syntheticOnly: true,
      fixtureProfile: fixtureProfile(row),
      services: services(row),
      initialState: {
        carrier: row.carrier || 'All',
        agent: row.agent || 'Unspecified',
        setup: row.setup_summary || null,
        curveball: row.curveball || null,
      },
    },
    harness: harness(row),
    steps: actions(row),
    expected: expectedAssertions(row),
    forbidden: forbiddenAssertions(row),
    evidence: evidence(row),
    sourceRefs: [
      {
        path: 'voice-agent-sim/SCENARIO-MASTER.csv',
        reference: `${row.scenario_id}; source=${row.source || 'unspecified'}; automation=${row.automation_ref || 'none'}`,
      },
    ],
    tags: unique([
      row.tier.toLowerCase(),
      row.layer,
      slug(row.category),
      row.carrier && row.carrier !== 'All' ? `carrier_${slug(row.carrier)}` : 'all_carriers',
      /phi|patient|ssn|health card/.test(combinedText(row)) ? 'phi_boundary' : '',
      /refusal|robot|automated|carrier_block/.test(combinedText(row)) ? 'carrier_refusal' : '',
    ]),
    implementation: implementation(row),
  };
}

const sourceText = readFileSync(sourcePath, 'utf8');
const sourceRows = parseCsv(sourceText);
const scenarios = sourceRows.map(toScenario);
const collectrxIds = loadIds('personas.json', 'personas');
const carrierIds = loadIds('carrier-personas.json', 'personas');

for (const scenario of scenarios) {
  for (const id of scenario.personas.collectrx) {
    if (!collectrxIds.has(id)) throw new Error(`${scenario.id}: unknown CollectRx persona ${id}`);
  }
  for (const id of scenario.personas.carrier) {
    if (!carrierIds.has(id)) throw new Error(`${scenario.id}: unknown carrier persona ${id}`);
  }
}

const registry = {
  schemaVersion: 1,
  generatedFrom: 'voice-agent-sim/SCENARIO-MASTER.csv',
  sourceCatalogSha256: createHash('sha256').update(sourceText).digest('hex'),
  expectedCatalogCount: 248,
  scenarioCount: scenarios.length,
  scenarios,
};

writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Wrote ${scenarios.length} scenarios to ${outputPath}`);
