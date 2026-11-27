import { describe, it, expect } from 'vitest';
import {
  participantTwiml, whisperText, classifyStaffLeg, shouldFallBackToReferenceScript,
  nextStaffNumber, meteringGap, isSafeRoomName,
} from '../src/server/conference/conferenceLogic';
import { playbookReadiness } from '../src/server/frontDesk/playbookReadiness';
import { listenerAllowed } from '../src/server/frontDesk/listenerConsent';

describe('conference twiml', () => {
  it('listener is muted, never recorded, and does not end the room', () => {
    const x = participantTwiml('room-abcdef12', { muted: true });
    expect(x).toContain('muted="true"');
    expect(x).toContain('record="do-not-record"');
    expect(x).toContain('endConferenceOnExit="false"');
  });
  it('whisper is escaped and room names are validated', () => {
    expect(participantTwiml('room-abcdef12', { muted: false, whisper: 'A & <B>' })).toContain('A &amp; &lt;B&gt;');
    expect(() => participantTwiml('bad name<>', { muted: true })).toThrow();
    expect(isSafeRoomName('a'.repeat(65))).toBe(false);
  });
  it('whisper has carrier, claim and amount only', () => {
    expect(whisperText({ carrierName: 'Sun Life', claimLabel: 'CL-9', amountCents: 45050 })).toBe(
      'CollectRx call. Sun Life. Claim CL-9. Outstanding 450.50 dollars. Connecting you now.');
  });
});

describe('staff leg classification', () => {
  it('maps Twilio statuses', () => {
    expect(classifyStaffLeg({ callStatus: 'busy' })).toBe('busy');
    expect(classifyStaffLeg({ callStatus: 'no-answer' })).toBe('no_answer');
    expect(classifyStaffLeg({ callStatus: 'completed', answeredBy: 'machine_end_beep' })).toBe('voicemail');
    expect(classifyStaffLeg({ callStatus: 'in-progress', answeredBy: 'human' })).toBe('answered');
    expect(shouldFallBackToReferenceScript('voicemail')).toBe(true);
    expect(shouldFallBackToReferenceScript('answered')).toBe(false);
  });
});

describe('ring order and metering', () => {
  it('tries each number once in order', () => {
    expect(nextStaffNumber(['a', 'b'], [])).toBe('a');
    expect(nextStaffNumber(['a', 'b'], ['a'])).toBe('b');
    expect(nextStaffNumber(['a', 'b'], ['a', 'b'])).toBeNull();
  });
  it('reports unmetered minutes', () => {
    expect(meteringGap([{ meteredMinutes: 10, twilioBilledMinutes: 25 }, { meteredMinutes: 5, twilioBilledMinutes: 5 }]))
      .toMatchObject({ unmeteredMinutes: 15, unmeteredShare: 0.5 });
    expect(meteringGap([]).unmeteredShare).toBe(0);
  });
});

describe('playbook readiness and consent', () => {
  it('needs enough calls, practices and clean logs', () => {
    expect(playbookReadiness({ loggedCalls: 5, distinctPractices: 1, unclearCount: 0, suspicionFlagCount: 0 }).trusted).toBe(false);
    expect(playbookReadiness({ loggedCalls: 40, distinctPractices: 4, unclearCount: 2, suspicionFlagCount: 0 }).trusted).toBe(true);
    expect(playbookReadiness({ loggedCalls: 40, distinctPractices: 4, unclearCount: 10, suspicionFlagCount: 0 }).reasons).toContain('Too many unclear outcomes');
  });
  it('listener needs explicit consent', () => {
    expect(listenerAllowed({})).toBe(false);
    expect(listenerAllowed({ listenerConsentAcknowledged: true })).toBe(true);
  });
});

import { scriptedRepTwiml as _scriptedRepTwiml } from '../src/server/conference/conferenceLogic';
describe('scriptedRepTwiml (spike only)', () => {
  it('joins unmuted, never records, and rejects unsafe rooms', () => {
    const x = _scriptedRepTwiml('room-abc123');
    expect(x).toContain('record="do-not-record"');
    expect(x).toContain('muted="false"');
    expect(() => _scriptedRepTwiml('bad room<')).toThrow();
  });
});
