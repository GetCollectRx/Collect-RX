import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../pii-vault.js', () => ({
  piiVault: {
    detokenize: vi.fn(),
  },
}));

vi.mock('./cdanetTx23Client.js', () => ({
  submitTx23Inquiry: vi.fn(),
}));

vi.mock('../adjudication/writeAdjudicationEvent.js', () => ({
  writeAdjudicationEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/practiceSettingsService.js', () => ({
  getPracticeSettings: vi.fn().mockResolvedValue({
    carrierConfigs: [{ carrierId: 'telus_adjudicare', providerNumber: 'PROV-1' }],
  }),
}));

vi.mock('../../services/eligibility/engine.js', () => ({
  identifyTelusPlan: vi.fn(),
}));

import { checkTelusTx23Support, tryTelusTx23PreVisit } from './electronicPreVisit.js';
import { piiVault } from '../../pii-vault.js';
import { submitTx23Inquiry } from './cdanetTx23Client.js';
import { identifyTelusPlan } from '../../services/eligibility/engine.js';

// Real TELUS_TPA_CONFIGS entry ('000060' → Industrial Alliance) supports Tx23.
const SUPPORTED_TPA = { identifiedTpa: 'Industrial Alliance', confidence: 'high' as const };
const UNSUPPORTED_TPA = { identifiedTpa: 'Beneva', confidence: 'high' as const };

describe('checkTelusTx23Support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns supported:false for a non-TELUS carrier without detokenizing', () => {
    const result = checkTelusTx23Support('sun_life', 'tok-1');
    expect(result.supported).toBe(false);
    expect(piiVault.detokenize).not.toHaveBeenCalled();
  });

  it('flags support for a Tx23-capable TPA without submitting a live inquiry', () => {
    vi.mocked(piiVault.detokenize).mockReturnValue({
      success: true,
      phi: { subscriberId: 'MEMBER-1', groupPolicyNumber: 'GRP-1' },
    } as ReturnType<typeof piiVault.detokenize>);
    vi.mocked(identifyTelusPlan).mockReturnValue(
      SUPPORTED_TPA as unknown as ReturnType<typeof identifyTelusPlan>,
    );

    const result = checkTelusTx23Support('telus_adjudicare', 'tok-1');

    expect(result.supported).toBe(true);
    expect(submitTx23Inquiry).not.toHaveBeenCalled();
  });

  it('returns supported:false when the TPA does not support Tx23', () => {
    vi.mocked(piiVault.detokenize).mockReturnValue({
      success: true,
      phi: { subscriberId: 'MEMBER-1', groupPolicyNumber: 'GRP-1' },
    } as ReturnType<typeof piiVault.detokenize>);
    vi.mocked(identifyTelusPlan).mockReturnValue(
      UNSUPPORTED_TPA as unknown as ReturnType<typeof identifyTelusPlan>,
    );

    const result = checkTelusTx23Support('telus_adjudicare', 'tok-1');

    expect(result.supported).toBe(false);
    expect(result.reason).toBe('tx23_not_supported');
  });

  it('returns supported:false when detokenize fails', () => {
    vi.mocked(piiVault.detokenize).mockReturnValue({
      success: false,
      error: 'not found',
    } as ReturnType<typeof piiVault.detokenize>);

    const result = checkTelusTx23Support('telus_adjudicare', 'tok-1');

    expect(result.supported).toBe(false);
    expect(result.reason).toBe('detokenize_failed');
  });
});

describe('tryTelusTx23PreVisit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits a live Tx23 inquiry when the TPA supports it — worker path only', async () => {
    vi.mocked(piiVault.detokenize).mockReturnValue({
      success: true,
      phi: { subscriberId: 'MEMBER-1', groupPolicyNumber: 'GRP-1' },
    } as ReturnType<typeof piiVault.detokenize>);
    vi.mocked(identifyTelusPlan).mockReturnValue(
      SUPPORTED_TPA as unknown as ReturnType<typeof identifyTelusPlan>,
    );
    vi.mocked(submitTx23Inquiry).mockResolvedValue({
      resolved: true,
      eligibilityStatus: 'eligible',
      predeterminationStatus: 'approved',
    });

    const prisma = {} as PrismaClient;
    const result = await tryTelusTx23PreVisit(prisma, {
      practiceId: 'prac-1',
      patientToken: 'tok-1',
      carrierId: 'telus_adjudicare',
      procedureCodes: ['D2740'],
      appointmentVerificationId: 'av-1',
    });

    expect(submitTx23Inquiry).toHaveBeenCalledTimes(1);
    expect(result.resolved).toBe(true);
  });

  it('does not submit when identification fails', async () => {
    vi.mocked(piiVault.detokenize).mockReturnValue({
      success: false,
      error: 'not found',
    } as ReturnType<typeof piiVault.detokenize>);

    const prisma = {} as PrismaClient;
    const result = await tryTelusTx23PreVisit(prisma, {
      practiceId: 'prac-1',
      patientToken: 'tok-1',
      carrierId: 'telus_adjudicare',
      procedureCodes: ['D2740'],
      appointmentVerificationId: 'av-1',
    });

    expect(submitTx23Inquiry).not.toHaveBeenCalled();
    expect(result.resolved).toBe(false);
  });
});
