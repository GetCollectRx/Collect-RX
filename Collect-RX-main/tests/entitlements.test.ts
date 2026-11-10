import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  effectiveHumanAssisted,
  featureLockedMessage,
  featuresForTier,
  settingsUpdateForPlan,
  tierAllows,
} from '../src/billing/entitlements';

describe('plan features', () => {
  it('gives Hold Sentinel and the trial calls plus CDCP tools only', () => {
    for (const tier of ['trial', 'sentinel'] as const) {
      expect(featuresForTier(tier)).toEqual([FEATURES.HOLD_SENTINEL_CALLS, FEATURES.CDCP_TOOLS]);
    }
  });

  it('adds eligibility, denial and underpayment recovery on Recovery and above', () => {
    for (const tier of ['core', 'growth', 'scale'] as const) {
      expect(tierAllows(tier, FEATURES.PRE_VISIT_ELIGIBILITY)).toBe(true);
      expect(tierAllows(tier, FEATURES.DENIAL_RECOVERY)).toBe(true);
      expect(tierAllows(tier, FEATURES.UNDERPAYMENT_RECOVERY)).toBe(true);
    }
  });

  it('puts autonomous calling on Scale only', () => {
    for (const tier of ['trial', 'sentinel', 'core', 'growth'] as const) {
      expect(tierAllows(tier, FEATURES.AUTONOMOUS_CALLS)).toBe(false);
    }
    expect(tierAllows('scale', FEATURES.AUTONOMOUS_CALLS)).toBe(true);
  });

  it('allows nothing without a plan', () => {
    expect(tierAllows(null, FEATURES.HOLD_SENTINEL_CALLS)).toBe(false);
    expect(featuresForTier(undefined)).toEqual([]);
  });
});

describe('effectiveHumanAssisted', () => {
  it('keeps Hold Sentinel on every plan without autonomous calling, whatever the setting', () => {
    for (const tier of ['trial', 'sentinel', 'core', 'growth'] as const) {
      expect(effectiveHumanAssisted(tier, false)).toBe(true);
    }
    expect(effectiveHumanAssisted(null, false)).toBe(true);
  });

  it('lets a Scale practice turn Hold Sentinel off, and keeps it on by default', () => {
    expect(effectiveHumanAssisted('scale', false)).toBe(false);
    expect(effectiveHumanAssisted('scale', true)).toBe(true);
    expect(effectiveHumanAssisted('scale', undefined)).toBe(true);
  });
});

describe('settingsUpdateForPlan', () => {
  it('rewrites an attempt to turn Hold Sentinel off when the plan has no autonomous calling', () => {
    expect(settingsUpdateForPlan({ humanAssistedMode: false, billingPhone: '4165550100' }, false)).toEqual({
      humanAssistedMode: true,
      billingPhone: '4165550100',
    });
  });

  it('passes other updates through unchanged', () => {
    const update = { billingPhone: '4165550100' };
    expect(settingsUpdateForPlan(update, false)).toBe(update);
    expect(settingsUpdateForPlan({ humanAssistedMode: false }, true)).toEqual({ humanAssistedMode: false });
  });
});

describe('featureLockedMessage', () => {
  it('names the plan to upgrade to', () => {
    expect(featureLockedMessage(FEATURES.DENIAL_RECOVERY)).toMatch(/Recovery plan/);
    expect(featureLockedMessage(FEATURES.AUTONOMOUS_CALLS)).toMatch(/Scale plan/);
  });
});
