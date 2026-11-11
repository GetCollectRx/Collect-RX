/**
 * Stage 1 fake carrier.
 *
 * Offline, the carrier cannot be dialled, so it is represented by the exact
 * sequence of Vapi server messages a real call would produce: status update,
 * the Hold_Sentinel handoff tool call on pickup, the Claims_Scribe outcome
 * tool call, and the end-of-call report. IVR prompts come from the carrier
 * config JSON in Collect-RX-main/carriers/, so the menus match what the
 * product believes each carrier plays.
 *
 * Every simulated second (dial, IVR, hold, pickup, talk, end) is recorded on
 * the returned timeline so later assertions can be checked against it.
 * Nothing here dials, and no audio exists: pickup latency and hold detection
 * cannot be measured in Stage 1 (gap 11).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type ScenarioId =
  | 'C1_PAID_IN_FULL'
  | 'S014_PARTIAL_PAYER'
  | 'DENIED_WITH_CODE'
  | 'NOT_ON_FILE_RESUBMIT'
  | 'ROBOT_REFUSER';

export interface RepScript {
  scenario: ScenarioId;
  persona: string;
  /** Scenario string Claims_Scribe passes to log_call_outcome. */
  scribeScenario: string;
  holdSeconds: number;
  repName: string;
  referenceNumber: string;
  matchesExpectedAmount?: boolean;
  amountStatedByRep?: string;
  /** Lines spoken after staff join; {name}, {dob}, {member} are filled with synthetic PHI. */
  talk: Array<{ speaker: 'rep' | 'staff'; text: string }>;
  /** Phrase sent as a live transcript message, for refusal scenarios. */
  liveTranscriptPhrase?: string;
}

export interface SyntheticPhiForCall {
  patientName: string;
  dateOfBirth: string;
  memberId: string;
}

export interface TimelineEvent {
  tSeconds: number;
  phase: 'dial' | 'ivr' | 'hold' | 'pickup' | 'talk' | 'end';
  detail: string;
}

export interface FakeCallScript {
  scenario: ScenarioId;
  carrierId: string;
  timeline: TimelineEvent[];
  holdSeconds: number;
  totalSeconds: number;
  transcript: string;
  envelopes: {
    inProgress: Record<string, unknown>;
    liveTranscript: Record<string, unknown> | null;
    staffHandoff: Record<string, unknown>;
    logOutcome: Record<string, unknown>;
    endOfCall: Record<string, unknown>;
  };
}

interface IvrStep {
  step_number: number;
  expected_prompt: string;
  action: string;
  wait_time?: number;
}

const CARRIER_FILE: Record<string, string> = {
  sun_life: 'sunlife_private',
  canada_life: 'canada_life',
  manulife: 'manulife',
  green_shield: 'green_shield',
  rbc: 'rbc_insurance',
  rbc_insurance: 'rbc_insurance',
  telus_adjudicare: 'telus_adjudicare',
};

export function loadIvrSteps(carriersDir: string, carrierId: string): IvrStep[] {
  const file = CARRIER_FILE[carrierId];
  if (!file) throw new Error(`[fake-carrier] no carrier config mapped for ${carrierId}`);
  const raw: unknown = JSON.parse(readFileSync(path.join(carriersDir, `${file}.json`), 'utf8'));
  if (typeof raw !== 'object' || raw === null) return [];
  const nav = (raw as { ivr_navigation?: { steps?: unknown } }).ivr_navigation;
  if (!nav || !Array.isArray(nav.steps)) return [];
  return nav.steps.filter((s): s is IvrStep => {
    if (typeof s !== 'object' || s === null) return false;
    const step = s as Record<string, unknown>;
    return typeof step.expected_prompt === 'string' && typeof step.action === 'string';
  });
}

