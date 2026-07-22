import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  HELD_THEN_DUMPED_MIN_SECONDS,
  getPracticeHoldLedger,
  isHeldThenDumped,
} from '../../src/server/recovery/holdLedger.js';

describe('isHeldThenDumped', () => {
  it('flags a long no-engagement call as a dumped hold', () => {
    expect(
      isHeldThenDumped({
        outcome: 'HUNG_UP',
        durationSeconds: HELD_THEN_DUMPED_MIN_SECONDS + 60,
        repName: null,
        referenceNumber: null,
      }),
    ).toBe(true);
  });

  it('never flags short calls — they simply failed to connect', () => {
    expect(
      isHeldThenDumped({
        outcome: 'HUNG_UP',
        durationSeconds: HELD_THEN_DUMPED_MIN_SECONDS - 1,
        repName: null,
        referenceNumber: null,
      }),
    ).toBe(false);
  });

  it('never flags calls where a rep engaged', () => {
    expect(
      isHeldThenDumped({
        outcome: 'HUNG_UP',
        durationSeconds: 2400,
        repName: 'agent on record',
        referenceNumber: null,
      }),
    ).toBe(false);
    expect(
      isHeldThenDumped({
        outcome: 'FAILED',
        durationSeconds: 2400,
        repName: null,
        referenceNumber: 'REF-1234',
      }),
    ).toBe(false);
  });

  it('never flags substantive outcomes regardless of duration', () => {
    expect(
      isHeldThenDumped({
        outcome: 'RESOLVED',
        durationSeconds: 3000,
        repName: null,
        referenceNumber: null,
      }),
    ).toBe(false);
    expect(
      isHeldThenDumped({
        outcome: null,
        durationSeconds: 3000,
        repName: null,
        referenceNumber: null,
      }),
    ).toBe(false);
  });
});

describe('getPracticeHoldLedger', () => {
  it('returns practice-scoped aggregate data without call or patient details', async () => {
    const findMany = vi.fn(async () => [
      { heldThenDumped: true, claim: { carrierId: 'sun_life' } },
      { heldThenDumped: false, claim: { carrierId: 'sun_life' } },
      { heldThenDumped: true, claim: { carrierId: 'rbc' } },
    ]);
    const prisma = {
      callAttempt: { findMany },
    } as unknown as PrismaClient;

    await expect(getPracticeHoldLedger(prisma, 'practice-a')).resolves.toEqual([
      { carrierId: 'sun_life', completedCalls: 2, dumpedHolds: 1, dumpRate: null },
      { carrierId: 'rbc', completedCalls: 1, dumpedHolds: 1, dumpRate: null },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ claim: { practiceId: 'practice-a' } }),
    }));
  });
});
