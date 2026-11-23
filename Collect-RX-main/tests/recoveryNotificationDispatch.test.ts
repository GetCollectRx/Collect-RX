import { afterEach, describe, expect, it, vi } from 'vitest';

const opsMocks = vi.hoisted(() => ({
  dispatchOpsAlert: vi.fn().mockResolvedValue({
    sent: true,
    channels: ['email'],
    skippedCooldown: false,
  }),
}));

vi.mock('../src/server/observability/opsAlerts.js', () => ({
  dispatchOpsAlert: opsMocks.dispatchOpsAlert,
  opsAlertsEnabled: () => true,
}));

vi.mock('../src/server/db/rlsContext.js', () => ({
  runWithPracticeRls: (_practiceId: string, fn: () => unknown) => fn(),
}));

import { dispatchRecoveryPracticeAlerts } from '../src/server/recovery/recoveryNotifications.js';

describe('recovery attention dispatch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('restricts the optional external digest to email and webhook', async () => {
    vi.stubEnv('RECOVERY_ATTENTION_EXTERNAL_ALERTS_ENABLED', '1');
    const prisma = {
      claimRecoveryAction: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'gate-1',
              title: 'Attach perio chart',
              detail: null,
              claimId: 'claim-1',
              claim: { id: 'claim-1', claimNumber: 'CL-1' },
            },
          ])
          .mockResolvedValueOnce([]),
      },
    };

    await dispatchRecoveryPracticeAlerts(prisma as never, 'practice-1');

    expect(opsMocks.dispatchOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertId: 'recovery-practice-attention',
        channels: ['email', 'webhook'],
      }),
    );
  });
});
