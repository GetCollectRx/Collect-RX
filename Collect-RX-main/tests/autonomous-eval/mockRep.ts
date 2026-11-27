/**
 * Mock rep scenarios for the offline autonomous-call evaluation.
 *
 * Each scenario is the exact sequence of native Vapi server messages a call
 * would produce, plus what the product must do about it. No audio, no
 * telephony, no network. The expectations come from the written rules in
 * CLAUDE.md (CARRIER_BLOCK, call lifecycle, practice-level block scope), not
 * from what the code currently does.
 */

export type Speaker = 'carrier' | 'assistant';

export type MockEvent =
  | { kind: 'status'; status: 'in-progress' | 'ended' }
  | { kind: 'call-started' }
  | { kind: 'speech'; speaker: Speaker; text: string; final: boolean }
  | { kind: 'agent-transition'; toAgent: 'IVR_Navigator' | 'Hold_Sentinel' | 'Claims_Agent' | 'Resolution_Closer' }
  | { kind: 'end-of-call' };

export interface DispatchSetup {
  /** The practice that placed the first call and tripped the block. */
  practiceId: string;
  carrierId: 'SUN_LIFE' | 'MANULIFE';
  /** Practices that share an organization with practiceId (sibling locations). */
  siblingPracticeIds: string[];
}

export interface Expectation {
  /** A CARRIER_BLOCK must be recorded for the calling practice. */
  carrierBlocked: boolean;
  /** When blocked, the block must land while the call is still live, before end-of-call. */
  blockedWhileLive?: boolean;
  /** Exactly one block event, even when the refusal is repeated or partial. */
  blockEvents?: number;
  /** The lifecycle must never reach Agent_Connected without an explicit transition. */
  noAgentConnected?: boolean;
  /** Follow-up dispatch checks after the call, keyed by who tries to dial next. */
  followUp?: {
    samePracticeSameCarrier?: 'allowed' | 'blocked';
    siblingSameCarrier?: 'allowed' | 'blocked';
    unrelatedPracticeSameCarrier?: 'allowed' | 'blocked';
    samePracticeOtherCarrier?: 'allowed' | 'blocked';
  };
}

export interface MockScenario {
  id: string;
  title: string;
  setup: DispatchSetup;
  events: MockEvent[];
  expect: Expectation;
}

const BASE_SETUP: DispatchSetup = {
  practiceId: 'practice-a',
  carrierId: 'SUN_LIFE',
  siblingPracticeIds: ['practice-sibling'],
};

const live = (text: string, speaker: Speaker = 'carrier'): MockEvent => ({ kind: 'speech', speaker, text, final: true });

const NORMAL_OPEN: MockEvent[] = [
  { kind: 'call-started' },
  { kind: 'status', status: 'in-progress' },
  { kind: 'agent-transition', toAgent: 'IVR_Navigator' },
  live('For claim status, press 2.'),
  { kind: 'agent-transition', toAgent: 'Hold_Sentinel' },
  live('Your estimated wait time is eight minutes. Thank you for holding.'),
];

const NORMAL_CLOSE: MockEvent[] = [{ kind: 'status', status: 'ended' }, { kind: 'end-of-call' }];

function repCall(lines: string[]): MockEvent[] {
  return [
    ...NORMAL_OPEN,
    { kind: 'agent-transition', toAgent: 'Claims_Agent' },
    ...lines.flatMap((l, i): MockEvent[] => [
      live(l),
      live(`Noted, thank you. (${i + 1})`, 'assistant'),
    ]),
    { kind: 'agent-transition', toAgent: 'Resolution_Closer' },
    ...NORMAL_CLOSE,
  ];
}

const NO_BLOCK: Expectation = { carrierBlocked: false, blockEvents: 0 };

const REFUSAL_EXPECT: Expectation = {
  carrierBlocked: true,
  blockedWhileLive: true,
  blockEvents: 1,
};

