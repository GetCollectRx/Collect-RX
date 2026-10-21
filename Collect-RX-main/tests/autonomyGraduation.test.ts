import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GRADUATION_CRITERIA,
  approvedCarriers,
  clearGraduationCache,
  evaluateGraduation,
  getCarrierGraduation,
  isCarrierGraduated,
  type CarrierGraduationStats,
} from '../src/server/learning/autonomyGraduation';
import { FEATURES, autonomousPlanTiers, effectiveHumanAssisted, tierAllows } from '../src/billing/entitlements';

const READY: CarrierGraduationStats = {
  staffHandledCalls: 60,
  referenceCaptured: 58,
  unresolved: 5,
  automationSuspicion: 0,
  profileCategoriesCovered: 4,
};

function fakePrisma(stats: CarrierGraduationStats) {
  const counts = [stats.staffHandledCalls, stats.referenceCaptured, stats.unresolved, stats.automationSuspicion];
  let i = 0;
  return {
    humanAssistedCallLog: { count: vi.fn(async () => counts[i++ % 4]) },
    humanAssistedCarrierProfile: {
      groupBy: vi.fn(async () => Array.from({ length: stats.profileCategoriesCovered }, (_, k) => ({ category: k }))),
    },
  } as never;
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearGraduationCache();
});

describe('evaluateGraduation', () => {
  it('graduates only when every threshold passes and the carrier is approved', () => {
    const result = evaluateGraduation('sun_life', READY, true);
    expect(result.eligible).toBe(true);
    expect(result.graduated).toBe(true);
    expect(result.failedChecks).toEqual([]);
  });

  it('keeps an eligible but unapproved carrier off autonomous calling', () => {
    const result = evaluateGraduation('sun_life', READY, false);
    expect(result.eligible).toBe(true);
    expect(result.graduated).toBe(false);
  });

  it('names every failed check', () => {
    const result = evaluateGraduation(
      'manulife',
      { staffHandledCalls: 20, referenceCaptured: 10, unresolved: 8, automationSuspicion: 2, profileCategoriesCovered: 1 },
      true,
    );
    expect(result.graduated).toBe(false);
    expect(result.failedChecks).toEqual([
      'sample_size',
      'reference_capture',
      'unresolved_rate',
      'automation_suspicion',
      'playbook_coverage',
    ]);
  });

  it('treats a carrier with no calls as not eligible rather than dividing by zero', () => {
    const result = evaluateGraduation(
      'rbc',
      { staffHandledCalls: 0, referenceCaptured: 0, unresolved: 0, automationSuspicion: 0, profileCategoriesCovered: 0 },
      true,
    );
    expect(result.eligible).toBe(false);
    expect(result.rates.referenceCaptureRate).toBe(0);
  });

  it('honours custom criteria', () => {
    const lenient = { ...DEFAULT_GRADUATION_CRITERIA, minStaffHandledCalls: 10 };
    const result = evaluateGraduation('green_shield', { ...READY, staffHandledCalls: 12, referenceCaptured: 12, unresolved: 0 }, true, lenient);
    expect(result.graduated).toBe(true);
  });
});

describe('approvedCarriers', () => {
  it('parses the env list case-insensitively and ignores blanks', () => {
    expect(approvedCarriers({ AUTONOMOUS_APPROVED_CARRIERS: ' Sun_Life, ,manulife ' } as NodeJS.ProcessEnv)).toEqual(
      new Set(['sun_life', 'manulife']),
    );
    expect(approvedCarriers({} as NodeJS.ProcessEnv).size).toBe(0);
  });
});

describe('getCarrierGraduation and isCarrierGraduated', () => {
  it('builds the verdict from aggregate counts', async () => {
    const result = await getCarrierGraduation(fakePrisma(READY), 'sun_life', {
      env: { AUTONOMOUS_APPROVED_CARRIERS: 'sun_life' } as NodeJS.ProcessEnv,
    });
    expect(result.graduated).toBe(true);
    expect(result.stats).toEqual(READY);
  });

  it('skips the database entirely for an unapproved carrier', async () => {
    const prisma = fakePrisma(READY);
    expect(await isCarrierGraduated(prisma, 'sun_life')).toBe(false);
    expect((prisma as unknown as { humanAssistedCallLog: { count: ReturnType<typeof vi.fn> } }).humanAssistedCallLog.count).not.toHaveBeenCalled();
  });

  it('fails closed when the evidence query throws', async () => {
    vi.stubEnv('AUTONOMOUS_APPROVED_CARRIERS', 'sun_life');
    const prisma = {
      humanAssistedCallLog: { count: vi.fn(async () => { throw new Error('db down'); }) },
      humanAssistedCarrierProfile: { groupBy: vi.fn(async () => []) },
    } as never;
    expect(await isCarrierGraduated(prisma, 'sun_life')).toBe(false);
  });

  it('returns true for an approved carrier that meets the evidence bar', async () => {
    vi.stubEnv('AUTONOMOUS_APPROVED_CARRIERS', 'sun_life');
    expect(await isCarrierGraduated(fakePrisma(READY), 'sun_life')).toBe(true);
  });
});

describe('plan and carrier gates together', () => {
  it('keeps autonomous calling on no plan when AUTONOMOUS_PLAN_TIERS is unset', () => {
    expect(autonomousPlanTiers().size).toBe(0);
    expect(tierAllows('scale', FEATURES.AUTONOMOUS_CALLS)).toBe(false);
    expect(effectiveHumanAssisted('scale', false, { carrierGraduated: true })).toBe(true);
  });

  it('opens a named plan, but still holds an ungraduated carrier on Hold Sentinel', () => {
    vi.stubEnv('AUTONOMOUS_PLAN_TIERS', 'core,growth');
    expect(tierAllows('core', FEATURES.AUTONOMOUS_CALLS)).toBe(true);
    expect(tierAllows('sentinel', FEATURES.AUTONOMOUS_CALLS)).toBe(false);
    expect(effectiveHumanAssisted('core', false, { carrierGraduated: false })).toBe(true);
    expect(effectiveHumanAssisted('core', false, { carrierGraduated: true })).toBe(false);
  });

  it('respects a practice that keeps Hold Sentinel on even when everything else allows autonomy', () => {
    vi.stubEnv('AUTONOMOUS_PLAN_TIERS', 'core');
    expect(effectiveHumanAssisted('core', true, { carrierGraduated: true })).toBe(true);
  });
});
