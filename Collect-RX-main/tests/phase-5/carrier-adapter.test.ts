// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Carrier Adapter Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  isWithinCallWindow,
  CARRIER_CONFIGS,
  validateDispatch,
  checkCarrierAuthorizationGate,
} from '../../src/carriers/adapter';
import { defaultPracticeSettings } from '../../src/server/services/practiceSettingsService';
import carrierRulesJson from '../../src/services/eligibility/rules/carrier-configs.json';

function authorizedSettingsFor(carrierId: string) {
  return {
    ...defaultPracticeSettings(),
    voiceAgentEnabled: true,
    carrierConfigs: defaultPracticeSettings().carrierConfigs.map((c) =>
      c.carrierId === carrierId
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

function authorizedSettings() {
  return authorizedSettingsFor('sun_life');
}

function makePrisma(settings = authorizedSettings()) {
  return {
    carrierBlockEvent: { findFirst: async () => null },
    insuranceClaim: {
      findUnique: async () => ({
        recoveryRoute: 'CALL_CARRIER',
        status: 'IN_QUEUE',
        queueEntry: { scheduledFor: new Date('2020-01-01'), status: 'PENDING' },
      }),
    },
    claimRecoveryAction: { findFirst: async () => null },
    practice: {
      findUnique: async () => ({ settings }),
    },
  } as unknown as PrismaClient;
}

const originalPlanEnv = {
  STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID: process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID,
  SUBSCRIPTION_DEFAULT_MONTHLY_CLAIM_LIMIT: process.env.SUBSCRIPTION_DEFAULT_MONTHLY_CLAIM_LIMIT,
  SUBSCRIPTION_CLAIM_LIMIT_ENFORCE: process.env.SUBSCRIPTION_CLAIM_LIMIT_ENFORCE,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalPlanEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('CarrierAdapter', () => {
  describe('CARRIER_CONFIGS', () => {
    it('defines all 6 supported carriers', () => {
      const carriers = Object.keys(CARRIER_CONFIGS);
      expect(carriers).toContain('sun_life');
      expect(carriers).toContain('canada_life');
      expect(carriers).toContain('manulife');
      expect(carriers).toContain('green_shield');
      expect(carriers).toContain('rbc');
      expect(carriers).toContain('telus_adjudicare');
    });

    it('TELUS minWaitDays is 21 (not 32)', () => {
      expect(CARRIER_CONFIGS.telus_adjudicare.minWaitDays).toBe(21);
    });

    it('non-TELUS carriers have minWaitDays of 32', () => {
      const nonTelus = ['sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc'] as const;
      for (const c of nonTelus) {
        expect(CARRIER_CONFIGS[c].minWaitDays).toBe(32);
      }
    });

    it('TELUS is marked as a clearinghouse', () => {
      expect(CARRIER_CONFIGS.telus_adjudicare.isClearinghouse).toBe(true);
    });

    it('non-TELUS carriers are not clearinghouses', () => {
      expect(CARRIER_CONFIGS.sun_life.isClearinghouse).toBe(false);
    });

    it('minWaitDays comes from carrier-configs.json (minWaitDayForClaims)', () => {
      const rules = carrierRulesJson.carriers as Record<string, { minWaitDayForClaims?: number }>;
      for (const cfg of Object.values(CARRIER_CONFIGS)) {
        expect(cfg.minWaitDays).toBe(rules[cfg.carrierId]?.minWaitDayForClaims);
      }
    });

    it('avgHoldMinutes and ivrHints come from carrier-configs.json dispatch rules', () => {
      const rules = carrierRulesJson.carriers as Record<
        string,
        { dispatch?: { avgHoldMinutes: number; ivrHints: string[] } }
      >;
      for (const cfg of Object.values(CARRIER_CONFIGS)) {
        expect(cfg.avgHoldMinutes).toBe(rules[cfg.carrierId]?.dispatch?.avgHoldMinutes);
        expect(cfg.ivrHints).toEqual(rules[cfg.carrierId]?.dispatch?.ivrHints);
        expect(cfg.ivrHints.length).toBeGreaterThan(0);
      }
    });

    it('all carriers have a non-empty phone number', () => {
      for (const cfg of Object.values(CARRIER_CONFIGS)) {
        expect(cfg.phone).toMatch(/^\+1\d{10}$/);
      }
    });
  });

  describe('isWithinCallWindow', () => {
    it('returns false for Saturday', () => {
      // Saturday 2024-04-06 10:00 Eastern
      const sat = new Date('2024-04-06T14:00:00Z'); // 10am Eastern (UTC-4)
      expect(isWithinCallWindow(sat)).toBe(false);
    });

    it('returns false for Sunday', () => {
      const sun = new Date('2024-04-07T14:00:00Z');
      expect(isWithinCallWindow(sun)).toBe(false);
    });

    it('returns false before 8am Eastern on a weekday', () => {
      // Monday 2024-04-08 07:00 Eastern = 11:00 UTC
      const early = new Date('2024-04-08T11:00:00Z');
      expect(isWithinCallWindow(early)).toBe(false);
    });

    it('returns false after 5pm Eastern on a weekday', () => {
      // Monday 2024-04-08 17:30 Eastern = 21:30 UTC
      const late = new Date('2024-04-08T21:30:00Z');
      expect(isWithinCallWindow(late)).toBe(false);
    });

    it('returns true for 10am Eastern on Monday', () => {
      // Monday 2024-04-08 10:00 Eastern = 14:00 UTC
      const mid = new Date('2024-04-08T14:00:00Z');
      expect(isWithinCallWindow(mid)).toBe(true);
    });
  });

  describe('checkCarrierAuthorizationGate', () => {
    it('rejects when BAAL not on file', async () => {
      const settings = authorizedSettings();
      settings.carrierConfigs = settings.carrierConfigs.map((c) =>
        c.carrierId === 'sun_life' ? { ...c, authorizationSubmitted: false } : c,
      );
      const r = await checkCarrierAuthorizationGate(makePrisma(settings), 'practice-1', 'sun_life');
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/BAAL/i);
    });

    it('rejects when provider number is missing', async () => {
      const settings = authorizedSettings();
      settings.carrierConfigs = settings.carrierConfigs.map((c) =>
        c.carrierId === 'sun_life' ? { ...c, providerNumber: '' } : c,
      );
      const r = await checkCarrierAuthorizationGate(makePrisma(settings), 'practice-1', 'sun_life');
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/provider number/i);
    });

    it('rejects when voice agent is disabled', async () => {
      const settings = authorizedSettings();
      settings.voiceAgentEnabled = false;
      const r = await checkCarrierAuthorizationGate(makePrisma(settings), 'practice-1', 'sun_life');
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/voice agent/i);
    });

    it('allows when BAAL, provider number, and voice agent are configured', async () => {
      const r = await checkCarrierAuthorizationGate(makePrisma(), 'practice-1', 'sun_life');
      expect(r.allowed).toBe(true);
    });
  });

  describe('validateDispatch', () => {
    it('rejects carrier dispatch when claim is APPROVED_PENDING_PAYMENT', async () => {
      const r = await validateDispatch(makePrisma(), {
        practiceId: 'practice-1',
        claimId: 'claim-test-1',
        carrierId: 'sun_life',
        daysOutstanding: 45,
        attemptsSoFar: 0,
        scheduledFor: new Date('2026-05-11T14:00:00Z'),
        claimStatus: 'APPROVED_PENDING_PAYMENT',
      });
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/APPROVED_PENDING_PAYMENT/i);
    });

    it('allows PENDING claims during the carrier call window', async () => {
      const r = await validateDispatch(makePrisma(), {
        practiceId: 'practice-1',
        claimId: 'claim-test-1',
        carrierId: 'sun_life',
        daysOutstanding: 45,
        attemptsSoFar: 0,
        scheduledFor: new Date('2026-05-11T14:00:00Z'),
        claimStatus: 'PENDING',
      });
      expect(r.allowed).toBe(true);
    });

    it('rejects when BAAL not on file', async () => {
      const settings = authorizedSettings();
      settings.carrierConfigs = settings.carrierConfigs.map((c) =>
        c.carrierId === 'sun_life' ? { ...c, authorizationSubmitted: false } : c,
      );
      const r = await validateDispatch(makePrisma(settings), {
        practiceId: 'practice-1',
        claimId: 'claim-test-1',
        carrierId: 'sun_life',
        daysOutstanding: 45,
        attemptsSoFar: 0,
        scheduledFor: new Date('2026-05-11T14:00:00Z'),
        claimStatus: 'PENDING',
      });
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/BAAL/i);
    });

    describe('carrier-specific minimum wait days (AA-07)', () => {
      it('allows a TELUS claim at day 25 — below the old flat 30-day floor, above TELUS\'s real 21-day minimum', async () => {
        const r = await validateDispatch(makePrisma(authorizedSettingsFor('telus_adjudicare')), {
          practiceId: 'practice-1',
          claimId: 'claim-test-1',
          carrierId: 'telus_adjudicare',
          daysOutstanding: 25,
          attemptsSoFar: 0,
          scheduledFor: new Date('2026-05-11T14:00:00Z'),
          claimStatus: 'PENDING',
        });
        expect(r.allowed).toBe(true);
      });

      it('rejects a TELUS claim at day 15 — below TELUS\'s 21-day minimum', async () => {
        const r = await validateDispatch(makePrisma(authorizedSettingsFor('telus_adjudicare')), {
          practiceId: 'practice-1',
          claimId: 'claim-test-1',
          carrierId: 'telus_adjudicare',
          daysOutstanding: 15,
          attemptsSoFar: 0,
          scheduledFor: new Date('2026-05-11T14:00:00Z'),
          claimStatus: 'PENDING',
        });
        expect(r.allowed).toBe(false);
        expect(r.code).toBe('CLAIM_TOO_YOUNG');
      });

      it('rejects a non-TELUS claim at day 30 — the old flat floor let this through, but the real minimum is 32', async () => {
        const r = await validateDispatch(makePrisma(), {
          practiceId: 'practice-1',
          claimId: 'claim-test-1',
          carrierId: 'sun_life',
          daysOutstanding: 30,
          attemptsSoFar: 0,
          scheduledFor: new Date('2026-05-11T14:00:00Z'),
          claimStatus: 'PENDING',
        });
        expect(r.allowed).toBe(false);
        expect(r.code).toBe('CLAIM_TOO_YOUNG');
      });

      it('allows a non-TELUS claim at day 32', async () => {
        const r = await validateDispatch(makePrisma(), {
          practiceId: 'practice-1',
          claimId: 'claim-test-1',
          carrierId: 'sun_life',
          daysOutstanding: 32,
          attemptsSoFar: 0,
          scheduledFor: new Date('2026-05-11T14:00:00Z'),
          claimStatus: 'PENDING',
        });
        expect(r.allowed).toBe(true);
      });
    });

    function makePrismaAtSubscriptionLimit(callAttemptFindFirst: () => Promise<{ id: string } | null>) {
      return {
        carrierBlockEvent: { findFirst: async () => null },
        insuranceClaim: {
          findUnique: async () => ({
            recoveryRoute: 'CALL_CARRIER',
            status: 'IN_QUEUE',
            queueEntry: { scheduledFor: new Date('2020-01-01'), status: 'PENDING' },
          }),
        },
        claimRecoveryAction: { findFirst: async () => null },
        practice: {
          findUnique: async () => ({
            settings: authorizedSettings(),
            subscriptionStatus: 'active',
            subscriptionPriceId: 'price_standard',
            subscriptionPlanId: 'standard',
            subscriptionCurrentPeriodStart: new Date('2026-05-01T00:00:00Z'),
            subscriptionCurrentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
          }),
        },
        callAttempt: {
          findMany: async () => [{ claimId: 'claim-already-addressed' }],
          findFirst: callAttemptFindFirst,
        },
      } as unknown as PrismaClient;
    }

    it('claim-count limits are retired — dispatch is not blocked by claim volume (minutes are the meter)', async () => {
      process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID = 'price_standard';
      process.env.SUBSCRIPTION_DEFAULT_MONTHLY_CLAIM_LIMIT = '1';
      const prismaAtLimit = makePrismaAtSubscriptionLimit(async () => null);

      const r = await validateDispatch(prismaAtLimit, {
        practiceId: 'practice-1',
        claimId: 'claim-new',
        carrierId: 'sun_life',
        daysOutstanding: 45,
        attemptsSoFar: 0,
        scheduledFor: new Date('2026-05-11T14:00:00Z'),
        claimStatus: 'PENDING',
      });

      expect(r.allowed).toBe(true);
    });

    it('allows a retry for a claim already counted in the current claim period', async () => {
      process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID = 'price_standard';
      process.env.SUBSCRIPTION_DEFAULT_MONTHLY_CLAIM_LIMIT = '1';
      const prismaAtLimit = makePrismaAtSubscriptionLimit(async () => ({ id: 'attempt-1' }));

      const r = await validateDispatch(prismaAtLimit, {
        practiceId: 'practice-1',
        claimId: 'claim-already-addressed',
        carrierId: 'sun_life',
        daysOutstanding: 45,
        attemptsSoFar: 1,
        scheduledFor: new Date('2026-05-11T14:00:00Z'),
        claimStatus: 'PENDING',
      });

      expect(r.allowed).toBe(true);
    });
  });
});