export const SCENARIOS: readonly MockScenario[] = [
  { id: 'S01', title: 'Claim paid in full', setup: BASE_SETUP, events: repCall(['That claim was paid in full on the fourth.']), expect: NO_BLOCK },
  { id: 'S02', title: 'Partial payment with a reason code', setup: BASE_SETUP, events: repCall(['Paid in part. The remainder is applied to the deductible.']), expect: NO_BLOCK },
  { id: 'S03', title: 'Denied with a code', setup: BASE_SETUP, events: repCall(['That claim was denied, code D-47, frequency limitation.']), expect: NO_BLOCK },
  { id: 'S04', title: 'Claim not on file, resubmit', setup: BASE_SETUP, events: repCall(['I do not see that claim on file. You will need to resubmit.']), expect: NO_BLOCK },
  {
    id: 'S05',
    title: 'Call connects and hold music plays: connection alone is not a rep',
    setup: BASE_SETUP,
    events: [{ kind: 'call-started' }, { kind: 'status', status: 'in-progress' }, live('Please continue to hold. Your call is important to us.'), ...NORMAL_CLOSE],
    expect: { ...NO_BLOCK, noAgentConnected: true },
  },
  {
    id: 'S06',
    title: 'Rep refuses robots and ends the call',
    setup: BASE_SETUP,
    events: [...NORMAL_OPEN, { kind: 'agent-transition', toAgent: 'Claims_Agent' }, live('We do not work with robots. I am ending this call.'), ...NORMAL_CLOSE],
    expect: REFUSAL_EXPECT,
  },
  {
    id: 'S07',
    title: 'Carrier states automation was detected',
    setup: BASE_SETUP,
    events: [...NORMAL_OPEN, live('Bot activity detected on this line.'), ...NORMAL_CLOSE],
    expect: REFUSAL_EXPECT,
  },
  {
    id: 'S08',
    title: 'IVR says automated system: generic wording is not a block',
    setup: BASE_SETUP,
    events: [{ kind: 'call-started' }, { kind: 'status', status: 'in-progress' }, live('You have reached the automated system for provider services.'), ...NORMAL_CLOSE],
    expect: NO_BLOCK,
  },
  {
    id: 'S09',
    title: 'Our own agent says it is ending the call: never read as the carrier',
    setup: BASE_SETUP,
    events: [...repCall(['That claim was paid in full.']).slice(0, -2), live('I am ending this call now. Thank you.', 'assistant'), ...NORMAL_CLOSE],
    expect: NO_BLOCK,
  },
  {
    id: 'S10',
    title: 'Refusal arrives as partials then final: one block, on the final',
    setup: BASE_SETUP,
    events: [
      ...NORMAL_OPEN,
      { kind: 'speech', speaker: 'carrier', text: 'We do not work', final: false },
      { kind: 'speech', speaker: 'carrier', text: 'We do not work with robots', final: false },
      live('We do not work with robots. I am ending this call.'),
      live('We do not work with robots. I am ending this call.'),
      ...NORMAL_CLOSE,
    ],
    expect: REFUSAL_EXPECT,
  },
  {
    id: 'S11',
    title: 'After a block the same practice cannot redial that carrier',
    setup: BASE_SETUP,
    events: [...NORMAL_OPEN, live('Automated calling is not permitted on this line.'), ...NORMAL_CLOSE],
    expect: { ...REFUSAL_EXPECT, followUp: { samePracticeSameCarrier: 'blocked', unrelatedPracticeSameCarrier: 'allowed' } },
  },
  {
    id: 'S12',
    title: 'Block scope is practice level: a sibling location is not blocked',
    setup: BASE_SETUP,
    events: [...NORMAL_OPEN, live('This sounds like a bot call.'), ...NORMAL_CLOSE],
    expect: { ...REFUSAL_EXPECT, followUp: { siblingSameCarrier: 'allowed' } },
  },
  {
    id: 'S13',
    title: 'Block is per carrier: the same practice may still dial another carrier',
    setup: BASE_SETUP,
    events: [...NORMAL_OPEN, live('Fraud detection has flagged this number.'), ...NORMAL_CLOSE],
    expect: { ...REFUSAL_EXPECT, followUp: { samePracticeOtherCarrier: 'allowed' } },
  },
];
