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
vi.mock('../../src/server/audit/auditLog.js', () => ({
  appendPhiAccessEvent: vi.fn(),
}));

import { dispatchPreVisitCall } from '../../src/server/preVisit/preVisitDispatch.js';
import { piiVault } from '../../src/pii-vault.js';
import { getPracticeSettings } from '../../src/server/services/practiceSettingsService.js';

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

  it.each([
    [true, true],
    [false, false],
  ])('sends CDCP calls through Hold Sentinel when humanAssistedMode is %s', async (mode, expected) => {
    isWithinCallWindowMock.mockReturnValue(true);
    initiatePreVisitCallMock.mockResolvedValue({ vapiCallId: 'call-1' });
    vi.mocked(piiVault.detokenize).mockReturnValue({
      success: true,
      phi: { patientName: 'Test Patient', dateOfBirth: '1980-01-01', subscriberId: 'S1', groupPolicyNumber: 'G1' },
    } as never);
    vi.mocked(getPracticeSettings).mockResolvedValue({
      carrierConfigs: [],
      escalationPhoneNumber: '4165550100',
      humanAssistedMode: mode,
    } as never);
    const prisma = {
      appointmentVerification: {
        findUnique: vi.fn().mockResolvedValue({ id: 'verification-1', attemptCount: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
      practice: { findUnique: vi.fn().mockResolvedValue({ name: 'CollectRx Demo Practice' }) },
    };

    await dispatchPreVisitCall(prisma as unknown as PrismaClient, 'PRE_VISIT_CDCP_PREDET', {
      practiceId: 'practice-1',
      patientToken: 'token-1',
      carrierId: 'sun_life',
      procedureCodes: ['D2740'],
      appointmentAt: '2026-07-15T15:00:00.000Z',
      appointmentVerificationId: 'verification-1',
    });

    expect(initiatePreVisitCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ cdcpContext: true, humanAssisted: expected }),
    );
  });
});
