import { beforeEach, describe, expect, it, vi } from 'vitest';

const addMock = vi.fn();

vi.mock('../../src/server/jobs/arQueue.js', () => ({
  getArQueue: () => ({ add: addMock }),
}));

import { enqueuePreVisitJob } from '../../src/server/preVisit/preVisitJobs.js';

describe('enqueuePreVisitJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addMock.mockResolvedValue({ id: 'queued-job-1' });
  });

  it('gives a deferred call-window retry a stable, distinct idempotency key', async () => {
    const payload = {
      practiceId: 'practice-1',
      patientToken: 'token-1',
      carrierId: 'sun_life' as const,
      procedureCodes: ['D1110'],
      appointmentAt: '2026-07-15T15:00:00.000Z',
      appointmentVerificationId: 'verification-1',
    };

    await enqueuePreVisitJob(
      'PRE_VISIT_ELIGIBILITY',
      payload,
      60_000,
      'window:2026-07-13T12:00:00.000Z',
    );

    expect(addMock).toHaveBeenCalledWith('PRE_VISIT_ELIGIBILITY', payload, {
      jobId: 'pre-visit:PRE_VISIT_ELIGIBILITY:practice-1:token-1:sun_life:window:2026-07-13T12:00:00.000Z',
      delay: 60_000,
    });
  });
});
