// ─────────────────────────────────────────────────────────────────────────────
// Plan / monetization layer — pure-logic unit tests
//
// Source: collectrx-tiering-strategy.md §7 (P0 commercial layer).
//
// Scope: this file covers what can be tested without spinning up Postgres —
//   • tierFeatures: the static feature-flag map (the single source of truth
//     consumed by planService.getFeatures and any UI/backend gate).
//   • usageService.classifyForUsage: the pure outcome-code → event-type
//     classifier driving billing counters.
//
// DB-dependent paths (canMakeCall, recordOutcome, setTier) are exercised
// through integration tests rather than unit mocks. vitest cannot intercept
// the eager require chain `db.cjs → logger.js` because the workspace
// package.json sets `"type": "module"` (logger.js is parsed as ESM and
// crashes on its top-level `require("path")`). Standing up an integration
// harness for those code paths is tracked separately; the logic itself is
// small and exercised in dev via /api/queue/run.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TIER_FEATURES, TIER_NAMES, getFeatures } = require('../src/services/plans/tierFeatures.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyForUsage } = require('../src/services/plans/usageService.cjs');

// ─── tierFeatures ────────────────────────────────────────────────────────────
describe('tierFeatures (strategy §6 feature matrix)', () => {
  it('defines exactly basic, professional, enterprise', () => {
    expect(TIER_NAMES).toEqual(['basic', 'professional', 'enterprise']);
  });

  it('Basic — triage autonomy + read-only Abeldent (strategy §2 Fence 1 & 2)', () => {
    expect(TIER_FEATURES.basic.autonomy).toBe('triage');
    expect(TIER_FEATURES.basic.abeldentSync).toBe('read_only');
    expect(TIER_FEATURES.basic.whiteLabel).toBe(false);
    expect(TIER_FEATURES.basic.restApi).toBe(false);
    expect(TIER_FEATURES.basic.multiTenancy).toBe(false);
    expect(TIER_FEATURES.basic.appealDrafting).toBe(false);
    expect(TIER_FEATURES.basic.denialPrediction).toBe(false);
  });

  it('Professional — negotiation autonomy + deep Abeldent sync', () => {
    expect(TIER_FEATURES.professional.autonomy).toBe('negotiation');
    expect(TIER_FEATURES.professional.abeldentSync).toBe('deep');
    expect(TIER_FEATURES.professional.appealDrafting).toBe(true);
    expect(TIER_FEATURES.professional.denialPrediction).toBe(true);
    expect(TIER_FEATURES.professional.fullTranscripts).toBe(true);
    // multi-tenancy + white-label + REST are reserved for Enterprise
    expect(TIER_FEATURES.professional.multiTenancy).toBe(false);
    expect(TIER_FEATURES.professional.whiteLabel).toBe(false);
    expect(TIER_FEATURES.professional.restApi).toBe(false);
  });

  it('Enterprise — scripted autonomy + writeback + REST + white-label', () => {
    expect(TIER_FEATURES.enterprise.autonomy).toBe('scripted');
    expect(TIER_FEATURES.enterprise.abeldentSync).toBe('writeback');
    expect(TIER_FEATURES.enterprise.whiteLabel).toBe(true);
    expect(TIER_FEATURES.enterprise.restApi).toBe(true);
    expect(TIER_FEATURES.enterprise.multiTenancy).toBe(true);
    expect(TIER_FEATURES.enterprise.customScripts).toBe(true);
    expect(TIER_FEATURES.enterprise.crossPracticeBenchmarking).toBe(true);
  });

  it('value metric is AR resolved claims for Basic and Pro; Enterprise uses recovered dollars', () => {
    expect(TIER_FEATURES.basic.valueMetric).toBe('resolved_claim');
    expect(TIER_FEATURES.professional.valueMetric).toBe('resolved_claim');
    expect(TIER_FEATURES.enterprise.valueMetric).toBe('recovered_dollars');
  });

  it('autonomy fence escalates monotonically (§2 Fence 1)', () => {
    const autonomyOrder = ['triage', 'negotiation', 'scripted'];
    expect([
      TIER_FEATURES.basic.autonomy,
      TIER_FEATURES.professional.autonomy,
      TIER_FEATURES.enterprise.autonomy,
    ]).toEqual(autonomyOrder);
  });

  it('Abeldent sync depth escalates monotonically (§2 Fence 2)', () => {
    const syncOrder = ['read_only', 'deep', 'writeback'];
    expect([
      TIER_FEATURES.basic.abeldentSync,
      TIER_FEATURES.professional.abeldentSync,
      TIER_FEATURES.enterprise.abeldentSync,
    ]).toEqual(syncOrder);
  });

  it('all tiers gate on resolved claims — no status-call pools', () => {
    expect(TIER_FEATURES.basic.includedStatusCallsPerCycle).toBeNull();
    expect(TIER_FEATURES.professional.includedStatusCallsPerCycle).toBeNull();
    expect(TIER_FEATURES.enterprise.includedStatusCallsPerCycle).toBeNull();
    expect(TIER_FEATURES.basic.includedResolvedClaimsPerCycle).toBeGreaterThan(0);
    expect(TIER_FEATURES.professional.includedResolvedClaimsPerCycle).toBeGreaterThan(50);
    expect(TIER_FEATURES.enterprise.includedResolvedClaimsPerCycle).toBeNull();
  });

  it('Professional includes overage rate for additional claims', () => {
    expect(TIER_FEATURES.professional.overageCentsPerClaim).toBeGreaterThan(0);
    expect(TIER_FEATURES.professional.allowOverage).toBe(true);
  });

  it('getFeatures throws on unknown tier', () => {
    expect(() => getFeatures('starter')).toThrow(/Unknown plan tier/);
  });

  it('TIER_FEATURES is frozen — strategy is a single source of truth, not a hot-patchable map', () => {
    expect(Object.isFrozen(TIER_FEATURES)).toBe(true);
  });

  it('allowOverage = false on Basic (pool exhaustion blocks), true on Pro/Enterprise (Stripe meters)', () => {
    expect(TIER_FEATURES.basic.allowOverage).toBe(false);
    expect(TIER_FEATURES.professional.allowOverage).toBe(true);
    expect(TIER_FEATURES.enterprise.allowOverage).toBe(true);
  });
});

