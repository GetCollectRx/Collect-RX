// Step 1: the shared call builder, mode resolver and carrier dial resolution.
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../src/server/learning/carrierLessons.js', () => ({
  getApprovedNavigationNotes: vi.fn(async () => 'learned note'),
}));
vi.mock('../../src/server/learning/submissionChannelMemory.js', () => ({
  getKnownSubmissionChannel: vi.fn(async (_p: unknown, _c: unknown, type: string) =>
    type === 'CLAIM_RESUBMISSION' ? 'portal upload' : 'fax to 555-0100',
  ),
}));
vi.mock('../../src/server/discovery/carrierDiscoveryService.js', () => ({
  getPublishedNavigationSteps: vi.fn(async () => ['published step']),
}));
const telusPhone = vi.hoisted(() => ({ value: '+18005550111' as string | null }));
vi.mock('../../src/carriers/adapter.js', () => ({
  CARRIER_CONFIGS: {
    sun_life: { phone: '+18005550100', ivrHints: ['Press 2'] },
    telus_adjudicare: { phone: '+18005550199', ivrHints: [] },
  },
  getTelusDialPhone: () => telusPhone.value,
}));

import {
  buildVapiCallParams,
  loadCarrierCallHints,
  loadPracticeCallContext,
  resolveCarrierDial,
} from '../../src/server/frontDesk/dispatchCallBuilder.js';
import { dispatchModeFor } from '../../src/server/frontDesk/dispatchDecision.js';

const phi = {
  patientName: 'Test Patient',
  dateOfBirth: '1990-01-02',
  subscriberId: 'SUB-1',
  groupPolicyNumber: 'GRP-1',
  subscriberName: 'Test Subscriber',
  subscriberDateOfBirth: '1960-03-04',
};

describe('dispatchModeFor', () => {
  it('sends a human-assisted practice to the human-assisted squad', () => {
    expect(dispatchModeFor(true)).toMatchObject({ humanAssisted: true });
    expect(dispatchModeFor(true).squadId).toBeTruthy();
  });
  it('leaves squadId unset for an autonomous practice', () => {
    expect(dispatchModeFor(false)).toEqual({ humanAssisted: false, squadId: undefined });
  });
});

describe('resolveCarrierDial', () => {
  it('uses the configured number for a normal carrier', () => {
    expect(resolveCarrierDial('sun_life', phi)).toEqual({ ok: true, carrierPhone: '+18005550100' });
  });
  it('uses the verified TPA number for TELUS', () => {
    telusPhone.value = '+18005550111';
    expect(resolveCarrierDial('telus_adjudicare', phi)).toEqual({ ok: true, carrierPhone: '+18005550111' });
  });
  it('refuses TELUS when no TPA number is verified, never falling back to the placeholder', () => {
    telusPhone.value = null;
    expect(resolveCarrierDial('telus_adjudicare', phi)).toEqual({ ok: false, code: 'TELUS_TPA_PHONE_UNVERIFIED' });
  });
});

describe('loadPracticeCallContext', () => {
  const settings = {
    billingPhone: '  ',
    escalationPhoneNumber: '+14165550101',
    carrierConfigs: [{ carrierId: 'sun_life', providerNumber: 'ON-1', languagePreference: 'fr' }],
  };
  const prismaWith = (billingPhone: string | null) =>
    ({
      practice: {
        findUnique: vi.fn(async () => ({
          name: 'Demo Practice',
          billingPhone,
          npi: 'NPI-1',
          taxId: null,
          practiceAddress: '1 Main St',
        })),
      },
    }) as unknown as PrismaClient;

  it('prefers the settings billing line, then the practice column, then the staff line last', async () => {
    const withColumn = await loadPracticeCallContext(prismaWith('+14165550102'), 'p1', 'sun_life', settings as never);
    expect(withColumn.practicePhone).toBe('+14165550102');
    const withoutColumn = await loadPracticeCallContext(prismaWith(null), 'p1', 'sun_life', settings as never);
    expect(withoutColumn.practicePhone).toBe('+14165550101');
    const settingsWin = await loadPracticeCallContext(
      prismaWith('+14165550102'),
      'p1',
      'sun_life',
      { ...settings, billingPhone: '+14165550103' } as never,
    );
    expect(settingsWin.practicePhone).toBe('+14165550103');
  });

  it('reads provider number and language for the carrier, defaulting language to English', async () => {
    const ctx = await loadPracticeCallContext(prismaWith(null), 'p1', 'sun_life', settings as never);
    expect(ctx).toMatchObject({ providerNumber: 'ON-1', languagePreference: 'fr', practiceAddress: '1 Main St' });
    const other = await loadPracticeCallContext(prismaWith(null), 'p1', 'manulife', settings as never);
    expect(other).toMatchObject({ providerNumber: '', languagePreference: 'en' });
  });
});

describe('buildVapiCallParams', () => {
  it('assembles the full variable set from one place', async () => {
    const hints = await loadCarrierCallHints({} as PrismaClient, 'sun_life');
    expect(hints).toEqual({
      carrierIvrInstructions: 'Press 2 | published step | learned note',
      knownResubmissionChannel: 'portal upload',
      knownDocumentationChannel: 'fax to 555-0100',
    });
    const params = buildVapiCallParams({
      practiceId: 'p1',
      claim: {
        id: 'claim-1',
        carrierId: 'sun_life',
        patientToken: 'tok-1',
        claimNumber: 'CN-1',
        billedAmount: '250.00',
        outstandingAmount: '200.00',
        expectedAmount: null,
        daysOutstanding: 45,
        servicedAt: new Date('2026-08-01T00:00:00Z'),
        submittedAt: null,
        treatmentCodes: 'D1110',
      },
      phi,
      carrierPhone: '+18005550100',
      context: {
        practiceName: 'Demo Practice',
        practiceNpi: 'NPI-1',
        practiceTaxId: undefined,
        practiceAddress: '1 Main St',
        practicePhone: '+14165550100',
        providerNumber: 'ON-1',
        languagePreference: 'en',
        settings: {} as never,
      },
      hints,
      mode: dispatchModeFor(true),
      attemptNumber: 2,
    });
    expect(params).toMatchObject({
      claimId: 'claim-1',
      patientToken: 'tok-1',
      patientName: 'Test Patient',
      policyNumber: 'SUB-1',
      groupNumber: 'GRP-1',
      carrierPhone: '+18005550100',
      billedAmount: 250,
      outstandingAmount: 200,
      amountExpected: undefined,
      treatmentDate: '2026-08-01',
      treatmentCodes: 'D1110',
      practiceAddress: '1 Main St',
      providerNumber: 'ON-1',
      squadId: dispatchModeFor(true).squadId,
      knownResubmissionChannel: 'portal upload',
      idempotencyKey: 'claim-1:2',
    });
  });
});
