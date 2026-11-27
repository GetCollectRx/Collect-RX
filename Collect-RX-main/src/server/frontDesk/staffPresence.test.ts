import { describe, expect, it } from 'vitest';
import { PRESENCE_FRESH_MS, canTakeRep, hasCapacityToDial, isStatusReady } from './staffPresence';

describe('staff presence rules', () => {
  const now = new Date('2026-11-12T15:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('counts only a fresh AVAILABLE entry as ready', () => {
    expect(isStatusReady('AVAILABLE', minutesAgo(5), now)).toBe(true);
    expect(isStatusReady('BUSY', minutesAgo(5), now)).toBe(false);
    expect(isStatusReady('OFF', minutesAgo(5), now)).toBe(false);
  });

  it('treats a forgotten AVAILABLE as off once the freshness window passes', () => {
    const justInside = new Date(now.getTime() - PRESENCE_FRESH_MS + 1000);
    const justOutside = new Date(now.getTime() - PRESENCE_FRESH_MS - 1000);
    expect(isStatusReady('AVAILABLE', justInside, now)).toBe(true);
    expect(isStatusReady('AVAILABLE', justOutside, now)).toBe(false);
  });

  it('dials only with strictly more ready people than calls in flight', () => {
    expect(hasCapacityToDial(0, 0)).toBe(false);
    expect(hasCapacityToDial(1, 0)).toBe(true);
    expect(hasCapacityToDial(1, 1)).toBe(false);
    expect(hasCapacityToDial(2, 1)).toBe(true);
  });

  it('hands a rep over only when someone is ready and the open call fits within capacity', () => {
    expect(canTakeRep(0, 1)).toBe(false);
    expect(canTakeRep(1, 1)).toBe(true);
    expect(canTakeRep(1, 2)).toBe(false);
    expect(canTakeRep(2, 2)).toBe(true);
  });
});
