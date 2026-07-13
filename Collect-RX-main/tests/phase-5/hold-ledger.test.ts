import { describe, expect, it } from 'vitest';
import {
  HELD_THEN_DUMPED_MIN_SECONDS,
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
