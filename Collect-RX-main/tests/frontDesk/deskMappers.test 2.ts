import { describe, expect, it } from 'vitest';
import type { CallQueue, InsuranceClaim } from '@prisma/client';
import { mapQueueEntry } from '../../src/server/frontDesk/deskMappers.js';

describe('mapQueueEntry', () => {
  it('exposes only structured, staff-facing dispatch deferral state', () => {
    const row = {
      id: 'queue-1',
      practiceId: 'practice-1',
      claimId: 'claim-1',
      scheduledFor: new Date('2026-07-13T12:00:00.000Z'),
      priority: 'NORMAL',
      attempts: 1,
      lastAttemptAt: null,
      dispatchDeferralCode: 'MISSING_REQUIRED_CLAIM_DATA',
      dispatchDeferralNextAction: 'Complete the required claim data in the PMS, then clear the recovery gate.',
      dispatchDeferredAt: new Date('2026-07-12T12:00:00.000Z'),
      status: 'PENDING',
      createdAt: new Date('2026-07-10T12:00:00.000Z'),
      updatedAt: new Date('2026-07-12T12:00:00.000Z'),
      claim: {
        claimNumber: 'CL-100',
        carrierId: 'sun_life',
        outstandingAmount: 123.45,
      },
    } as CallQueue & Pick<InsuranceClaim, 'claimNumber' | 'carrierId' | 'outstandingAmount'> & {
      claim: Pick<InsuranceClaim, 'claimNumber' | 'carrierId' | 'outstandingAmount'>;
    };

    expect(mapQueueEntry(row)).toMatchObject({
      claimRef: 'CRX-CL-100',
      dispatchDeferralCode: 'MISSING_REQUIRED_CLAIM_DATA',
      dispatchDeferralNextAction: 'Complete the required claim data in the PMS, then clear the recovery gate.',
      dispatchDeferredAt: '2026-07-12T12:00:00.000Z',
      heldReason: 'Complete the required claim data in the PMS, then clear the recovery gate.',
    });
  });
});
