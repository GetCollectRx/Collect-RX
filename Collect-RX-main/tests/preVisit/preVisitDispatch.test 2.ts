import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const isWithinCallWindowMock = vi.fn();
const nextCallWindowStartMock = vi.fn();
const initiatePreVisitCallMock = vi.fn();
const checkCarrierBlockMock = vi.fn();
const checkCarrierAuthorizationGateMock = vi.fn();
const canMakeCallMock = vi.fn();

vi.mock('../../src/carriers/adapter.js', () => ({
  CARRIER_CONFIGS: {},
  checkCarrierAuthorizationGate: (...args: unknown[]) => checkCarrierAuthorizationGateMock(...args),
  checkCarrierBlock: (...args: unknown[]) => checkCarrierBlockMock(...args),
  isWithinCallWindow: (...args: unknown[]) => isWithinCallWindowMock(...args),
  nextCallWindowStart: (...args: unknown[]) => nextCallWindowStartMock(...args),
}));
vi.mock('../../src/vapi/client.js', () => ({
  initiatePreVisitCall: (...args: unknown[]) => initiatePreVisitCallMock(...args),
}));
vi.mock('../../src/pii-vault.js', () => ({
  piiVault: { detokenize: vi.fn() },
}));
vi.mock('../../src/server/services/practiceSettingsService.js', () => ({
  getPracticeSettings: vi.fn(),
}));
vi.mock('../../src/server/plans/planBridge.js', () => ({
  canMakeCall: (...args: unknown[]) => canMakeCallMock(...args),
}));
vi.mock('../../src/server/adjudication/writeAdjudicationEvent.js', () => ({
  writeAdjudicationEvent: vi.fn(),
}));

import { dispatchPreVisitCall } from '../../src/server/preVisit/preVisitDispatch.js';

describe('dispatchPreVisitCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkCarrierBlockMock.mockResolvedValue({ allowed: true });
    checkCarrierAuthorizationGateMock.mockResolvedValue({ allowed: true });
    canMakeCallMock.mockResolvedValue({ allowed: true });
  });

  it('defers pre-visit calls to the shared carrier call window without dispatching Vapi', async () => {
    const retryAt = new Date('2026-07-13T12:00:00.000Z');
    isWithinCallWindowMock.mockReturnValue(false);
    nextCallWindowStartMock.mockReturnValue(retryAt);
    const prisma = {
      appointmentVerification: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'verification-1',
          attemptCount: 0,
        }),
      },
    };

    const result = await dispatchPreVisitCall(
      prisma as unknown as PrismaClient,
      'PRE_VISIT_ELIGIBILITY',
      {
        practiceId: 'practice-1',
        patientToken: 'token-1',
        carrierId: 'sun_life',
        procedureCodes: ['D1110'],
        appointmentAt: '2026-07-15T15:00:00.000Z',
        appointmentVerificationId: 'verification-1',
      },
    );

    expect(result).toEqual({
      deferred: true,
      reason: 'outside_call_window',
      retryAt,
    });
    expect(initiatePreVisitCallMock).not.toHaveBeenCalled();
  });
});
