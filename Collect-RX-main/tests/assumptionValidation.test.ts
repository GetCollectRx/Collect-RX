import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  computeAssumptionValidation,
  parseValidationWindow,
} from '../src/server/services/assumptionValidation';

const NOW = new Date('2026-07-15T15:00:00Z');

function makePrisma(
  attempts: Array<{ outcome: string; claim: { billedAmount: number } }>,
  billingTier = 'core',
) {
  return {
    callAttempt: { findMany: async () => attempts },
    practice: { findUnique: async () => ({ billingTier }) },
  } as unknown as PrismaClient;
}

describe('parseValidationWindow', () => {
  it('accepts 30, 60, 90 and defaults everything else to 30', () => {
    expect(parseValidationWindow('60')).toBe(60);
    expect(parseValidationWindow('90')).toBe(90);
    expect(parseValidationWindow('45')).toBe(30);
    expect(parseValidationWindow(undefined)).toBe(30);
  });
});

describe('computeAssumptionValidation', () => {
  it('computes acceptance, resolution, and ROI from call attempts', async () => {
    const prisma = makePrisma([
      { outcome: 'RESOLVED', claim: { billedAmount: 600 } },
      { outcome: 'RESOLVED', claim: { billedAmount: 400 } },
      { outcome: 'RESOLVED', claim: { billedAmount: 250 } },
      { outcome: 'DENIED', claim: { billedAmount: 900 } },
      { outcome: 'BLOCK_DETECTED', claim: { billedAmount: 100 } },
    ]);

    const report = await computeAssumptionValidation(prisma, 'practice-1', 30, NOW);

    expect(report.carrierAcceptance.totalCompletedCalls).toBe(5);
    expect(report.carrierAcceptance.acceptedCalls).toBe(4);
    expect(report.carrierAcceptance.ratePct).toBe(80);

    expect(report.resolution.resolvedCalls).toBe(3);
    expect(report.resolution.ratePct).toBe(60);
    expect(report.resolution.targetPct).toBe(60);
    expect(report.resolution.meetsTarget).toBe(true);

    expect(report.roi.revenueRecovered).toBe(1250);
    expect(report.roi.billingTier).toBe('core');
    expect(report.roi.subscriptionCost).toBe(799);
    expect(report.roi.ratio).toBe(1.56);
    expect(report.roi.positive).toBe(true);
  });

  it('flags a resolution rate below the 60% target', async () => {
    const prisma = makePrisma([
      { outcome: 'RESOLVED', claim: { billedAmount: 100 } },
      { outcome: 'DENIED', claim: { billedAmount: 100 } },
      { outcome: 'ESCALATED', claim: { billedAmount: 100 } },
    ]);

    const report = await computeAssumptionValidation(prisma, 'practice-1', 30, NOW);

    expect(report.resolution.ratePct).toBeCloseTo(33.3);
    expect(report.resolution.meetsTarget).toBe(false);
  });

  it('prorates subscription cost across the 90-day window', async () => {
    const prisma = makePrisma([{ outcome: 'RESOLVED', claim: { billedAmount: 5000 } }]);

    const report = await computeAssumptionValidation(prisma, 'practice-1', 90, NOW);

    expect(report.roi.subscriptionCost).toBe(2397);
    expect(report.roi.ratio).toBe(2.09);
  });

  it('returns null rates when there is no call data and null ROI on trial (no cost)', async () => {
    const report = await computeAssumptionValidation(makePrisma([], 'trial'), 'practice-1', 30, NOW);

    expect(report.carrierAcceptance.ratePct).toBeNull();
    expect(report.resolution.ratePct).toBeNull();
    expect(report.resolution.meetsTarget).toBeNull();
    expect(report.roi.ratio).toBeNull();
    expect(report.roi.positive).toBeNull();
  });
});
