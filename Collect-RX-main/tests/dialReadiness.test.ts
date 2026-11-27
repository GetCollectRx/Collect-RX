import { describe, it, expect } from 'vitest';
import { dialReadinessItems } from '../src/server/frontDesk/dialReadiness';
import type { PracticeSettings } from '../src/types/practiceSettings';

const base = { carrierConfigs: [], escalationPhoneNumber: '', humanAssistedMode: true } as unknown as PracticeSettings;
const get = (s: PracticeSettings, id: string) => dialReadinessItems(s).find((i) => i.id === id);

describe('dialReadinessItems', () => {
  it('flags everything on a fresh practice', () => {
    expect(dialReadinessItems(base).every((i) => !i.done)).toBe(true);
  });
  it('carrier needs enabled + letter + provider number', () => {
    const c = { carrierId: 'SUN_LIFE', enabled: true, authorizationSubmitted: true, providerNumber: '' };
    expect(get({ ...base, carrierConfigs: [c] }, 'carrier_authorized')!.done).toBe(false);
    expect(get({ ...base, carrierConfigs: [{ ...c, providerNumber: '123' }] }, 'carrier_authorized')!.done).toBe(true);
  });
  it('staff items only in human-assisted mode and need E.164 and windows', () => {
    expect(get({ ...base, humanAssistedMode: false }, 'staff_phone')).toBeUndefined();
    expect(get({ ...base, escalationPhoneNumber: '+16135550100' }, 'staff_phone')!.done).toBe(true);
    expect(get({ ...base, escalationPhoneNumber: '613 555 0100' }, 'staff_phone')!.done).toBe(false);
    const w = { windows: [{ days: [1], start: '09:00', end: '12:00' }] };
    expect(get({ ...base, staffAvailability: w }, 'staff_availability')!.done).toBe(true);
  });
});
