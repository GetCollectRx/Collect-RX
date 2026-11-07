/**
 * Turns a registry scenario into the timed sequence of events one simulated
 * carrier call produces. Pure and deterministic: the same call id always gives
 * the same plan, so a restarted process can resume a call where it left off.
 *
 * Timing is real time. Phone menu steps come from the carrier config JSON in
 * carriers/, hold lasts 15 to 40 minutes, and each spoken line takes 6 to 14
 * seconds.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CallScenario, OutcomeClass } from './scenarioRegistry.js';

export type CallMode = 'hold_sentinel' | 'autonomous';

export interface CallPhi {
  patientName: string;
  dateOfBirth: string;
  memberId: string;
}

export type PlanStep =
  | { at: number; kind: 'status'; status: 'in-progress' }
  | { at: number; kind: 'line'; speaker: 'ivr' | 'agent' | 'rep' | 'staff'; text: string }
  | { at: number; kind: 'handoff' }
  | { at: number; kind: 'logOutcome'; args: Record<string, unknown> }
  | { at: number; kind: 'end'; endedReason: string };

export interface CallPlan {
  mode: CallMode;
  outcomeClass: OutcomeClass;
  holdSeconds: number;
  /** Seconds from dial. In Hold Sentinel mode these end at the handoff request. */
  beforeHandoff: PlanStep[];
  /** Hold Sentinel only: seconds from the moment the product transfers the call. */
  afterTransfer: PlanStep[];
}

const CARRIER_FILE: Record<string, string> = {
  sun_life: 'sunlife_private',
  canada_life: 'canada_life',
  manulife: 'manulife',
  green_shield: 'green_shield',
  rbc: 'rbc_insurance',
  telus_adjudicare: 'telus_adjudicare',
};

interface IvrStep { expected_prompt: string; action: string; wait_time?: number }

export function loadIvrSteps(carrierId: string, carriersDir = path.resolve(process.cwd(), 'carriers')): IvrStep[] {
  const file = CARRIER_FILE[carrierId];
  if (!file) return [];
  try {
    const raw: unknown = JSON.parse(readFileSync(path.join(carriersDir, `${file}.json`), 'utf8'));
    const steps = (raw as { ivr_navigation?: { steps?: unknown } }).ivr_navigation?.steps;
    if (!Array.isArray(steps)) return [];
    return steps.filter((s): s is IvrStep => typeof s === 'object' && s !== null
      && typeof (s as IvrStep).expected_prompt === 'string' && typeof (s as IvrStep).action === 'string');
  } catch {
    return [];
  }
}

/** Deterministic number in [min, max] from a seed. */
export function seeded(seed: string, salt: string, min: number, max: number): number {
  const h = createHash('sha256').update(`${seed}:${salt}`).digest();
  return min + (h.readUInt32BE(0) % (max - min + 1));
}

interface Exchange { speaker: 'agent' | 'rep' | 'staff'; text: string }

function repConversation(cls: OutcomeClass, mode: CallMode, curveball: string | null): Exchange[] {
  const caller: 'agent' | 'staff' = mode === 'autonomous' ? 'agent' : 'staff';
  const opener: Exchange[] = mode === 'autonomous'
    ? [
        { speaker: 'rep', text: 'Provider services, this is Jordan. How can I help?' },
        { speaker: 'agent', text: 'Hello, this is an automated assistant calling on behalf of {practice} about a claim status. This call may be transcribed. May I continue?' },
        { speaker: 'rep', text: 'Go ahead. Patient name and date of birth?' },
        { speaker: 'agent', text: 'The patient is {name}, date of birth {dob}, member ID {member}.' },
      ]
    : [
        { speaker: 'rep', text: 'Provider services, this is Jordan. Patient name and date of birth?' },
        { speaker: 'staff', text: 'Hi Jordan, the patient is {name}, date of birth {dob}, member ID {member}.' },
      ];
  const curve: Exchange[] = curveball ? [{ speaker: 'rep', text: `Before we go on: ${curveball}.` }, { speaker: caller, text: 'Understood, thank you.' }] : [];
  const close: Exchange[] = [
    { speaker: caller, text: 'Can I get a reference number and your name for our records?' },
    { speaker: 'rep', text: 'Reference number SBX-REF-4471, my name is Jordan.' },
  ];
  const body: Record<OutcomeClass, Exchange[]> = {
    PAID: [{ speaker: 'rep', text: 'That claim was paid in full on the last payment run, by direct deposit.' }],
    PARTIAL: [{ speaker: 'rep', text: 'It was paid, but only part of it. The remainder was reduced to the fee guide amount and is patient payable.' }],
    DENIED_NOT_COVERED: [{ speaker: 'rep', text: 'That procedure is not covered under this plan, so the claim was denied.' }],
    DENIED_MAX: [{ speaker: 'rep', text: 'The annual maximum has been reached for this member, so the claim was denied.' }],
    DENIED: [{ speaker: 'rep', text: 'That claim was denied. Frequency limitation, reason code FL-02. You can appeal within ninety days.' }],
    PROCESSING: [{ speaker: 'rep', text: 'It is still processing. Please allow another ten business days.' }],
    NOT_RECEIVED: [{ speaker: 'rep', text: 'I do not see a claim on file for that patient and date of service. It was not received; you will need to resubmit.' }],
    NEED_INFO: [{ speaker: 'rep', text: 'The claim is on hold pending x-rays. We need the radiographs before it can be assessed.' }],
    REFUSAL: [{ speaker: 'rep', text: 'Is this an automated call? We do not accept automated calls. I am ending this call.' }],
    CALLBACK: [{ speaker: 'rep', text: 'I cannot look that up right now. Leave a callback number and someone will call you back within two business days.' }],
    TECH_FAIL: [],
    UNCLEAR: [
      { speaker: 'rep', text: 'I am seeing two different statuses here, and I would need a supervisor to confirm which one is right.' },
      { speaker: caller, text: 'Can you tell me which status is current?' },
      { speaker: 'rep', text: 'Not without my supervisor. You will have to follow up.' },
    ],
  };
  if (cls === 'REFUSAL') return [...opener.slice(0, 2), ...body.REFUSAL];
  if (cls === 'CALLBACK') return [...opener.slice(0, 1), ...body.CALLBACK];
  return [...opener, ...curve, ...body[cls], ...close];
}

