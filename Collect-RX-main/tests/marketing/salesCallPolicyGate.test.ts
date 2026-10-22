import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Prospect } from '@prisma/client';
import { makeProspect } from '../factories/prospect.js';
import {
  ADAD_CONSENT_WITHDRAWN_ACTIVITY,
  ADAD_EXPRESS_CONSENT_ACTIVITY,
  AI_SALES_CALLS_ENABLED_ENV,
  HEALTHCARE_FACILITY_READING_ENV,
  SalesCallPolicyError,
  assertSalesCallPolicy,
  evaluateSalesCallPolicy,
  isWithinTelemarketingHours,
} from '../../src/server/marketing/salesCallPolicy.js';

// Tuesday 2026-10-13 15:00 UTC = 11:00 America/Toronto.
const WEEKDAY_MIDDAY_TORONTO = new Date('2026-10-13T15:00:00Z');
const prospect: Prospect = makeProspect({ phone: '4165550100', province: 'ON' });

interface ActivityRow {
  type: string;
  metadata: unknown;
}

function mockPrisma(latest: ActivityRow | null) {
  return {
    prospectActivity: {
      findFirst: vi.fn().mockResolvedValue(latest),
    },
  } as unknown as PrismaClient;
}

const bothFlags = {
  [AI_SALES_CALLS_ENABLED_ENV]: '1',
  [HEALTHCARE_FACILITY_READING_ENV]: '1',
} as NodeJS.ProcessEnv;

const validConsent: ActivityRow = {
  type: ADAD_EXPRESS_CONSENT_ACTIVITY,
  metadata: { phone: '+1 (416) 555-0100', form: 'electronic_internet' },
};