// ─── usageService.classifyForUsage ───────────────────────────────────────────
// This is the rule that decides which call outcomes are billable. It's the
// foundation of the Plan's counters, so it's pinned in tests by name.
describe('usageService.classifyForUsage (AR resolved-claim rule)', () => {
  it('paid → resolved_claim (recovered $ tracked separately)', () => {
    expect(classifyForUsage('paid')).toBe('resolved_claim');
  });

  it.each([
    ['not_covered', 'denied — AR closed, bill patient'],
    ['coverage_maxed', 'annual max — AR closed, bill patient'],
    ['resubmit_required', 'resubmit path determined'],
  ])('%s → resolved_claim (%s)', (code) => {
    expect(classifyForUsage(code)).toBe('resolved_claim');
  });

  it('processing → null (claim still open — not billable)', () => {
    expect(classifyForUsage('processing')).toBeNull();
  });

  it.each([
    ['xray_required',    'escalates to staff — surfaces in §3.2 Basic→Pro tally, NOT in usage'],
    ['docs_required',    'escalates to staff'],
    ['appeal_required',  'escalates to staff'],
    ['no_answer',        'no connection — not value-bearing'],
    ['call_failed',      'Vapi/Twilio failure — not value-bearing'],
    ['carrier_block',    'safety event — fires CARRIER_BLOCK, never billable'],
    ['unknown',          'unclassified — paused for manual review, not billable'],
  ])('%s → null (%s)', (code) => {
    expect(classifyForUsage(code)).toBeNull();
  });

  it('returns null for nonsense codes (safe default for forward-compat)', () => {
    expect(classifyForUsage('totally_made_up')).toBeNull();
    expect(classifyForUsage('')).toBeNull();
    expect(classifyForUsage(undefined)).toBeNull();
  });
});
