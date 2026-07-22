import { describe, expect, it } from 'vitest';
import type { CallAttempt } from '@prisma/client';
import { buildMaxAttemptFailureReview } from '../../src/server/frontDesk/claimFailureReview.js';

function attempt(overrides: Partial<CallAttempt> = {}): CallAttempt {
  return {
    id: 'attempt',
    claimId: 'claim-1',
    vapiCallId: 'vapi-1',
    initiatedAt: new Date('2026-07-12T12:00:00.000Z'),
    completedAt: new Date('2026-07-12T12:02:00.000Z'),
    durationSeconds: 120,
    minutesBilled: 2,
    outcome: 'NO_ANSWER',
    outcomeDetail: 'Raw outcome text is intentionally excluded from the review.',
    repName: null,
    referenceNumber: null,
    transcriptUrl: null,
    transcriptText: 'Sensitive transcript content must not appear in the review.',
    evalCompletedAt: null,
    evalScores: null,
    carrierBlockDetected: false,
    liveState: null,
    activeAgent: null,
    pausedByStaffAt: null,
    pausedByStaffId: null,
    takenOverByStaffAt: null,
    takenOverByStaffId: null,
    createdAt: new Date('2026-07-12T12:00:00.000Z'),
    validationPassed: true,
    validationResult: null,
    ...overrides,
  };
}

describe('buildMaxAttemptFailureReview', () => {
  it('returns structured attempt and transcript availability without exposing transcript content', () => {
    const review = buildMaxAttemptFailureReview(
      'claim-1',
      'CL-100',
      'sun_life',
      [
        attempt({ id: 'attempt-2', initiatedAt: new Date('2026-07-12T13:00:00.000Z'), outcome: 'FAILED' }),
        attempt({ id: 'attempt-1', outcome: 'NO_ANSWER' }),
        attempt({ id: 'attempt-3', initiatedAt: new Date('2026-07-12T14:00:00.000Z'), outcome: 'HUNG_UP' }),
      ],
      [
        { recommendation: 'Use the approved carrier navigation path before a human follow-up.' },
        { recommendation: 'Do not show identifier 123456789.' },
      ],
    );

    expect(review.claimRef).toBe('CRX-CL-100');
    expect(review.attempts.map((item) => item.attemptNumber)).toEqual([1, 2, 3]);
    expect(review.attempts.map((item) => item.transcriptAvailable)).toEqual([true, true, true]);
    expect(review.recommendation).toMatch(/manual carrier follow-up/i);
    expect(review.approvedCarrierLessons).toEqual([
      'Use the approved carrier navigation path before a human follow-up.',
    ]);
    expect(JSON.stringify(review)).not.toContain('Sensitive transcript content');
    expect(JSON.stringify(review)).not.toContain('Raw outcome text');
  });

  it('prioritizes carrier-block safety over all other recommendations', () => {
    const review = buildMaxAttemptFailureReview(
      'claim-1',
      'CL-101',
      'sun_life',
      [attempt({ carrierBlockDetected: true, outcome: 'DENIED' })],
      [],
    );

    expect(review.recommendation).toMatch(/Do not retry/i);
    expect(review.recommendation).toMatch(/carrier block/i);
  });
});
