import { describe, it, expect } from 'vitest';
import { evaluateStaffAvailability } from '../src/server/frontDesk/staffAvailability';
import { validatePracticeSettingsUpdate } from '../src/server/services/practiceSettingsService';

// 2026-11-10 is a Tuesday. Eastern is UTC-5 in November.
const tue = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h + 5, m));
const sa = { windows: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }] };

describe('evaluateStaffAvailability', () => {
  it('allows when unconfigured', () => {
    expect(evaluateStaffAvailability(undefined, tue(3)).available).toBe(true);
    expect(evaluateStaffAvailability({ windows: [] }, tue(3)).available).toBe(true);
  });
  it('allows inside a window, honoring lead and tail', () => {
    expect(evaluateStaffAvailability(sa, tue(8, 44)).available).toBe(false); // before 08:45
    expect(evaluateStaffAvailability(sa, tue(8, 45)).available).toBe(true);
    expect(evaluateStaffAvailability(sa, tue(11, 29)).available).toBe(true);
    expect(evaluateStaffAvailability(sa, tue(11, 30)).available).toBe(false); // tail 30
  });
  it('blocks on days not listed', () => {
    const sat = new Date(Date.UTC(2026, 10, 14, 17, 0));
    expect(evaluateStaffAvailability(sa, sat).available).toBe(false);
  });
  it('pause overrides windows until it expires', () => {
    const paused = { ...sa, pausedUntil: tue(11).toISOString() };
    expect(evaluateStaffAvailability(paused, tue(10)).available).toBe(false);
    expect(evaluateStaffAvailability(paused, tue(11, 1)).available).toBe(true);
  });
});

describe('validatePracticeSettingsUpdate staffAvailability', () => {
  it('accepts a valid config', () => {
    expect(validatePracticeSettingsUpdate({ staffAvailability: sa } as never)).toBeNull();
  });
  it('rejects bad days, times, order and short windows', () => {
    const bad = (w: object) => validatePracticeSettingsUpdate({ staffAvailability: { windows: [w] } } as never);
    expect(bad({ days: [6], start: '09:00', end: '12:00' })).toMatch(/days/);
    expect(bad({ days: [1], start: '9:00', end: '12:00' })).toMatch(/HH:MM/);
    expect(bad({ days: [1], start: '12:00', end: '09:00' })).toMatch(/before end/);
    expect(bad({ days: [1], start: '09:00', end: '09:15' })).toMatch(/too short/);
  });
});

import { checkStaffAvailabilityGate } from '../src/carriers/adapter';

const prismaWith = (settings: object) =>
  ({ practice: { findUnique: async () => ({ settings }) } }) as never;

describe('checkStaffAvailabilityGate', () => {
  it('returns STAFF_UNAVAILABLE outside windows in human-assisted mode', async () => {
    const g = await checkStaffAvailabilityGate(prismaWith({ staffAvailability: sa }), 'p1', tue(14));
    expect(g).toMatchObject({ allowed: false, code: 'STAFF_UNAVAILABLE' });
  });
  it('allows inside windows', async () => {
    const g = await checkStaffAvailabilityGate(prismaWith({ staffAvailability: sa }), 'p1', tue(10));
    expect(g.allowed).toBe(true);
  });
  it('ignores availability when human-assisted mode is off', async () => {
    const g = await checkStaffAvailabilityGate(
      prismaWith({ staffAvailability: sa, humanAssistedMode: false }), 'p1', tue(14));
    expect(g.allowed).toBe(true);
  });
  it('allows when nothing is configured', async () => {
    expect((await checkStaffAvailabilityGate(prismaWith({}), 'p1', tue(14))).allowed).toBe(true);
  });
});

describe('B-26 time zone', () => {
  it('evaluates windows in the practice time zone', () => {
    const w = { windows: [{ days: [2], start: '09:00', end: '12:00' }] };
    // 17:30 UTC Tuesday = 09:30 Vancouver (PST) = 12:30 Toronto (closed).
    const t = new Date(Date.UTC(2026, 10, 10, 17, 30));
    expect(evaluateStaffAvailability(w, t, 'America/Vancouver').available).toBe(true);
    expect(evaluateStaffAvailability(w, t, 'America/Toronto').available).toBe(false);
  });
  it('rejects an invalid zone', () => {
    expect(validatePracticeSettingsUpdate({ staffTimeZone: 'Mars/Base' } as never)).toMatch(/time zone/);
    expect(validatePracticeSettingsUpdate({ staffTimeZone: 'America/Vancouver' } as never)).toBeNull();
  });
});
