import { describe, it, expect } from 'vitest';
import { pilotSignupsClosed } from '../src/server/routes/pilotSignupGate';
import { trialEndOnReady } from '../src/server/plans/trialClock';

describe('pilot signup gate (B-27)', () => {
  it('is open unless explicitly closed', () => {
    expect(pilotSignupsClosed({} as never)).toBe(false);
    expect(pilotSignupsClosed({ PILOT_SIGNUPS_CLOSED: 'true' } as never)).toBe(true);
  });
});

describe('trial clock (B-14)', () => {
  const day = 24 * 3600 * 1000;
  const ready = new Date('2026-12-10T00:00:00Z');
  it('extends to 30 days from ready, once, and never shortens', () => {
    const end = trialEndOnReady({ currentTrialEnd: new Date('2026-12-01T00:00:00Z'), readyAt: ready, trialDays: 30, alreadyStarted: false });
    expect(end?.getTime()).toBe(ready.getTime() + 30 * day);
    expect(trialEndOnReady({ currentTrialEnd: null, readyAt: ready, trialDays: 30, alreadyStarted: true })).toBeNull();
    expect(trialEndOnReady({ currentTrialEnd: new Date(ready.getTime() + 60 * day), readyAt: ready, trialDays: 30, alreadyStarted: false })).toBeNull();
  });
});

import { creditableMinutes } from '../src/server/plans/holdCredit';
import { validatePracticeSettingsUpdate } from '../src/server/services/practiceSettingsService';

describe('hold credit (B-23) and fallback numbers (B-11)', () => {
  it('credits only held-then-dumped minutes', () => {
    expect(creditableMinutes([{ heldThenDumped: true, minutesBilled: 12 }, { heldThenDumped: false, minutesBilled: 30 }, { heldThenDumped: true, minutesBilled: null }])).toBe(12);
  });
  it('validates fallback numbers', () => {
    expect(validatePracticeSettingsUpdate({ escalationFallbackNumbers: ['+16135550101'] } as never)).toBeNull();
    expect(validatePracticeSettingsUpdate({ escalationFallbackNumbers: ['6135550101'] } as never)).toMatch(/E\.164/);
    expect(validatePracticeSettingsUpdate({ escalationFallbackNumbers: ['+16135550101','+16135550102','+16135550103','+16135550104'] } as never)).toMatch(/up to 3/);
  });
});