export const REP_SCRIPTS: Record<ScenarioId, RepScript> = {
  C1_PAID_IN_FULL: {
    scenario: 'C1_PAID_IN_FULL',
    persona: 'C1 By-the-Book Provider Service Rep',
    scribeScenario: 'CLAIM_PAID',
    holdSeconds: 1260,
    repName: 'Rep Alpha',
    referenceNumber: 'REF-SIM-A1',
    matchesExpectedAmount: true,
    amountStatedByRep: 'full amount',
    talk: [
      { speaker: 'rep', text: 'Provider services, can I have the patient name and date of birth?' },
      { speaker: 'staff', text: 'The patient is {name}, date of birth {dob}, member ID {member}.' },
      { speaker: 'rep', text: 'Thank you. That claim was paid in full by direct deposit last week.' },
      { speaker: 'staff', text: 'Great, can I get a reference number and your name?' },
      { speaker: 'rep', text: 'Reference REF-SIM-A1, my name is Rep Alpha.' },
    ],
  },
  S014_PARTIAL_PAYER: {
    scenario: 'S014_PARTIAL_PAYER',
    persona: 'Partial-Payer (S014 partial payment)',
    scribeScenario: 'PARTIAL_PAYMENT',
    holdSeconds: 1500,
    repName: 'Rep Bravo',
    referenceNumber: 'REF-SIM-B2',
    matchesExpectedAmount: false,
    amountStatedByRep: 'less than billed',
    talk: [
      { speaker: 'rep', text: 'I have the claim for {name}. It paid, but at the fee guide amount.' },
      { speaker: 'staff', text: 'That is short of what we billed. What is the reduction code?' },
      { speaker: 'rep', text: 'Reduction code FG-SIM, fee guide limitation. The difference is patient payable.' },
      { speaker: 'staff', text: 'Reference number and your name please.' },
      { speaker: 'rep', text: 'REF-SIM-B2, Rep Bravo.' },
    ],
  },
  DENIED_WITH_CODE: {
    scenario: 'DENIED_WITH_CODE',
    persona: 'C2 Overloaded Call-Center Rep',
    scribeScenario: 'CLAIM_DENIED',
    holdSeconds: 1980,
    repName: 'Rep Charlie',
    referenceNumber: 'REF-SIM-C3',
    talk: [
      { speaker: 'rep', text: 'Member ID?' },
      { speaker: 'staff', text: '{member}, patient {name}.' },
      { speaker: 'rep', text: 'Denied. Frequency limitation, code FL-SIM. You can appeal within ninety days.' },
      { speaker: 'staff', text: 'Reference number and name?' },
      { speaker: 'rep', text: 'REF-SIM-C3. Charlie.' },
    ],
  },
  NOT_ON_FILE_RESUBMIT: {
    scenario: 'NOT_ON_FILE_RESUBMIT',
    persona: 'C3 Veteran Helpful Rep',
    scribeScenario: 'CLAIM_NOT_RECEIVED',
    holdSeconds: 900,
    repName: 'Rep Delta',
    referenceNumber: 'REF-SIM-D4',
    talk: [
      { speaker: 'rep', text: 'I do not see a claim on file for {name} on that date.' },
      { speaker: 'rep', text: 'Tip for next time: resubmit through the provider portal, it posts within two days.' },
      { speaker: 'staff', text: 'Thanks. Reference and name please.' },
      { speaker: 'rep', text: 'REF-SIM-D4, Delta.' },
    ],
  },
  ROBOT_REFUSER: {
    scenario: 'ROBOT_REFUSER',
    persona: 'Robot-Refuser',
    scribeScenario: 'UNCLEAR',
    holdSeconds: 600,
    repName: 'unknown',
    referenceNumber: 'unknown',
    liveTranscriptPhrase: 'We do not accept automated calls. I am ending this call.',
    talk: [
      { speaker: 'rep', text: 'Is this an automated call? We do not accept automated calls. I am ending this call.' },
    ],
  },
};

function fill(text: string, phi: SyntheticPhiForCall): string {
  return text.replace('{name}', phi.patientName).replace('{dob}', phi.dateOfBirth).replace('{member}', phi.memberId);
}

