#!/usr/bin/env node
/**
 * Generates SCENARIO-MASTER.csv and COVERAGE-MATRIX.csv for voice-agent training.
 * Run: node voice-agent-sim/generate-scenario-master.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CARRIERS = [
  { slug: 'sun_life', name: 'Sun Life' },
  { slug: 'canada_life', name: 'Canada Life' },
  { slug: 'manulife', name: 'Manulife' },
  { slug: 'green_shield', name: 'Green Shield Canada' },
  { slug: 'rbc', name: 'RBC Insurance' },
  { slug: 'telus_adjudicare', name: 'TELUS AdjudiCare' },
];

const LAYERS = ['dispatch', 'ivr', 'conversation', 'handoff', 'post_call', 'ops'];

function esc(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cols) {
  return cols.map(esc).join(',');
}

const rows = [];
let seq = 0;

function add(scenario) {
  seq += 1;
  rows.push({
    scenario_id: scenario.id ?? `GEN-${String(seq).padStart(4, '0')}`,
    tier: scenario.tier ?? 'P1',
    layer: scenario.layer,
    agent: scenario.agent ?? '',
    carrier: scenario.carrier ?? 'All',
    category: scenario.category,
    scenario_name: scenario.name,
    setup_summary: scenario.setup ?? '',
    curveball: scenario.curveball ?? '',
    expected_outcome: scenario.expected_outcome ?? '',
    expected_behaviors: scenario.expected_behaviors ?? '',
    forbidden_behaviors: scenario.forbidden_behaviors ?? '',
    harness: scenario.harness ?? 'not_automated',
    automation_ref: scenario.automation_ref ?? '',
    status: 'planned',
    source: scenario.source ?? 'generated',
    notes: scenario.notes ?? '',
  });
}

// ─── Scratchpad S001–S025 ───────────────────────────────────────────────────
const SCRATCHPAD = [
  ['S001', 'Sun Life', 'Happy path', 'Cooperative rep — full resolution', '', 'Resolved', 'P0'],
  ['S002', 'Canada Life', 'Happy path', 'Cooperative rep — delay reason', '', 'Resolved', 'P0'],
  ['S003', 'Manulife', 'Happy path', 'Cooperative rep — denial reason captured', '', 'Resolved', 'P0'],
  ['S004', 'Green Shield Canada', 'IVR adversity', 'IVR menu drift', 'Menu changed since config', 'Failed (IVR/technical)', 'P0'],
  ['S005', 'RBC Insurance', 'IVR adversity', 'IVR callback offer', 'Press 1 for callback in 2h', 'Failed (IVR/technical)', 'P0'],
  ['S006', 'TELUS AdjudiCare', 'IVR adversity', 'French-first IVR', 'QC French menu; EN-only agent', 'Failed (IVR/technical)', 'P0'],
  ['S007', 'Sun Life', 'Authentication adversity', 'Auth field order differs', 'DOB before practice ID', 'Resolved', 'P0'],
  ['S008', 'Canada Life', 'Authentication adversity', 'Rep rejects tokenized policy format', 'Demands raw policy number', 'Needs Human Follow-Up', 'P0'],
  ['S009', 'Manulife', 'Authentication adversity', 'Rep refuses robots', 'Will not authenticate agent', 'Failed (carrier refusal)', 'P0'],
  ['S010', 'Green Shield Canada', 'Rep behavior adversity', 'Vague pending answer', 'Under review — call next week', 'Pending', 'P0'],
  ['S011', 'RBC Insurance', 'Rep behavior adversity', 'Claim too young', '28 days — should never have been queued', 'Needs Human Follow-Up', 'P0'],
  ['S012', 'TELUS AdjudiCare', 'Rep behavior adversity', 'Conflated claim info', 'Rep admits wrong patient file', 'Needs Human Follow-Up', 'P0'],
  ['S013', 'Sun Life', 'Claim complexity', 'Obscure denial code', 'Provider alignment mismatch; 76d', 'Needs Human Follow-Up', 'P0'],
  ['S014', 'Canada Life', 'Claim complexity', 'Partial payment', '80% paid; 20% pending pre-auth', 'Pending', 'P1'],
  ['S015', 'Manulife', 'Claim complexity', 'Not on file / duplicate confusion', 'Similar claim different patient', 'Needs Human Follow-Up', 'P1'],
  ['S016', 'Green Shield Canada', 'Compliance trap', 'Are you human?', 'Rep asks after disclosure', 'Resolved', 'P0'],
  ['S017', 'RBC Insurance', 'Compliance trap', 'Recording consent', 'Training/quality recording OK?', 'Resolved', 'P1'],
  ['S018', 'TELUS AdjudiCare', 'Compliance trap', 'Rep asks for SSN/health card', 'PHI beyond auth scope', 'Needs Human Follow-Up', 'P0'],
  ['S019', 'Sun Life', 'Compliance trap', 'IVR AI-screening message', 'Press 1 continue / 2 human', 'Resolved', 'P1'],
  ['S020', 'Canada Life', 'Happy path', 'Full squad handoff chain', '', 'Resolved', 'P0'],
  ['S021', 'Manulife', 'IVR adversity', 'Mid-IVR disconnect', 'Line drops after claims menu', 'Failed (IVR/technical)', 'P0'],
  ['S022', 'Green Shield Canada', 'Authentication adversity', 'Callback number request', 'Not in auth config', 'Resolved', 'P1'],
  ['S023', 'RBC Insurance', 'Rep behavior adversity', 'Post-disclosure hang-up', 'We do not work with robots', 'Failed (carrier refusal)', 'P0'],
  ['S024', 'TELUS AdjudiCare', 'Claim complexity', 'Past 90-day EDI window', '102d — paper EOB required', 'Needs Human Follow-Up', 'P0'],
  ['S025', 'Sun Life', 'Rep behavior adversity', 'COB confusion', 'Rep unsure which carrier at fault', 'Needs Human Follow-Up', 'P1'],
];

for (const [id, carrier, category, name, curveball, outcome, tier] of SCRATCHPAD) {
  const layer =
    category.includes('IVR') ? 'ivr'
    : category.includes('handoff') || id === 'S020' ? 'handoff'
    : category === 'Compliance trap' && id === 'S019' ? 'ivr'
    : 'conversation';
  const agent =
    layer === 'ivr' ? 'IVR_Navigator'
    : id === 'S020' ? 'Squad (1→2→3→4)'
    : category.includes('Authentication') ? 'Claims_Agent'
    : 'Claims_Agent';
  add({
    id,
    tier,
    layer,
    agent,
    carrier,
    category,
    name,
    curveball,
    expected_outcome: outcome,
    harness: layer === 'ivr' ? 'ivr_research_call' : 'eval_conversation',
    source: 'scratchpad',
    automation_ref: layer === 'ivr' ? 'scripts/ivr-research/research-call.cjs' : 'eval:conversation-robustness (extend)',
  });
}

// ─── Error recovery E001–E010 ─────────────────────────────────────────────────
const ERROR_RECOVERY = [
  ['E001', 'Timeout during hold', 'Agent exits gracefully; marks failed; safe retry', 'P0'],
  ['E002', 'Connection lost mid-call', 'State recorded; failed; safe retry', 'P0'],
  ['E003', 'Handoff context preserved', 'Claim ID survives 1→2→3→4', 'P0'],
  ['E004', 'Rate limit / quota hit', 'No dial; queue defers', 'P1'],
  ['E005', 'Post-call validation catches bad outcome', 'Financial gate downgrades to ESCALATED', 'P0'],
  ['E006', 'Duplicate webhook idempotency', 'Second call.ended ignored', 'P0'],
  ['E007', 'Vapi live but DB write fails', 'Orphan call cancelled', 'P0'],
  ['E008', 'PHI token expired at dispatch', '422; no dial', 'P0'],
  ['E009', 'Transcript empty on end', 'Appropriate non-terminal outcome', 'P1'],
  ['E010', 'Structured payload + transcript conflict', 'Structured wins or escalate', 'P0'],
];
for (const [id, name, setup, tier] of ERROR_RECOVERY) {
  add({
    id,
    tier,
    layer: id.startsWith('E00') && ['E004', 'E008'].includes(id) ? 'dispatch' : 'post_call',
    agent: 'Backend',
    carrier: 'All',
    category: 'Error recovery',
    name,
    setup,
    expected_outcome: 'Handled per protocol',
    harness: ['E004', 'E008'].includes(id) ? 'vitest_agents' : 'vitest_transcript',
    source: 'scratchpad',
    automation_ref: 'tests/agents + outcome processor fixtures',
  });
}

// ─── Voice agent trainer T001–T010 ───────────────────────────────────────────
const TRAINER = [
  ['T001', 'Paid with reference', 'RESOLVED', 'P0'],
  ['T002', 'Pending adjudication not approved', 'PENDING_REVIEW', 'P0'],
  ['T003', 'Cannot process automated calls', 'CARRIER_BLOCK', 'P0'],
  ['T004', 'Hold exceeds carrier timeout', 'TIMEOUT', 'P1'],
  ['T005', 'Rep asks DOB — PHI boundary', 'Continue with allowed fields', 'P0'],
  ['T006', 'Reference verbatim capture', 'Exact ref stored', 'P0'],
  ['T007', 'Claim not found', 'Not DENIED', 'P0'],
  ['T008', 'No answer / dead line', 'NO_ANSWER', 'P1'],
  ['T009', 'Supervisor escalation handoff', 'Escalation_Closer', 'P1'],
  ['T010', 'Denial with reason', 'DENIED + reason', 'P0'],
];
for (const [id, name, outcome, tier] of TRAINER) {
  add({
    id,
    tier,
    layer: id === 'T003' ? 'post_call' : 'conversation',
    agent: id === 'T009' ? 'Escalation_Closer' : 'Claims_Agent',
    category: 'Trainer minimum set',
    name,
    expected_outcome: outcome,
    harness: id === 'T003' ? 'vitest_transcript' : 'eval_conversation',
    source: 'voice-agent-trainer.md',
  });
}

// ─── Conversation robustness eval (existing 10) ─────────────────────────────
const ROBUSTNESS = [
  ['R001', 'off_topic_tangent', 'Off-topic tangent', 'P0'],
  ['R002', 'wrong_claim_redirect', 'Wrong claim redirect', 'P0'],
  ['R003', 'bot_accusation', 'Bot accusation', 'P0'],
  ['R004', 'compound_jumbled_response', 'Jumbled multi-issue answer', 'P1'],
  ['R005', 'settlement_pressure', 'Settlement pressure', 'P0'],
  ['R006', 'vague_non_answer_loop', 'Vague non-answer loop', 'P0'],
  ['R007', 'personal_question', 'Personal question', 'P1'],
  ['R008', 'confused_about_call_purpose', 'Confused about purpose', 'P1'],
  ['R009', 'frustration_venting', 'Rep vents workload', 'P2'],
  ['R010', 'carrier_block_risk_signal', 'Carrier block risk signal', 'P0'],
];
for (const [id, ref, name, tier] of ROBUSTNESS) {
  add({
    id,
    tier,
    layer: 'conversation',
    agent: 'Claims_Agent',
    category: 'Rep behavior adversity',
    name,
    harness: 'eval_conversation',
    automation_ref: `conversation-robustness-eval:${ref}`,
    source: 'conversation-robustness-eval.ts',
    expected_outcome: 'Pass rubric',
  });
}

// ─── Claims_Agent scenarios A–J × 6 carriers (outcome taxonomy) ─────────────
const OUTCOME_SCENARIOS = [
  ['A', 'Claim not received', 'CLAIM_NOT_RECEIVED', 'P0'],
  ['B', 'Not covered', 'NOT_COVERED', 'P0'],
  ['C', 'Coverage maxed', 'MAX_BENEFITS_REACHED', 'P1'],
  ['D', 'Documentation required', 'NEED_INFORMATION / Escalation if x-rays', 'P0'],
  ['E', 'Processing / pending', 'PROCESSING', 'P0'],
  ['F', 'Already paid', 'CLAIM_PAID', 'P0'],
  ['G', 'Denied', 'CLAIM_DENIED', 'P0'],
  ['H', 'Transfer needed', 'Handoff after transfer', 'P1'],
  ['I', 'Vague / unhelpful', 'UNCLEAR or supervisor', 'P0'],
  ['J', 'Off-script unexpected', 'Redirect then classify', 'P0'],
];
for (const c of CARRIERS) {
  for (const [letter, name, outcome, tier] of OUTCOME_SCENARIOS) {
    add({
      id: `O${letter}-${c.slug}`,
      tier,
      layer: letter === 'H' ? 'handoff' : 'conversation',
      agent: letter === 'D' && name.includes('x-rays') ? 'Claims_Agent → Escalation_Closer' : 'Claims_Agent',
      carrier: c.name,
      category: 'Outcome taxonomy',
      name: `Scenario ${letter}: ${name}`,
      expected_outcome: outcome,
      harness: 'eval_conversation',
      source: 'vapi-squad-config Claims_Agent prompt',
    });
  }
}

// ─── IVR types × 6 carriers ─────────────────────────────────────────────────
const IVR_TYPES = [
  ['IVR-HP', 'Happy path to live rep', 'Reach human; hand off to Claims_Agent', 'P0'],
  ['IVR-DR', 'Menu drift', 'Detect divergence; retry or exit ≤3 loops', 'P0'],
  ['IVR-CB', 'Callback offer', 'Log callback; exit; human follow-up', 'P0'],
  ['IVR-FR', 'French / language mismatch', 'Detect; exit; flag languagePreference', 'P0'],
  ['IVR-HO', 'Hold music silence', 'No speech during hold', 'P0'],
  ['IVR-VM', 'Voicemail', 'End immediately; no message', 'P0'],
  ['IVR-DC', 'Mid-IVR disconnect', 'Failed technical; safe retry', 'P0'],
  ['IVR-AI', 'AI-screening IVR', 'Press continue appropriately', 'P1'],
];
for (const c of CARRIERS) {
  for (const [code, name, expected, tier] of IVR_TYPES) {
    const skipFr = code === 'IVR-FR' && !['telus_adjudicare', 'canada_life'].includes(c.slug);
    if (skipFr) continue;
    add({
      id: `${code}-${c.slug}`,
      tier,
      layer: 'ivr',
      agent: 'IVR_Navigator',
      carrier: c.name,
      category: 'IVR navigation',
      name,
      expected_outcome: expected,
      harness: 'ivr_research_call',
      automation_ref: `research-call.cjs --carrier ${c.slug}`,
      source: 'ivr-validation program',
    });
  }
}

// ─── Dispatch / queue (D001–D020) ─────────────────────────────────────────────
const DISPATCH = [
  ['D001', 'Claim 29 days', 'Reject — min 30 days', 'P0'],
  ['D002', 'Claim 91 days', 'Reject — human only', 'P0'],
  ['D003', '4th attempt', 'Reject — max 3', 'P0'],
  ['D004', 'CARRIER_BLOCK active', 'Block all calls to carrier', 'P0'],
  ['D005', 'Other carrier not blocked', 'Allow when block is carrier-scoped', 'P0'],
  ['D006', 'Carrier not authorized', 'checkCarrierAuthorizationGate', 'P0'],
  ['D007', 'voiceAgentEnabled false', 'No dispatch', 'P0'],
  ['D008', 'Subscription limit hit', 'No dispatch', 'P1'],
  ['D009', 'Saturday dial', 'Outside call window', 'P0'],
  ['D010', '8:00 ET Monday', 'Inside window', 'P1'],
  ['D011', 'APPROVED_PENDING_PAYMENT', 'No carrier dial', 'P0'],
  ['D012', 'TELUS 20 days', 'Reject — min 21 for TELUS config', 'P1'],
  ['D013', 'TELUS 35 days', 'Allow if other gates pass', 'P1'],
  ['D014', 'Manual trigger same gates', 'insurance trigger = queue', 'P0'],
  ['D015', 'Wrong phone blocked', 'initiateCall allowlist', 'P0'],
  ['D016', 'identifyTelusPlan high confidence', 'TPA in variables', 'P1'],
  ['D017', 'Canada Life portalFirst', 'Portal before voice', 'P1'],
  ['D018', 'Recovery route not CALL_CARRIER', 'dispatchGate blocks', 'P0'],
  ['D019', 'Queue tick concurrency', 'No dual-dispatch same claim', 'P0'],
  ['D020', 'Plan capacity soft limit', 'Per subscription config', 'P2'],
];
for (const [id, name, expected, tier] of DISPATCH) {
  add({
    id,
    tier,
    layer: 'dispatch',
    agent: 'Dispatch / validateDispatch',
    category: 'Queue rules',
    name,
    expected_outcome: expected,
    harness: 'vitest_agents',
    source: 'carrier adapter + agents tests',
    automation_ref: 'npm run agents',
  });
}

// ─── Handoff scenarios (H001–H015) ───────────────────────────────────────────
const HANDOFFS = [
  ['H001', 'IVR → Claims on first human word', 'Immediate handoff', 'P0'],
  ['H002', 'Claims → Resolution on paid outcome', 'Resolution_Closer fires webhook', 'P0'],
  ['H003', 'Claims → Escalation on x-ray doc', 'No timeline commitment', 'P0'],
  ['H004', 'Rep transfer — re-intro Stage 1', 'Context preserved', 'P0'],
  ['H005', 'No duplicate full disclosure', 'Claims intro only once', 'P1'],
  ['H006', 'Reference survives handoff', 'Same ref in webhook', 'P0'],
  ['H007', 'Hang-up during handoff', 'Partial transcript processed', 'P1'],
  ['H008', 'Escalation_Closer 75+ day override', 'Human follow-up flag', 'P0'],
  ['H009', 'Resolution_Closer read-back amounts', 'Confirmed before close', 'P0'],
  ['H010', 'Squad end-to-end S020 equivalent', 'All four agents', 'P0'],
  ['H011', 'Claims denies settlement → Resolution', 'No partial accept', 'P0'],
  ['H012', 'IVR timeout before human', 'Never reaches Claims', 'P0'],
  ['H013', 'Supervisor requested → Escalation', 'Correct closer', 'P1'],
  ['H014', 'COB unresolved → Escalation', 'Not Resolved', 'P1'],
  ['H015', 'Structured collectrx payload present', 'High-trust outcome path', 'P0'],
];
for (const [id, name, expected, tier] of HANDOFFS) {
  add({
    id,
    tier,
    layer: 'handoff',
    agent: 'Squad',
    category: 'Multi-agent handoff',
    name,
    expected_outcome: expected,
    harness: 'eval_conversation',
    source: 'squad architecture',
  });
}

// ─── Post-call transcript fixtures (P001–P030) ──────────────────────────────
const POST_CALL = [
  ['P001', 'RESOLVED without reference', 'ESCALATED (financial gate)', 'P0'],
  ['P002', 'RESOLVED with reference ≥4 chars', 'RESOLVED', 'P0'],
  ['P003', 'Structured payload present', 'Trust structured', 'P0'],
  ['P004', 'pending adjudication keywords', 'PENDING not APPROVED', 'P0'],
  ['P005', 'carrier_block in transcript', 'CARRIER_BLOCK protocol', 'P0'],
  ['P006', 'automated call phrase', 'Block signal', 'P0'],
  ['P007', 'paid + no check number', 'Pending verification', 'P1'],
  ['P008', 'denied + code in text', 'DENIED + code extracted', 'P0'],
  ['P009', 'not in system', 'Not DENIED', 'P0'],
  ['P010', 'empty transcript', 'Safe non-terminal', 'P1'],
  ['P011', 'duplicate webhook', 'Idempotent', 'P0'],
  ['P012', 'PHI in transcript scrubbed', 'No PHI persisted', 'P0'],
  ['P013', 'conflated patient names', 'Do not auto-RESOLVE', 'P0'],
  ['P014', 'partial payment mentioned', 'Pending not Resolved', 'P0'],
  ['P015', '90+ days in transcript', 'Escalate path', 'P0'],
  ['P016', 'recording deleted post-call', 'Compliance', 'P1'],
  ['P017', 'confidence gate + appeal deadline', 'Metadata captured', 'P2'],
  ['P018', 'wrong outcome keyword order', 'Ladder order correct', 'P1'],
  ['P019', 'legacy carrier_block string', 'Detected', 'P0'],
  ['P020', 'bot activity detected', 'CARRIER_BLOCK', 'P0'],
  ['P021', 'claim paid regex variant', 'CLAIM_PAID', 'P1'],
  ['P022', 'benefits exhausted', 'MAX_BENEFITS', 'P1'],
  ['P023', 'waiting period not met', 'DENIED reason', 'P2'],
  ['P024', 'webhookOutcomeResolver fallback', 'Structured path', 'P1'],
  ['P025', 'recovery loop transition', 'Correct claim status', 'P1'],
  ['P026', 'desk queue broadcast', 'UI update', 'P2'],
  ['P027', 'audit log entry', 'PHI_TOKEN_RESOLVED logged', 'P1'],
  ['P028', 'guardrail audit outbox', 'Async write', 'P2'],
  ['P029', 'EMR sync on resolve', 'Outbox only when configured', 'P2'],
  ['P030', 'analytics KPI auth rate', 'repName or ref', 'P2'],
];
for (const [id, name, expected, tier] of POST_CALL) {
  add({
    id,
    tier,
    layer: 'post_call',
    agent: 'Backend / outcome processor',
    category: 'Transcript & webhook',
    name,
    expected_outcome: expected,
    harness: 'vitest_transcript',
    source: 'outcome processor + webhook',
    automation_ref: 'tests/outcome (to add)',
  });
}

// ─── Ops / pilot (X001–X010) ────────────────────────────────────────────────
const OPS = [
  ['X001', 'First pilot call human-reviewed', 'No auto-trust dashboard', 'P0'],
  ['X002', 'SendGrid password reset', 'Email delivered', 'P1'],
  ['X003', 'VAPI_WEBHOOK_SECRET missing prod', 'Server refuses start', 'P0'],
  ['X004', 'Sentry test error', 'Event received', 'P1'],
  ['X005', 'health/ready 503', 'Uptime alert', 'P1'],
  ['X006', 'CSV import → queue → dial', 'E2E pilot path', 'P0'],
  ['X007', 'CSP no violations on dashboard', 'Browser console clean', 'P1'],
  ['X008', 'Stripe test webhook', 'Billing event', 'P1'],
  ['X009', 'Fly secret sync dry run', 'Keys listed', 'P2'],
  ['X010', 'Shadow mode 20 calls', '100% human sign-off', 'P0'],
];
for (const [id, name, expected, tier] of OPS) {
  add({
    id,
    tier,
    layer: 'ops',
    agent: 'Operations',
    category: 'Pilot & production',
    name,
    expected_outcome: expected,
    harness: 'manual_pilot',
    source: 'go-live checklist',
  });
}

// ─── Carrier-specific extras ──────────────────────────────────────────────────
const CARRIER_EXTRA = {
  sun_life: [
    ['CX-SL-01', 'Electronic resubmit 365d window', 'Resubmit path captured', 'P1'],
    ['CX-SL-02', 'Group number IVR entry', 'Digits individually', 'P0'],
  ],
  canada_life: [
    ['CX-CL-01', 'providerConnect before voice', 'Portal attempt logged', 'P1'],
    ['CX-CL-02', 'Plan number + pound', 'IVR hint validated', 'P0'],
  ],
  manulife: [
    ['CX-MF-01', 'English then benefits menu', 'IVR path', 'P0'],
    ['CX-MF-02', 'Hostile to automation history', 'CARRIER_BLOCK risk', 'P0'],
  ],
  green_shield: [
    ['CX-GS-01', 'Provider inquiries menu', 'IVR path', 'P0'],
    ['CX-GS-02', 'Certificate number auth', 'Tokenized ID only', 'P0'],
  ],
  rbc: [
    ['CX-RBC-01', 'Group benefits submenu', 'IVR path', 'P0'],
    ['CX-RBC-02', 'Block after robot refusal', 'Suspend RBC', 'P0'],
  ],
  telus_adjudicare: [
    ['CX-TA-01', 'TPA from group prefix', 'identifyTelusPlan', 'P0'],
    ['CX-TA-02', 'Tx23 bypass when supported', 'No voice if electronic OK', 'P1'],
    ['CX-TA-03', 'Min 21 day wait', 'Dispatch gate', 'P0'],
    ['CX-TA-04', 'Beneva/La Capitale ivrAlias', 'Correct spoken name', 'P1'],
  ],
};
for (const c of CARRIERS) {
  for (const [id, name, expected, tier] of CARRIER_EXTRA[c.slug] ?? []) {
    add({
      id,
      tier,
      carrier: c.name,
      layer: id.includes('IVR') || name.includes('IVR') ? 'ivr' : 'conversation',
      agent: name.includes('IVR') || name.includes('menu') ? 'IVR_Navigator' : 'Claims_Agent',
      category: 'Carrier-specific',
      name,
      expected_outcome: expected,
      harness: name.includes('IVR') ? 'ivr_research_call' : 'eval_conversation',
      source: 'carrier adapter',
    });
  }
}

// ─── Write SCENARIO-MASTER.csv ────────────────────────────────────────────────
const HEADER = [
  'scenario_id', 'tier', 'layer', 'agent', 'carrier', 'category', 'scenario_name',
  'setup_summary', 'curveball', 'expected_outcome', 'expected_behaviors', 'forbidden_behaviors',
  'harness', 'automation_ref', 'status', 'source', 'notes',
];

const masterPath = join(__dirname, 'SCENARIO-MASTER.csv');
writeFileSync(masterPath, [row(HEADER), ...rows.map((r) => row(HEADER.map((h) => r[h]))), ''].join('\n'));

// ─── COVERAGE-MATRIX.csv (carrier × category counts) ────────────────────────
const CATEGORIES = [...new Set(rows.map((r) => r.category))].sort();
const matrixHeader = ['carrier', ...CATEGORIES, 'TOTAL', 'P0_count', 'P0_pass', 'P1_count', 'P1_pass'];
const matrixRows = [];

for (const c of [{ slug: 'all', name: 'All' }, ...CARRIERS]) {
  const subset =
    c.slug === 'all' ? rows : rows.filter((r) => r.carrier === c.name || r.carrier === 'All');
  const counts = {};
  for (const cat of CATEGORIES) {
    counts[cat] = subset.filter((r) => r.category === cat).length;
  }
  const p0 = subset.filter((r) => r.tier === 'P0').length;
  const p1 = subset.filter((r) => r.tier === 'P1').length;
  matrixRows.push(
    row([
      c.name,
      ...CATEGORIES.map((cat) => counts[cat] || 0),
      subset.length,
      p0,
      0,
      p1,
      0,
    ]),
  );
}

const matrixPath = join(__dirname, 'COVERAGE-MATRIX.csv');
writeFileSync(matrixPath, [row(matrixHeader), ...matrixRows, ''].join('\n'));

// ─── TIER-SUMMARY.csv ─────────────────────────────────────────────────────────
const tierSummary = ['tier', 'count', 'layers'];
for (const tier of ['P0', 'P1', 'P2']) {
  const t = rows.filter((r) => r.tier === tier);
  tierSummary.push(row([tier, t.length, [...new Set(t.map((r) => r.layer))].join('; ')]));
}
writeFileSync(join(__dirname, 'TIER-SUMMARY.csv'), tierSummary.join('\n') + '\n');

console.log(`Wrote ${rows.length} scenarios → ${masterPath}`);
console.log(`Wrote coverage matrix → ${matrixPath}`);
