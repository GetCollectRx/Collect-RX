// Step 1 (DEC-10, DEC-2, AC1, AC8): the payer-program rule and the mode-aware
// over-90 rule live inside validateDispatch, so every path that dials gets them.
import { describe, expect, it } from 'vitest';
import type { PayerType, PrismaClient } from '@prisma/client';
import { validateDispatch } from '../../src/carriers/adapter';
import { PAYER_PROGRAM_ACTIVATION, evaluatePayerProgram } from '../../src/carriers/payerProgram';
import { defaultPracticeSettings } from '../../src/server/services/practiceSettingsService';

// Wednesday 12:00 Eastern: inside the call window.
const IN_WINDOW = new Date('2026-10-14T16:00:00.000Z');

function authorizedSettings() {
  return {
    ...defaultPracticeSettings(),
    voiceAgentEnabled: true,
    carrierConfigs: defaultPracticeSettings().carrierConfigs.map((c) =>
      c.carrierId === 'sun_life'
        ? {
            ...c,
            enabled: true,
            authorizationSubmitted: true,
            authorizationSubmittedAt: '2026-06-01T00:00:00.000Z',
            providerNumber: 'ON-123456',
          }
        : c,
    ),
  };
}

function makePrisma(claimOverrides: Record<string, unknown> = {}, blockingAction: unknown = null) {
  return {
    carrierBlockEvent: { findFirst: async () => null },
    organizationPractice: { findMany: async () => [] },
    insuranceClaim: {
      findUnique: async () => ({
        recoveryRoute: 'CALL_CARRIER',
        status: 'IN_QUEUE',
        queueEntry: { scheduledFor: new Date('2020-01-01'), status: 'PENDING' },
        ...claimOverrides,
      }),
    },
    claimRecoveryAction: { findFirst: async () => blockingAction },
    practice: { findUnique: async () => ({ settings: authorizedSettings() }) },
  } as unknown as PrismaClient;
}

function params(overrides: Partial<Parameters<typeof validateDispatch>[1]> = {}): Parameters<typeof validateDispatch>[1] {
  return {
    practiceId: 'practice-1',
    claimId: 'claim-1',
    carrierId: 'sun_life',
    daysOutstanding: 45,
    attemptsSoFar: 0,
    claimStatus: 'IN_QUEUE',
    scheduledFor: IN_WINDOW,
    payerType: 'PRIVATE',
    humanAssisted: true,
    ...overrides,
  };
}

describe('payer program activation (DEC-10)', () => {
  it('enables PRIVATE only', () => {
    expect(Object.entries(PAYER_PROGRAM_ACTIVATION).filter(([, r]) => r.enabled).map(([k]) => k)).toEqual(['PRIVATE']);
  });

  it('treats an unclassified claim as PRIVATE and says so', () => {
    expect(evaluatePayerProgram(null)).toMatchObject({ enabled: true, effectivePayerType: 'PRIVATE', assumed: true });
    expect(evaluatePayerProgram(undefined)).toMatchObject({ enabled: true, assumed: true });
    expect(evaluatePayerProgram('PRIVATE')).toMatchObject({ enabled: true, assumed: false });
  });

  it.each<[PayerType | null, boolean, boolean]>([
    ['PRIVATE', true, false],
    [null, true, true],
    ['CDCP', false, false],
    ['PROVINCIAL', false, false],
  ])('validateDispatch with payerType %s: allowed=%s, assumed=%s', async (payerType, allowed, assumed) => {
    const guard = await validateDispatch(makePrisma(), params({ payerType }));
    expect(guard.allowed).toBe(allowed);
    if (allowed) {
      expect(guard.payerTypeAssumed ?? false).toBe(assumed);
    } else {
      expect(guard.code).toBe('PAYER_PROGRAM_NOT_ENABLED');
      expect(guard.reason).toContain(payerType as string);
    }
  });

  it.each<boolean>([true, false])('refuses CDCP in either execution mode (humanAssisted=%s)', async (humanAssisted) => {
    const guard = await validateDispatch(makePrisma(), params({ payerType: 'CDCP', humanAssisted }));
    expect(guard).toMatchObject({ allowed: false, code: 'PAYER_PROGRAM_NOT_ENABLED' });
  });

  it('refuses a disabled program before the age rules, so the reason names the program', async () => {
    const guard = await validateDispatch(makePrisma(), params({ payerType: 'CDCP', daysOutstanding: 10 }));
    expect(guard.code).toBe('PAYER_PROGRAM_NOT_ENABLED');
  });
});

describe('claim age rules (WP1 acceptance, DEC-2)', () => {
  it('blocks a 29 day claim and allows a 30 day claim', async () => {
    expect((await validateDispatch(makePrisma(), params({ daysOutstanding: 29 }))).code).toBe('CLAIM_TOO_YOUNG');
    expect((await validateDispatch(makePrisma(), params({ daysOutstanding: 30 }))).allowed).toBe(true);
  });

  it('keeps the over-90 block in autonomous mode', async () => {
    const guard = await validateDispatch(makePrisma(), params({ daysOutstanding: 120, humanAssisted: false }));
    expect(guard).toMatchObject({ allowed: false, code: 'ESCALATE_OVER_90' });
  });

  it('does not block on age alone in Hold Sentinel mode, and records why it was allowed', async () => {
    const guard = await validateDispatch(makePrisma(), params({ daysOutstanding: 120, humanAssisted: true }));
    expect(guard).toMatchObject({ allowed: true, over90Evaluation: 'ALLOWED_HOLD_SENTINEL' });
  });

  it('still applies the attempt cap to an over-90 claim in Hold Sentinel mode', async () => {
    const guard = await validateDispatch(makePrisma(), params({ daysOutstanding: 120, attemptsSoFar: 3 }));
    expect(guard).toMatchObject({ allowed: false, code: 'MAX_ATTEMPTS' });
  });

  it.each([
    ['a stopped recovery route', { recoveryRoute: 'STOP' }, null],
    ['a practice gate route', { recoveryRoute: 'PRACTICE_GATE' }, null],
    ['an escalated claim that left the call route', { status: 'ESCALATED', recoveryRoute: 'PRACTICE_GATE' }, null],
    ['a future recall date', { queueEntry: { scheduledFor: new Date(Date.now() + 86_400_000), status: 'PENDING' } }, null],
    ['a blocking recovery action', {}, { title: 'Dispute open', actionType: 'DENIAL_REVIEW' }],
  ])('an over-90 claim with %s is refused in Hold Sentinel mode', async (_label, claimOverrides, blocking) => {
    const guard = await validateDispatch(
      makePrisma(claimOverrides, blocking),
      params({ daysOutstanding: 120, humanAssisted: true }),
    );
    expect(guard.allowed).toBe(false);
    expect(guard.code).toBe('RECOVERY_GATE');
  });
});