export function buildFakeCall(opts: {
  carriersDir: string;
  carrierId: string;
  scenario: ScenarioId;
  vapiCallId: string;
  metadata: Record<string, unknown>;
  phi: SyntheticPhiForCall;
  startedAt: Date;
}): FakeCallScript {
  const script = REP_SCRIPTS[opts.scenario];
  const steps = loadIvrSteps(opts.carriersDir, opts.carrierId);
  const timeline: TimelineEvent[] = [{ tSeconds: 0, phase: 'dial', detail: `dial fake ${opts.carrierId}` }];
  const lines: string[] = [];
  let t = 2;
  for (const step of steps) {
    timeline.push({ tSeconds: t, phase: 'ivr', detail: `${step.expected_prompt} -> ${step.action}` });
    lines.push(`IVR: ${step.expected_prompt}`);
    t += Math.max(1, step.wait_time ?? 1);
  }
  timeline.push({ tSeconds: t, phase: 'hold', detail: `hold begins (${script.holdSeconds}s scripted)` });
  t += script.holdSeconds;
  timeline.push({ tSeconds: t, phase: 'pickup', detail: `${script.persona} answers` });
  for (const line of script.talk) {
    t += 8;
    const spoken = fill(line.text, opts.phi);
    timeline.push({ tSeconds: t, phase: 'talk', detail: `${line.speaker}: ${spoken}` });
    lines.push(`${line.speaker === 'rep' ? 'Rep' : 'Staff'}: ${spoken}`);
  }
  t += 4;
  timeline.push({ tSeconds: t, phase: 'end', detail: 'call ends' });

  const endedAt = new Date(opts.startedAt.getTime() + t * 1000);
  const transcript = lines.join('\n');
  const call = {
    id: opts.vapiCallId,
    startedAt: opts.startedAt.toISOString(),
    assistantOverrides: { metadata: opts.metadata },
  };

  return {
    scenario: opts.scenario,
    carrierId: opts.carrierId,
    timeline,
    holdSeconds: script.holdSeconds,
    totalSeconds: t,
    transcript,
    envelopes: {
      inProgress: { message: { type: 'status-update', status: 'in-progress', call } },
      liveTranscript: script.liveTranscriptPhrase
        ? { message: { type: 'transcript', role: 'user', transcriptType: 'final', transcript: script.liveTranscriptPhrase, call } }
        : null,
      staffHandoff: {
        message: {
          type: 'tool-calls',
          call,
          toolWithToolCallList: [
            { name: 'request_staff_handoff', toolCall: { id: `${opts.vapiCallId}-handoff`, function: { name: 'request_staff_handoff', arguments: '{}' } } },
          ],
        },
      },
      logOutcome: {
        message: {
          type: 'tool-calls',
          call,
          toolWithToolCallList: [
            {
              name: 'log_call_outcome',
              toolCall: {
                id: `${opts.vapiCallId}-log`,
                function: {
                  name: 'log_call_outcome',
                  arguments: JSON.stringify({
                    scenario: script.scribeScenario,
                    callSummary: `Simulated ${script.persona} call, scenario ${script.scribeScenario}.`,
                    repName: script.repName,
                    referenceNumber: script.referenceNumber,
                    matchesExpectedAmount: script.matchesExpectedAmount,
                    amountStatedByRep: script.amountStatedByRep,
                  }),
                },
              },
            },
          ],
        },
      },
      endOfCall: {
        message: {
          type: 'end-of-call-report',
          startedAt: opts.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          endedReason: 'customer-ended-call',
          call,
          artifact: { transcript },
          analysis: {
            summary: `Simulated ${script.persona} call.`,
            collectrx: {
              agentTransition: {
                fromAgent: 'Hold_Sentinel',
                toAgent: 'Claims_Agent',
                durationSeconds: script.holdSeconds,
              },
            },
          },
        },
      },
    },
  };
}
