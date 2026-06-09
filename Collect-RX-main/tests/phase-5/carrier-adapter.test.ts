// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Carrier Adapter Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { isWithinCallWindow, CARRIER_CONFIGS, validateDispatch } from '../../src/carriers/adapter';

const prismaNoBlock = {
  carrierBlockEvent: { findFirst: async () => null },
  insuranceClaim: {
    findUnique: async () => ({
      recoveryRoute: 'CALL_CARRIER',
      status: 'IN_QUEUE',
      queueEntry: { scheduledFor: new Date('2020-01-01'), status: 'PENDING' },
    }),
  },
  claimRecoveryAction: { findFirst: async () => null },
} as unknown as PrismaClient;

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

  describe('validateDispatch', () => {
    it('rejects carrier dispatch when claim is APPROVED_PENDING_PAYMENT', async () => {
      const r = await validateDispatch(prismaNoBlock, {
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
      const r = await validateDispatch(prismaNoBlock, {
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
  });
});