const SCRIBE_SCENARIO: Partial<Record<OutcomeClass, string>> = {
  PAID: 'CLAIM_PAID',
  PARTIAL: 'PARTIAL_PAYMENT',
  DENIED_NOT_COVERED: 'NOT_COVERED',
  DENIED_MAX: 'MAX_BENEFITS_REACHED',
  DENIED: 'CLAIM_DENIED',
  PROCESSING: 'PROCESSING',
  NOT_RECEIVED: 'CLAIM_NOT_RECEIVED',
  NEED_INFO: 'NEED_INFORMATION',
  UNCLEAR: 'UNCLEAR',
  CALLBACK: 'TRANSFER',
};

export function fillLine(text: string, phi: CallPhi, practiceName: string): string {
  return text
    .replace('{name}', phi.patientName)
    .replace('{dob}', phi.dateOfBirth)
    .replace('{member}', phi.memberId)
    .replace('{practice}', practiceName);
}

export function buildCallPlan(opts: {
  vapiCallId: string;
  scenario: CallScenario;
  carrierId: string;
  mode: CallMode;
}): CallPlan {
  const { vapiCallId, scenario, carrierId, mode } = opts;
  const cls = scenario.outcomeClass;
  const holdSeconds = seeded(vapiCallId, 'hold', 900, 2400);
  const before: PlanStep[] = [{ at: 0, kind: 'status', status: 'in-progress' }];
  let t = 3;
  for (const step of loadIvrSteps(carrierId)) {
    before.push({ at: t, kind: 'line', speaker: 'ivr', text: step.expected_prompt });
    t += Math.max(2, step.wait_time ?? 3);
  }

  if (cls === 'TECH_FAIL') {
    before.push({ at: t + 20, kind: 'end', endedReason: 'silence-timed-out' });
    return { mode, outcomeClass: cls, holdSeconds: 0, beforeHandoff: before, afterTransfer: [] };
  }

  t += holdSeconds;
  const lineGap = (i: number): number => seeded(vapiCallId, `line-${i}`, 6, 14);
  const conversation = repConversation(cls, mode, scenario.curveball);

  if (mode === 'autonomous') {
    conversation.forEach((ex, i) => {
      t += lineGap(i);
      before.push({ at: t, kind: 'line', speaker: ex.speaker, text: ex.text });
    });
    before.push({ at: t + 4, kind: 'end', endedReason: cls === 'REFUSAL' ? 'customer-ended-call' : 'assistant-ended-call' });
    return { mode, outcomeClass: cls, holdSeconds, beforeHandoff: before, afterTransfer: [] };
  }

  // Hold Sentinel: the rep answers, Hold_Sentinel asks for the staff handoff,
  // and the rest of the call is timed from the moment the product transfers.
  before.push({ at: t, kind: 'line', speaker: 'rep', text: 'Provider services, this is Jordan.' });
  before.push({ at: t + 2, kind: 'handoff' });
  const after: PlanStep[] = [];
  let a = 4;
  conversation.forEach((ex, i) => {
    a += lineGap(i);
    after.push({ at: a, kind: 'line', speaker: ex.speaker, text: ex.text });
  });
  const scribe = SCRIBE_SCENARIO[cls];
  if (scribe) {
    after.push({
      at: a + 3,
      kind: 'logOutcome',
      args: {
        scenario: scribe,
        callSummary: `Sandbox scenario ${scenario.id}: ${scenario.name}.`,
        repName: 'Jordan',
        referenceNumber: 'SBX-REF-4471',
        matchesExpectedAmount: cls === 'PAID' ? true : cls === 'PARTIAL' ? false : undefined,
      },
    });
  }
  after.push({ at: a + 6, kind: 'end', endedReason: 'customer-ended-call' });
  return { mode, outcomeClass: cls, holdSeconds, beforeHandoff: before, afterTransfer: after };
}
