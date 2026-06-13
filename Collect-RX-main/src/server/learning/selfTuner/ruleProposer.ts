// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Self-Tuning Rule Proposer
//
// Takes analyzed signals and produces RuleProposal objects. Each proposal
// includes a risk level, rationale, and the specific rule change.
//
// Risk levels:
//   LOW    — auto-apply after test suite passes (block phrases, small recalls)
//   MEDIUM — human review recommended (carrier wait days, large recall shifts)
//   HIGH   — requires explicit approval (coverage %, CDT tier changes)
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import type {
  CarrierOutcomeSignal,
  RecallIntervalObservation,
  BlockPhraseSignal,
  ReconciliationVariance,
  RuleProposal,
  RiskLevel,
  BlockPhrasePayload,
  RecallIntervalPayload,
  ConfidenceWeightPayload,
  CarrierWaitDayPayload,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Block Phrase Proposals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Propose adding new carrier block detection phrases.
 *
 * Risk assessment:
 *   LOW   — block rate >= 0.85 and occurrences >= 10
 *   MEDIUM — block rate >= 0.65 or occurrences >= 5
 *   HIGH   — block rate < 0.65 (too many false positives risk)
 */
export function proposeBlockPhrases(signals: BlockPhraseSignal[]): RuleProposal[] {
  const proposals: RuleProposal[] = [];

  for (const signal of signals) {
    if (signal.alreadyKnown) continue;
    if (signal.blockRateWhenPresent < 0.5) continue; // < 50% correlation → skip

    let riskLevel: RiskLevel;
    if (signal.blockRateWhenPresent >= 0.85 && signal.occurrences >= 10) {
      riskLevel = 'LOW';
    } else if (signal.blockRateWhenPresent >= 0.65 || signal.occurrences >= 5) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'HIGH';
    }

    const payload: BlockPhrasePayload = {
      type: 'BLOCK_PHRASE',
      newPhrase: signal.phraseCandidate,
      exampleTranscripts: [], // Filled at analysis time — anonymized
    };

    proposals.push({
      proposalId: uuidv4(),
      proposedAt: new Date().toISOString(),
      ruleType: 'BLOCK_PHRASE',
      riskLevel,
      rationale:
        `Phrase "${signal.phraseCandidate}" appeared in ${signal.occurrences} blocked calls ` +
        `with a block correlation of ${Math.round(signal.blockRateWhenPresent * 100)}%. ` +
        `Adding to CARRIER_BLOCK_PHRASES reduces automation detection risk.`,
      evidenceSummary:
        `${signal.occurrences} occurrences in blocked calls out of ${signal.totalCallsWithPhrase} total calls containing this phrase.`,
      sampleSize: signal.totalCallsWithPhrase,
      payload,
      status: 'PENDING',
    });
  }

  return proposals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recall Interval Proposals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Propose adjusting recall intervals based on observed timing drift.
 *
 * Risk assessment:
 *   LOW    — small adjustment (< 4 hours) in either direction
 *   MEDIUM — moderate adjustment (4–24 hours)
 *   HIGH   — large adjustment (> 24 hours) or affects payment_trace
 */
export function proposeRecallIntervalAdjustments(
  observations: RecallIntervalObservation[],
): RuleProposal[] {
  const proposals: RuleProposal[] = [];

  for (const obs of observations) {
    if (!obs.isDrift || obs.observedMedianHours === null) continue;
    if (obs.sampleSize < 10) continue; // Minimum sample for confidence

    // Round proposed hours to nearest sensible interval
    const proposedHours = roundToSensibleInterval(obs.observedMedianHours);
    if (proposedHours === obs.configuredHours) continue;

    const magnitude = Math.abs(proposedHours - obs.configuredHours);
    let riskLevel: RiskLevel;
    if (obs.legacyOutcomeCode === 'payment_trace' || magnitude > 24) {
      riskLevel = 'HIGH';
    } else if (magnitude > 4) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }

    const payload: RecallIntervalPayload = {
      type: 'RECALL_INTERVAL',
      legacyOutcomeCode: obs.legacyOutcomeCode,
      carrierId: obs.carrierId,
      currentHours: obs.configuredHours,
      proposedHours,
      changeDirection: obs.driftDirection as 'sooner' | 'later',
    };

    proposals.push({
      proposalId: uuidv4(),
      proposedAt: new Date().toISOString(),
      ruleType: 'RECALL_INTERVAL',
      riskLevel,
      rationale:
        `For "${obs.legacyOutcomeCode}" outcomes on ${obs.carrierId}, ` +
        `the observed median wait before next call is ${obs.observedMedianHours.toFixed(1)}h ` +
        `vs the configured ${obs.configuredHours}h. ` +
        `Adjusting to ${proposedHours}h reduces unnecessary wait time or avoids premature re-calls.`,
      evidenceSummary:
        `Drift of ${obs.driftMagnitudeHours.toFixed(1)}h detected over ${obs.sampleSize} samples (${obs.carrierId}, last ${obs.driftDirection}).`,
      sampleSize: obs.sampleSize,
      payload,
      status: 'PENDING',
    });
  }

  return proposals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Weight Proposals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Propose adjusting confidence scoring weights based on reconciliation variance.
 *
 * If actual vs. estimated variance is high for a specific carrier/tier, the
 * confidence score for estimates in that category should be reduced.
 *
 * Risk: always MEDIUM — changes affect all estimates for that carrier/tier.
 */
export function proposeConfidenceRecalibrations(
  variances: ReconciliationVariance[],
): RuleProposal[] {
  const proposals: RuleProposal[] = [];

  for (const v of variances) {
    if (v.sampleSize < 20) continue; // Need sufficient data
    if (v.confidenceOverstatement < 10) continue; // Meaningful overstatement threshold

    // Propose adjustment: reduce confidence by the overstatement amount, capped at -25
    const adjustment = Math.min(25, v.confidenceOverstatement);

    const payload: ConfidenceWeightPayload = {
      type: 'CONFIDENCE_WEIGHT',
      carrierId: v.carrierId,
      cdtTier: v.cdtTier,
      currentWeight: 0, // Baseline = no adjustment
      proposedWeight: -adjustment,
      reason: 'overestimating',
    };

    proposals.push({
      proposalId: uuidv4(),
      proposedAt: new Date().toISOString(),
      ruleType: 'CONFIDENCE_WEIGHT',
      riskLevel: 'MEDIUM',
      rationale:
        `For ${v.carrierId} / ${v.cdtTier} procedures, only ${v.withinThresholdPct}% of estimates ` +
        `are within the $50 threshold (target: 70%+). Mean absolute error is $${v.meanAbsoluteError.toFixed(2)}. ` +
        `Reducing confidence score by ${adjustment} points for this carrier/tier.`,
      evidenceSummary:
        `${v.sampleSize} reconciliations analyzed. Median error: $${v.medianAbsoluteError.toFixed(2)}. Within-threshold: ${v.withinThresholdPct}%.`,
      sampleSize: v.sampleSize,
      payload,
      status: 'PENDING',
    });
  }

  return proposals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Carrier Wait Day Proposals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Propose adjusting minWaitDayForClaims based on observed first-resolution timing.
 *
 * If a carrier consistently resolves claims at day 25 instead of 32,
 * we can call earlier (unless it's TELUS, which has its own rules).
 *
 * Risk: MEDIUM — affects when we start calling, operational impact.
 */
export function proposeCarrierWaitDayAdjustments(
  signals: CarrierOutcomeSignal[],
): RuleProposal[] {
  const proposals: RuleProposal[] = [];

  // Current configured wait days (from carrier-configs.json)
  const CONFIGURED_WAIT_DAYS: Record<string, number> = {
    sun_life: 32, canada_life: 32, manulife: 32,
    green_shield: 32, rbc: 32, telus_adjudicare: 21,
  };

  for (const signal of signals) {
    if (signal.sampleSize < 30) continue; // Need meaningful data
    if (!signal.medianFirstResolutionHours) continue;

    const configuredDays = CONFIGURED_WAIT_DAYS[signal.carrierId] ?? 32;
    const configuredHours = configuredDays * 24;
    const observedDays = signal.medianFirstResolutionHours / 24;
    const observedRoundedDays = Math.ceil(observedDays);

    // Only propose if observed is significantly different (±5 days) and we have enough data
    const dayDiff = Math.abs(observedRoundedDays - configuredDays);
    if (dayDiff < 5) continue;

    // Don't reduce below 21 days (TELUS minimum)
    const proposedDays = Math.max(21, observedRoundedDays);
    if (proposedDays === configuredDays) continue;

    const payload: CarrierWaitDayPayload = {
      type: 'CARRIER_WAIT_DAY',
      carrierId: signal.carrierId,
      currentDay: configuredDays,
      proposedDay: proposedDays,
      evidenceSource: 'outcome_timing',
    };

    proposals.push({
      proposalId: uuidv4(),
      proposedAt: new Date().toISOString(),
      ruleType: 'CARRIER_WAIT_DAY',
      riskLevel: 'MEDIUM',
      rationale:
        `${signal.carrierId} shows median first resolution at day ${observedRoundedDays} ` +
        `(configured: day ${configuredDays}). ` +
        `Adjusting claim minimum wait to day ${proposedDays} aligns with actual carrier processing speed.`,
      evidenceSummary:
        `${signal.sampleSize} calls analyzed over ${signal.windowDays} days. ` +
        `Median resolution: ${signal.medianFirstResolutionHours.toFixed(1)}h = day ${observedRoundedDays}.`,
      sampleSize: signal.sampleSize,
      payload,
      status: 'PENDING',
    });
  }

  return proposals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Master proposal generator
// ─────────────────────────────────────────────────────────────────────────────

export interface AllSignals {
  outcomeSignals: CarrierOutcomeSignal[];
  recallObservations: RecallIntervalObservation[];
  blockPhraseSignals: BlockPhraseSignal[];
  reconciliationVariances: ReconciliationVariance[];
}

/**
 * Generate all proposals from all signals, sorted by: risk (LOW first) then sample size.
 */
export function generateAllProposals(signals: AllSignals): RuleProposal[] {
  const proposals = [
    ...proposeBlockPhrases(signals.blockPhraseSignals),
    ...proposeRecallIntervalAdjustments(signals.recallObservations),
    ...proposeConfidenceRecalibrations(signals.reconciliationVariances),
    ...proposeCarrierWaitDayAdjustments(signals.outcomeSignals),
  ];

  // Sort: LOW risk first, then by sample size descending (most evidence first)
  const riskOrder: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return proposals.sort((a, b) => {
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return b.sampleSize - a.sampleSize;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rounds an observed hour count to the nearest sensible recall interval.
 * E.g., 68.4h → 72h, 3.8h → 4h, 23.1h → 24h.
 */
export function roundToSensibleInterval(hours: number): number {
  const SENSIBLE_INTERVALS = [2, 4, 6, 8, 12, 24, 48, 72, 96, 120, 168, 240, 336];
  let closest = SENSIBLE_INTERVALS[0]!;
  let minDist = Math.abs(hours - closest);
  for (const interval of SENSIBLE_INTERVALS) {
    const dist = Math.abs(hours - interval);
    if (dist < minDist) {
      minDist = dist;
      closest = interval;
    }
  }
  return closest;
}