describe('evaluateSalesCallPolicy', () => {
  it('blocks by default when the feature flag is off', async () => {
    const prisma = mockPrisma(validConsent);
    const decision = await evaluateSalesCallPolicy(prisma, prospect, WEEKDAY_MIDDAY_TORONTO, {});
    expect(decision).toMatchObject({ allowed: false, code: 'AI_SALES_CALLS_DISABLED' });
    expect(prisma.prospectActivity.findFirst).not.toHaveBeenCalled();
  });

  it('blocks when the healthcare facility reading is not signed', async () => {
    const decision = await evaluateSalesCallPolicy(
      mockPrisma(validConsent),
      prospect,
      WEEKDAY_MIDDAY_TORONTO,
      { [AI_SALES_CALLS_ENABLED_ENV]: '1' } as NodeJS.ProcessEnv,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'HEALTHCARE_FACILITY_READING_UNSIGNED' });
  });

  it('blocks a prospect with no phone number', async () => {
    const decision = await evaluateSalesCallPolicy(
      mockPrisma(validConsent),
      { ...prospect, phone: null },
      WEEKDAY_MIDDAY_TORONTO,
      bothFlags,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'NO_PHONE_ON_FILE' });
  });

  it('blocks when no express consent is recorded', async () => {
    const decision = await evaluateSalesCallPolicy(mockPrisma(null), prospect, WEEKDAY_MIDDAY_TORONTO, bothFlags);
    expect(decision).toMatchObject({ allowed: false, code: 'ADAD_EXPRESS_CONSENT_MISSING' });
  });

  it('blocks when the latest record is a withdrawal', async () => {
    const decision = await evaluateSalesCallPolicy(
      mockPrisma({ type: ADAD_CONSENT_WITHDRAWN_ACTIVITY, metadata: null }),
      prospect,
      WEEKDAY_MIDDAY_TORONTO,
      bothFlags,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'ADAD_EXPRESS_CONSENT_WITHDRAWN' });
  });

  it('blocks consent recorded for a different number', async () => {
    const decision = await evaluateSalesCallPolicy(
      mockPrisma({ type: ADAD_EXPRESS_CONSENT_ACTIVITY, metadata: { phone: '6135550199', form: 'written' } }),
      prospect,
      WEEKDAY_MIDDAY_TORONTO,
      bothFlags,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'ADAD_EXPRESS_CONSENT_INVALID' });
  });

  it('blocks consent in a form the rules do not accept', async () => {
    const decision = await evaluateSalesCallPolicy(
      mockPrisma({ type: ADAD_EXPRESS_CONSENT_ACTIVITY, metadata: { phone: '4165550100', form: 'implied' } }),
      prospect,
      WEEKDAY_MIDDAY_TORONTO,
      bothFlags,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'ADAD_EXPRESS_CONSENT_INVALID' });
  });

  it('blocks outside telemarketing hours in the prospect local time', async () => {
    // 12:30 UTC = 08:30 Toronto.
    const decision = await evaluateSalesCallPolicy(
      mockPrisma(validConsent),
      prospect,
      new Date('2026-10-13T12:30:00Z'),
      bothFlags,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'OUTSIDE_TELEMARKETING_HOURS' });
  });

  it('allows only when every condition holds', async () => {
    const prisma = mockPrisma(validConsent);
    const decision = await evaluateSalesCallPolicy(prisma, prospect, WEEKDAY_MIDDAY_TORONTO, bothFlags);
    expect(decision).toEqual({ allowed: true });
    expect(prisma.prospectActivity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ prospectId: prospect.id }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

describe('isWithinTelemarketingHours', () => {
  it('uses the prospect province time zone, not Eastern', () => {
    // 16:30 UTC = 09:30 Vancouver (allowed) and 12:30 Toronto.
    expect(isWithinTelemarketingHours({ province: 'BC' }, new Date('2026-10-13T16:30:00Z'))).toBe(true);
    // 15:30 UTC = 08:30 Vancouver (blocked) while 11:30 Toronto.
    expect(isWithinTelemarketingHours({ province: 'BC' }, new Date('2026-10-13T15:30:00Z'))).toBe(false);
  });

  it('applies weekend hours of 10:00 to 18:00', () => {
    // Saturday 2026-10-17 13:30 UTC = 09:30 Toronto.
    expect(isWithinTelemarketingHours({ province: 'ON' }, new Date('2026-10-17T13:30:00Z'))).toBe(false);
    // Saturday 14:30 UTC = 10:30 Toronto.
    expect(isWithinTelemarketingHours({ province: 'ON' }, new Date('2026-10-17T14:30:00Z'))).toBe(true);
    // Saturday 22:30 UTC = 18:30 Toronto.
    expect(isWithinTelemarketingHours({ province: 'ON' }, new Date('2026-10-17T22:30:00Z'))).toBe(false);
  });

  it('ends weekday calls at 21:30', () => {
    // 01:29 UTC Wednesday = 21:29 Tuesday Toronto; 01:31 UTC = 21:31.
    expect(isWithinTelemarketingHours({ province: 'ON' }, new Date('2026-10-14T01:29:00Z'))).toBe(true);
    expect(isWithinTelemarketingHours({ province: 'ON' }, new Date('2026-10-14T01:31:00Z'))).toBe(false);
  });
});

describe('initiateProspectSalesCall wiring', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it('refuses before any Vapi request when the gate blocks', async () => {
    process.env.VAPI_API_KEY = 'test-key';
    process.env.VAPI_SALES_ASSISTANT_ID = 'test-assistant';
    process.env.VAPI_PHONE_NUMBER_ID = 'test-number';
    delete process.env[AI_SALES_CALLS_ENABLED_ENV];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { initiateProspectSalesCall } = await import('../../src/server/marketing/vapiSalesCall.js');
    await expect(initiateProspectSalesCall(mockPrisma(validConsent), prospect)).rejects.toMatchObject({
      code: 'AI_SALES_CALLS_DISABLED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('assertSalesCallPolicy', () => {
  beforeEach(() => {
    delete process.env[AI_SALES_CALLS_ENABLED_ENV];
    delete process.env[HEALTHCARE_FACILITY_READING_ENV];
  });
  afterEach(() => {
    delete process.env[AI_SALES_CALLS_ENABLED_ENV];
    delete process.env[HEALTHCARE_FACILITY_READING_ENV];
  });

  it('throws a typed error with the reason code', async () => {
    await expect(assertSalesCallPolicy(mockPrisma(validConsent), prospect, WEEKDAY_MIDDAY_TORONTO)).rejects.toMatchObject({
      name: 'SalesCallPolicyError',
      code: 'AI_SALES_CALLS_DISABLED',
    });
  });

  it('is an instance of SalesCallPolicyError', async () => {
    const err = await assertSalesCallPolicy(mockPrisma(validConsent), prospect, WEEKDAY_MIDDAY_TORONTO).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SalesCallPolicyError);
  });
});
