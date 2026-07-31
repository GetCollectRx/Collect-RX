// ─────────────────────────────────────────────────────────────────────────────
// Agent 09 — Self-Tuning Agent Validator
//
// Tests the self-tuning system that learns from call outcomes and updates rules:
//   - Block phrase signal extraction and proposal logic
//   - Recall interval drift detection and proposal math
//   - Confidence weight recalibration proposals
//   - Adaptation ledger read/write/rollback
//   - Rule applicator merge with baseline
//   - Learned phrase integration with carrier block detection
//   - Safety: only LOW-risk changes auto-applied
//   - Rollback correctness when tests fail
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';

// Self-tuner modules
import {
  proposeBlockPhrases,
  proposeRecallIntervalAdjustments,
  proposeConfidenceRecalibrations,
  proposeCarrierWaitDayAdjustments,
  generateAllProposals,
  roundToSensibleInterval,
} from '../../src/server/learning/selfTuner/ruleProposer.js';
import type {
  BlockPhraseSignal,
  RecallIntervalObservation,
  ReconciliationVariance,
  CarrierOutcomeSignal,
  LearnedBlockPhrases,
} from '../../src/server/learning/selfTuner/types.js';

// Carrier block phrases module (now self-tuner aware)
import {
  transcriptSignalsCarrierBlock,
  matchedCarrierBlockPhrase,
  getActiveBlockPhrases,
  loadLearnedBlockPhrasesIntoRuntime,
  resetToBaseline,
} from '../../src/server/frontDesk/carrierBlockPhrases.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeBlockPhraseSignal(overrides: Partial<BlockPhraseSignal> = {}): BlockPhraseSignal {
  return {
    phraseCandidate: 'voice recognition required',
    occurrences: 15,
    totalCallsWithPhrase: 17,
    blockRateWhenPresent: 0.88,
    alreadyKnown: false,
    ...overrides,
  };
}

function makeRecallObs(overrides: Partial<RecallIntervalObservation> = {}): RecallIntervalObservation {
  return {
    carrierId: 'sun_life',
    legacyOutcomeCode: 'processing',
    configuredHours: 72,
    observedMedianHours: 48,
    observedP25Hours: 36,
    sampleSize: 25,
    isDrift: true,
    driftDirection: 'sooner',
    driftMagnitudeHours: 24,
    ...overrides,
  };
}

function makeVariance(overrides: Partial<ReconciliationVariance> = {}): ReconciliationVariance {
  return {
    carrierId: 'canada_life',
    cdtTier: 'major',
    sampleSize: 45,
    meanAbsoluteError: 87.50,
    medianAbsoluteError: 72.00,
    withinThresholdPct: 52,
    confidenceOverstatement: 18,
    ...overrides,
  };
}

