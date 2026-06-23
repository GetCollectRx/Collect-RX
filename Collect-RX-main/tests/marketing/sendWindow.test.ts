import { describe, expect, it, vi, afterEach } from 'vitest';
import { isWithinColdSendWindow, timezoneForProspect } from '../../src/server/marketing/sendWindow.js';

describe('sendWindow', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps Ontario to America/Toronto', () => {
    expect(timezoneForProspect({ province: 'ON' })).toBe('America/Toronto');
  });

  it('allows send Tue 9:30am Toronto when window enabled', () => {
    vi.stubEnv('MARKETING_SEND_WINDOW_DISABLED', '');
    // Tue 2026-06-16 13:30 UTC = 9:30 EDT Toronto
    const tue930 = new Date('2026-06-16T13:30:00.000Z');
    expect(isWithinColdSendWindow({ province: 'ON' }, tue930)).toBe(true);
  });

  it('blocks send on Monday', () => {
    vi.stubEnv('MARKETING_SEND_WINDOW_DISABLED', '');
    const monday = new Date('2026-06-15T13:30:00.000Z');
    expect(isWithinColdSendWindow({ province: 'ON' }, monday)).toBe(false);
  });

  it('blocks send outside 9-10am window', () => {
    vi.stubEnv('MARKETING_SEND_WINDOW_DISABLED', '');
    const tue2pm = new Date('2026-06-16T18:00:00.000Z');
    expect(isWithinColdSendWindow({ province: 'ON' }, tue2pm)).toBe(false);
  });

  it('bypasses window when MARKETING_SEND_WINDOW_DISABLED=1', () => {
    vi.stubEnv('MARKETING_SEND_WINDOW_DISABLED', '1');
    const monday = new Date('2026-06-15T13:30:00.000Z');
    expect(isWithinColdSendWindow({ province: 'ON' }, monday)).toBe(true);
  });
});