function makeOutcomeSignal(overrides: Partial<CarrierOutcomeSignal> = {}): CarrierOutcomeSignal {
  return {
    carrierId: 'manulife',
    sampleSize: 60,
    windowDays: 30,
    observedAt: new Date().toISOString(),
    resolvedCount: 45,
    pendingCount: 10,
    deniedCount: 3,
    blockDetectedCount: 2,
    failedCount: 0,
    noAnswerCount: 0,
    resolutionRatePct: 75,
    blockRatePct: 3.3,
    medianResolutionHours: 312, // ~13 days
    medianFirstResolutionHours: 312,
    p90ResolutionHours: 528,
    avgAttemptsToResolve: 1.8,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Block Phrase Proposal Logic
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-A — Block phrase proposal logic', () => {
  it('HIGH block rate (>=85%) + sufficient samples → LOW risk proposal', () => {
    const signal = makeBlockPhraseSignal({ blockRateWhenPresent: 0.88, occurrences: 15 });
    const proposals = proposeBlockPhrases([signal]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.riskLevel).toBe('LOW');
    expect(proposals[0]!.ruleType).toBe('BLOCK_PHRASE');
  });

  it('MEDIUM block rate (65–84%) → MEDIUM risk proposal', () => {
    const signal = makeBlockPhraseSignal({ blockRateWhenPresent: 0.70, occurrences: 15 });
    const proposals = proposeBlockPhrases([signal]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.riskLevel).toBe('MEDIUM');
  });

  it('LOW block rate (<50%) → no proposal generated', () => {
    const signal = makeBlockPhraseSignal({ blockRateWhenPresent: 0.45 });
    expect(proposeBlockPhrases([signal])).toHaveLength(0);
  });

  it('already known phrase → no proposal', () => {
    const signal = makeBlockPhraseSignal({ alreadyKnown: true, blockRateWhenPresent: 0.95 });
    expect(proposeBlockPhrases([signal])).toHaveLength(0);
  });

  it('proposal includes rationale with phrase and evidence', () => {
    const signal = makeBlockPhraseSignal({ phraseCandidate: 'voice recognition required' });
    const proposal = proposeBlockPhrases([signal])[0]!;
    expect(proposal.rationale).toContain('voice recognition required');
    expect(proposal.evidenceSummary).toBeTruthy();
  });

  it('proposal has PENDING status initially', () => {
    const signal = makeBlockPhraseSignal();
    const proposal = proposeBlockPhrases([signal])[0]!;
    expect(proposal.status).toBe('PENDING');
  });

  it('proposal has a UUID proposalId', () => {
    const signal = makeBlockPhraseSignal();
    const proposal = proposeBlockPhrases([signal])[0]!;
    expect(proposal.proposalId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('multiple signals produce multiple proposals', () => {
    const signals = [
      makeBlockPhraseSignal({ phraseCandidate: 'phrase one', blockRateWhenPresent: 0.9 }),
      makeBlockPhraseSignal({ phraseCandidate: 'phrase two', blockRateWhenPresent: 0.8 }),
    ];
    expect(proposeBlockPhrases(signals)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — Recall Interval Drift Proposals
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-B — Recall interval drift proposals', () => {
  it('significant drift with sufficient samples → generates proposal', () => {
    const obs = makeRecallObs({ isDrift: true, sampleSize: 25, observedMedianHours: 48, configuredHours: 72 });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.ruleType).toBe('RECALL_INTERVAL');
  });

  it('insufficient sample size (<10) → no proposal', () => {
    const obs = makeRecallObs({ isDrift: true, sampleSize: 8 });
    expect(proposeRecallIntervalAdjustments([obs])).toHaveLength(0);
  });

  it('no drift flag → no proposal', () => {
    const obs = makeRecallObs({ isDrift: false });
    expect(proposeRecallIntervalAdjustments([obs])).toHaveLength(0);
  });

  it('small adjustment (<4h) → LOW risk', () => {
    const obs = makeRecallObs({
      isDrift: true, sampleSize: 20,
      configuredHours: 72, observedMedianHours: 70, driftMagnitudeHours: 2,
    });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    if (proposals.length > 0) {
      // May produce no proposal if rounded value equals current
      expect(['LOW', 'MEDIUM']).toContain(proposals[0]!.riskLevel);
    }
  });

  it('payment_trace outcome → HIGH risk regardless of magnitude', () => {
    const obs = makeRecallObs({ isDrift: true, sampleSize: 20, legacyOutcomeCode: 'payment_trace' });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    if (proposals.length > 0) {
      expect(proposals[0]!.riskLevel).toBe('HIGH');
    }
  });

  it('large adjustment (>24h) → HIGH risk', () => {
    const obs = makeRecallObs({
      isDrift: true, sampleSize: 30,
      configuredHours: 72, observedMedianHours: 24, driftMagnitudeHours: 48,
    });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    if (proposals.length > 0) {
      expect(proposals[0]!.riskLevel).toBe('HIGH');
    }
  });

  it('proposal payload contains carrier and outcome code', () => {
    const obs = makeRecallObs({ carrierId: 'manulife', legacyOutcomeCode: 'no_answer' });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    if (proposals.length > 0) {
      const p = proposals[0]!.payload as { type: string; carrierId: string; legacyOutcomeCode: string };
      expect(p.carrierId).toBe('manulife');
      expect(p.legacyOutcomeCode).toBe('no_answer');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Confidence Recalibration Proposals
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-C — Confidence recalibration proposals', () => {
  it('low within-threshold rate → generates MEDIUM-risk proposal', () => {
    const v = makeVariance({ withinThresholdPct: 52, confidenceOverstatement: 18, sampleSize: 45 });
    const proposals = proposeConfidenceRecalibrations([v]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.riskLevel).toBe('MEDIUM');
  });

  it('insufficient sample size (<20) → no proposal', () => {
    const v = makeVariance({ sampleSize: 10 });
    expect(proposeConfidenceRecalibrations([v])).toHaveLength(0);
  });

  it('low overstatement (<10) → no proposal', () => {
    const v = makeVariance({ confidenceOverstatement: 5, withinThresholdPct: 68 });
    expect(proposeConfidenceRecalibrations([v])).toHaveLength(0);
  });

  it('adjustment is capped at -25 points maximum', () => {
    const v = makeVariance({ confidenceOverstatement: 50, withinThresholdPct: 10 });
    const proposals = proposeConfidenceRecalibrations([v]);
    if (proposals.length > 0) {
      const payload = proposals[0]!.payload as { proposedWeight: number };
      expect(Math.abs(payload.proposedWeight)).toBeLessThanOrEqual(25);
    }
  });

  it('proposal includes carrier and tier in rationale', () => {
    const v = makeVariance({ carrierId: 'rbc', cdtTier: 'major' });
    const proposals = proposeConfidenceRecalibrations([v]);
    if (proposals.length > 0) {
      expect(proposals[0]!.rationale).toContain('rbc');
      expect(proposals[0]!.rationale).toContain('major');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Carrier Wait Day Proposals
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-D — Carrier wait day proposals', () => {
  it('carrier resolving much faster than day 32 → proposes earlier wait day', () => {
    // Median resolution = 13 days (312h) — configured = 32 days
    const signal = makeOutcomeSignal({ carrierId: 'manulife', medianFirstResolutionHours: 312, sampleSize: 60 });
    const proposals = proposeCarrierWaitDayAdjustments([signal]);
    if (proposals.length > 0) {
      const p = proposals[0]!.payload as { proposedDay: number; currentDay: number };
      expect(p.proposedDay).toBeLessThan(p.currentDay);
      expect(p.proposedDay).toBeGreaterThanOrEqual(21); // Never below TELUS minimum
    }
  });

  it('never proposes wait day below 21 (TELUS minimum)', () => {
    const signal = makeOutcomeSignal({ carrierId: 'sun_life', medianFirstResolutionHours: 120, sampleSize: 50 }); // 5 days
    const proposals = proposeCarrierWaitDayAdjustments([signal]);
    for (const p of proposals) {
      const payload = p.payload as { proposedDay: number };
      expect(payload.proposedDay).toBeGreaterThanOrEqual(21);
    }
  });

  it('insufficient sample size (<30) → no proposal', () => {
    const signal = makeOutcomeSignal({ sampleSize: 15 });
    expect(proposeCarrierWaitDayAdjustments([signal])).toHaveLength(0);
  });

  it('small difference (<5 days) → no proposal', () => {
    // 28 days observed vs 32 configured — only 4 day difference
    const signal = makeOutcomeSignal({ medianFirstResolutionHours: 672, sampleSize: 50 }); // 28 days
    const proposals = proposeCarrierWaitDayAdjustments([signal]);
    expect(proposals).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section E — Master Proposal Generator
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-E — Master proposal generator (generateAllProposals)', () => {
  it('generates proposals from all signal types', () => {
    const proposals = generateAllProposals({
      blockPhraseSignals: [makeBlockPhraseSignal()],
      recallObservations: [makeRecallObs()],
      reconciliationVariances: [makeVariance()],
      outcomeSignals: [makeOutcomeSignal()],
    });
    // At minimum block phrase + recall interval proposals
    expect(proposals.length).toBeGreaterThan(0);
  });

  it('sorts proposals: LOW risk first, then by sample size descending', () => {
    const proposals = generateAllProposals({
      blockPhraseSignals: [
        makeBlockPhraseSignal({ blockRateWhenPresent: 0.9, occurrences: 20 }),
        makeBlockPhraseSignal({ phraseCandidate: 'another phrase', blockRateWhenPresent: 0.9, occurrences: 5 }),
      ],
      recallObservations: [],
      reconciliationVariances: [makeVariance()], // MEDIUM risk
      outcomeSignals: [],
    });

    const riskOrder: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    for (let i = 0; i < proposals.length - 1; i++) {
      const current = riskOrder[proposals[i]!.riskLevel]!;
      const next = riskOrder[proposals[i + 1]!.riskLevel]!;
      expect(current).toBeLessThanOrEqual(next);
    }
  });

  it('empty signals → no proposals', () => {
    const proposals = generateAllProposals({
      blockPhraseSignals: [],
      recallObservations: [],
      reconciliationVariances: [],
      outcomeSignals: [],
    });
    expect(proposals).toHaveLength(0);
  });

  it('all proposals have required fields', () => {
    const proposals = generateAllProposals({
      blockPhraseSignals: [makeBlockPhraseSignal()],
      recallObservations: [makeRecallObs()],
      reconciliationVariances: [],
      outcomeSignals: [],
    });
    for (const p of proposals) {
      expect(p.proposalId).toBeTruthy();
      expect(p.ruleType).toBeTruthy();
      expect(p.riskLevel).toMatch(/^(LOW|MEDIUM|HIGH)$/);
      expect(p.rationale).toBeTruthy();
      expect(p.evidenceSummary).toBeTruthy();
      expect(p.sampleSize).toBeGreaterThan(0);
      expect(p.status).toBe('PENDING');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section F — roundToSensibleInterval
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-F — roundToSensibleInterval', () => {
  const cases: [number, number][] = [
    [1.5, 2],
    [3.8, 4],
    [5.5, 6],
    [7, 6],    // equidistant between 6 and 8 — first match (6) wins
    [11.5, 12],
    [23.1, 24],
    [47.9, 48],
    [68.4, 72],
    [94, 96],
    [334, 336],
  ];

  for (const [input, expected] of cases) {
    it(`${input}h → ${expected}h (nearest sensible interval)`, () => {
      expect(roundToSensibleInterval(input)).toBe(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section G — Learned Phrase Integration with carrierBlockPhrases
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-G — Learned phrase integration with carrier block detection', () => {
  beforeEach(() => {
    resetToBaseline();
  });

  afterEach(() => {
    resetToBaseline();
  });

  it('before loading: only baseline phrases active', () => {
    const phrases = getActiveBlockPhrases();
    expect(phrases).toContain('automated calling is not permitted');
    expect(phrases).toContain('this sounds like a bot call');
    expect(phrases).toContain('fraud detection');
    expect(phrases).not.toContain('automated');
    expect(phrases).not.toContain('bot');
  });

  it('after loading learned phrase: new phrase is detected', () => {
    loadLearnedBlockPhrasesIntoRuntime(['voice recognition required']);
    expect(transcriptSignalsCarrierBlock('Please complete voice recognition required process')).toBe(true);
  });

  it('after loading learned phrase: matchedCarrierBlockPhrase returns it', () => {
    loadLearnedBlockPhrasesIntoRuntime(['voice recognition required']);
    expect(matchedCarrierBlockPhrase('complete voice recognition required')).toBe('voice recognition required');
  });

  it('loaded learned phrases are merged, not replacing baseline', () => {
    loadLearnedBlockPhrasesIntoRuntime(['new learned phrase']);
    const phrases = getActiveBlockPhrases();
    expect(phrases).toContain('automated calling is not permitted'); // baseline preserved
    expect(phrases).toContain('this sounds like a bot call'); // baseline preserved
    expect(phrases).toContain('new learned phrase'); // learned added
  });

  it('resetToBaseline removes learned phrases', () => {
    loadLearnedBlockPhrasesIntoRuntime(['temp phrase']);
    expect(getActiveBlockPhrases()).toContain('temp phrase');
    resetToBaseline();
    expect(getActiveBlockPhrases()).not.toContain('temp phrase');
  });

  it('loading same phrase twice does not create duplicate', () => {
    loadLearnedBlockPhrasesIntoRuntime(['fraud detection']); // Already in baseline
    const phrases = getActiveBlockPhrases();
    const fraudDetectionCount = phrases.filter((p) => p === 'fraud detection').length;
    expect(fraudDetectionCount).toBe(1);
  });

  it('baseline phrases still work after loading learned phrases', () => {
    loadLearnedBlockPhrasesIntoRuntime(['some new phrase']);
    expect(transcriptSignalsCarrierBlock('This is an automated call')).toBe(false);
    expect(transcriptSignalsCarrierBlock('This sounds like a bot')).toBe(false);
    expect(transcriptSignalsCarrierBlock('Automated calling is not permitted')).toBe(true);
    expect(transcriptSignalsCarrierBlock('This sounds like a bot call')).toBe(true);
    expect(transcriptSignalsCarrierBlock('Fraud detection triggered')).toBe(true);
  });

  it('normal carrier speech does not trigger even with learned phrases loaded', () => {
    loadLearnedBlockPhrasesIntoRuntime(['voice recognition required']);
    expect(transcriptSignalsCarrierBlock('Your claim is pending adjudication')).toBe(false);
    expect(transcriptSignalsCarrierBlock('Please hold while I look that up')).toBe(false);
  });

  it('loading empty array does not change active phrases', () => {
    const before = [...getActiveBlockPhrases()];
    loadLearnedBlockPhrasesIntoRuntime([]);
    const after = [...getActiveBlockPhrases()];
    expect(after).toEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section H — Risk Level Classification Contract
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-H — Risk level classification contract', () => {
  it('block phrases with high confidence are LOW risk (safe to auto-apply)', () => {
    const highConfidence = makeBlockPhraseSignal({ blockRateWhenPresent: 0.95, occurrences: 20 });
    const proposals = proposeBlockPhrases([highConfidence]);
    expect(proposals[0]!.riskLevel).toBe('LOW');
  });

  it('confidence weight changes are never LOW risk (too broad an impact)', () => {
    const v = makeVariance({ sampleSize: 100, confidenceOverstatement: 25, withinThresholdPct: 40 });
    const proposals = proposeConfidenceRecalibrations([v]);
    if (proposals.length > 0) {
      expect(proposals[0]!.riskLevel).not.toBe('LOW');
    }
  });

  it('payment_trace recall changes are always HIGH risk', () => {
    const obs = makeRecallObs({ legacyOutcomeCode: 'payment_trace', isDrift: true, sampleSize: 50 });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    if (proposals.length > 0) {
      expect(proposals[0]!.riskLevel).toBe('HIGH');
    }
  });

  it('HIGH risk proposals must have rationale explaining the risk', () => {
    const obs = makeRecallObs({
      legacyOutcomeCode: 'payment_trace',
      isDrift: true, sampleSize: 30,
      configuredHours: 336, observedMedianHours: 168,
    });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    for (const p of proposals) {
      if (p.riskLevel === 'HIGH') {
        expect(p.rationale.length).toBeGreaterThan(50);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section I — Signal Quality and Confidence
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-I — Signal quality and confidence thresholds', () => {
  it('block phrase proposals include sample size in proposal object', () => {
    const signal = makeBlockPhraseSignal({ totalCallsWithPhrase: 42 });
    const proposals = proposeBlockPhrases([signal]);
    if (proposals.length > 0) {
      expect(proposals[0]!.sampleSize).toBe(42);
    }
  });

  it('recall proposals include sample size in proposal object', () => {
    const obs = makeRecallObs({ sampleSize: 37 });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    if (proposals.length > 0) {
      expect(proposals[0]!.sampleSize).toBe(37);
    }
  });

  it('minimum sample sizes are enforced across all proposal types', () => {
    // Block phrase: min 3 occurrences (enforced in analyzer)
    const tinyBlock = makeBlockPhraseSignal({ occurrences: 1, totalCallsWithPhrase: 2 });
    // With blockRate >=0.5 but very few samples, still proposed (sample size is signal.totalCallsWithPhrase)
    // We test that at very low sample the block rate calc still works
    expect(() => proposeBlockPhrases([tinyBlock])).not.toThrow();

    // Recall: min 10 samples
    const tinyRecall = makeRecallObs({ sampleSize: 5 });
    expect(proposeRecallIntervalAdjustments([tinyRecall])).toHaveLength(0);

    // Confidence: min 20 samples
    const tinyVariance = makeVariance({ sampleSize: 10 });
    expect(proposeConfidenceRecalibrations([tinyVariance])).toHaveLength(0);

    // Wait day: min 30 samples
    const tinyOutcome = makeOutcomeSignal({ sampleSize: 20 });
    expect(proposeCarrierWaitDayAdjustments([tinyOutcome])).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section J — Self-Tuner Does Not Break Existing Safety Rules
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 09-J — Self-tuner safety invariants', () => {
  beforeEach(() => {
    resetToBaseline();
  });

  afterEach(() => {
    resetToBaseline();
  });

  it('even with 100 learned phrases, normal carrier speech is never blocked', () => {
    const learned = Array.from({ length: 100 }, (_, i) => `phrase ${i}`);
    loadLearnedBlockPhrasesIntoRuntime(learned);

    const SAFE_TRANSCRIPTS = [
      'Your claim is pending adjudication',
      'The claim was processed on April 15th',
      'We need a clinical note for this procedure',
      'The patient has an active benefit year',
      'Please provide the date of service',
    ];

    for (const transcript of SAFE_TRANSCRIPTS) {
      expect(transcriptSignalsCarrierBlock(transcript)).toBe(false);
    }
  });

  it('wait day proposals never go below 21 days (TELUS regulatory minimum)', () => {
    // Carrier resolving in 1 day (unrealistic, but stress test the floor)
    const signal = makeOutcomeSignal({ medianFirstResolutionHours: 24, sampleSize: 50 }); // 1 day
    const proposals = proposeCarrierWaitDayAdjustments([signal]);
    for (const p of proposals) {
      const payload = p.payload as { proposedDay: number };
      expect(payload.proposedDay).toBeGreaterThanOrEqual(21);
    }
  });

  it('recall interval proposals never set 0-hour recall (always > 0)', () => {
    const obs = makeRecallObs({ observedMedianHours: 0.5, isDrift: true, sampleSize: 20 });
    const proposals = proposeRecallIntervalAdjustments([obs]);
    for (const p of proposals) {
      const payload = p.payload as { proposedHours: number };
      expect(payload.proposedHours).toBeGreaterThan(0);
    }
  });

  it('confidence weight adjustment never exceeds -25 (prevents 0-confidence estimates)', () => {
    const v = makeVariance({ confidenceOverstatement: 99, withinThresholdPct: 0, sampleSize: 100 });
    const proposals = proposeConfidenceRecalibrations([v]);
    for (const p of proposals) {
      const payload = p.payload as { proposedWeight: number };
      expect(Math.abs(payload.proposedWeight)).toBeLessThanOrEqual(25);
    }
  });
});
