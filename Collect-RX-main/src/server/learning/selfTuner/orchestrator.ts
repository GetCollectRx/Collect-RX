// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Self-Tuning Cycle Orchestrator
//
// Main entry point for the self-tuning agent. Runs the full observe → learn →
// propose → apply cycle. Integrates with the existing BullMQ job system and
// can be triggered manually via scripts/run-self-tuner.mjs.
//
// Architecture:
//   1. Observe  — read DB for call outcomes, transcripts, reconciliation data
//   2. Analyze  — extract signals (block phrases, recall drift, confidence gaps)
//   3. Propose  — generate rule proposals with risk classification
//   4. Apply    — auto-apply LOW-risk proposals after test-suite validation
//   5. Queue    — add MEDIUM/HIGH proposals to ledger for human review
//   6. Report   — return cycle summary (logged + can be sent via SMS)
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  analyzeAllCarriers,
  detectRecallIntervalDrift,
  extractBlockPhraseSignals,
  analyzeReconciliationVariance,
} from './callPatternAnalyzer.js';
import { generateAllProposals } from './ruleProposer.js';
import { applyProposal } from './ruleApplicator.js';
import { getLedgerSummary } from './adaptationLedger.js';
import type { SelfTuningCycleSummary, RuleProposal } from './types.js';

export interface SelfTunerOptions {
  windowDays?: number;
  /** practiceId for reconciliation variance analysis (optional) */
  practiceId?: string;
  /** Skip running vitest after each change (useful in CI / dry-run) */
  skipTests?: boolean;
  /** If true, analyze signals but do not apply any changes */
  dryRun?: boolean;
  /** Max auto-apply per cycle (default 5) */
  maxAutoApply?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Cycle
// ─────────────────────────────────────────────────────────────────────────────

export async function runSelfTuningCycle(
  prisma: PrismaClient,
  options: SelfTunerOptions = {},
): Promise<SelfTuningCycleSummary> {
  const {
    windowDays = 30,
    practiceId,
    skipTests = false,
    dryRun = false,
    maxAutoApply = 5,
  } = options;

  const cycleId = uuidv4();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  console.log(`[selfTuner] Starting cycle ${cycleId} (window: ${windowDays}d, dryRun: ${dryRun})`);

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1: Observe
  // ──────────────────────────────────────────────────────────────────────────
  let outcomeSignals: Awaited<ReturnType<typeof analyzeAllCarriers>> = [];
  let blockPhraseSignals: Awaited<ReturnType<typeof extractBlockPhraseSignals>> = [];
  let reconciliationVariances: Awaited<ReturnType<typeof analyzeReconciliationVariance>> = [];

  try {
    console.log('[selfTuner] Phase 1: Observing call outcomes...');
    outcomeSignals = await analyzeAllCarriers(prisma, windowDays);
    const totalSamples = outcomeSignals.reduce((s, o) => s + o.sampleSize, 0);
    console.log(`[selfTuner] Observed ${totalSamples} call attempts across ${outcomeSignals.length} carriers`);
  } catch (err) {
    errors.push(`Outcome analysis failed: ${(err as Error).message}`);
  }

  try {
    console.log('[selfTuner] Phase 1b: Scanning transcripts for block phrase signals...');
    blockPhraseSignals = await extractBlockPhraseSignals(prisma, windowDays * 3); // Wider window for phrases
  } catch (err) {
    errors.push(`Block phrase extraction failed: ${(err as Error).message}`);
  }

  let recallObservations: Awaited<ReturnType<typeof detectRecallIntervalDrift>> = [];
  try {
    console.log('[selfTuner] Phase 1c: Detecting recall interval drift...');
    const CARRIER_IDS = ['sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare'];
    const driftResults = await Promise.all(
      CARRIER_IDS.map((id) => detectRecallIntervalDrift(prisma, id, windowDays * 2)),
    );
    recallObservations = driftResults.flat();
    console.log(`[selfTuner] Found ${recallObservations.filter((o) => o.isDrift).length} recall interval drifts`);
  } catch (err) {
    errors.push(`Recall drift analysis failed: ${(err as Error).message}`);
  }

  if (practiceId) {
    try {
      console.log('[selfTuner] Phase 1d: Analyzing reconciliation variance...');
      reconciliationVariances = await analyzeReconciliationVariance(prisma, practiceId, windowDays * 3);
    } catch (err) {
      errors.push(`Reconciliation analysis failed: ${(err as Error).message}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 2: Propose
  // ──────────────────────────────────────────────────────────────────────────
  console.log('[selfTuner] Phase 2: Generating proposals...');
  const proposals = generateAllProposals({
    outcomeSignals,
    recallObservations,
    blockPhraseSignals,
    reconciliationVariances,
  });

  const lowRisk = proposals.filter((p) => p.riskLevel === 'LOW');
  const mediumHighRisk = proposals.filter((p) => p.riskLevel !== 'LOW');

  console.log(`[selfTuner] Generated ${proposals.length} proposals: ${lowRisk.length} LOW, ${mediumHighRisk.length} MEDIUM/HIGH`);

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 3: Apply (LOW-risk only, up to maxAutoApply)
  // ──────────────────────────────────────────────────────────────────────────
  const appliedChanges: string[] = [];
  const pendingChanges: string[] = [];
  let proposalsAutoApplied = 0;
  let proposalsRejected = 0;

  if (!dryRun) {
    console.log(`[selfTuner] Phase 3: Applying up to ${maxAutoApply} LOW-risk proposals...`);
    for (const proposal of lowRisk.slice(0, maxAutoApply)) {
      try {
        const result = await applyProposal(cycleId, proposal, { skipTests });
        if (result.applied) {
          proposalsAutoApplied++;
          appliedChanges.push(describeProposal(proposal));
        } else {
          proposalsRejected++;
          errors.push(`${describeProposal(proposal)}: ${result.reason ?? 'unknown error'}`);
        }
      } catch (err) {
        proposalsRejected++;
        errors.push(`Apply error: ${(err as Error).message}`);
      }
    }
  }

  // Queue remaining proposals for human review
  for (const proposal of mediumHighRisk) {
    pendingChanges.push(`[${proposal.riskLevel}] ${describeProposal(proposal)}`);
  }
  // Also queue LOW-risk proposals beyond the maxAutoApply cap
  for (const proposal of lowRisk.slice(maxAutoApply)) {
    pendingChanges.push(`[LOW-queued] ${describeProposal(proposal)}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────────
  const completedAt = new Date().toISOString();
  const totalSignals = outcomeSignals.reduce((s, o) => s + o.sampleSize, 0) +
    blockPhraseSignals.length + recallObservations.length + reconciliationVariances.length;

  const summary: SelfTuningCycleSummary = {
    cycleId,
    startedAt,
    completedAt,
    windowDays,
    carriersAnalyzed: outcomeSignals.filter((o) => o.sampleSize > 0).length,
    signalsObserved: totalSignals,
    proposalsGenerated: proposals.length,
    proposalsAutoApplied,
    proposalsPendingReview: pendingChanges.length,
    proposalsRejected,
    appliedChanges,
    pendingChanges,
    testSuitePassedAfterChanges: proposalsRejected === 0 || errors.length === 0,
    errors,
  };

  console.log('[selfTuner] Cycle complete:', JSON.stringify({
    applied: proposalsAutoApplied,
    pending: pendingChanges.length,
    errors: errors.length,
  }));

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal status check (no DB needed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a summary of everything the self-tuner has ever learned.
 * Does not require DB — reads from the adaptation ledger only.
 */
export function getSelfTunerStatus(): ReturnType<typeof getLedgerSummary> {
  return getLedgerSummary();
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function describeProposal(p: RuleProposal): string {
  const payload = p.payload;
  switch (payload.type) {
    case 'BLOCK_PHRASE':
      return `Add block phrase: "${payload.newPhrase}"`;
    case 'RECALL_INTERVAL':
      return `Recall interval for "${payload.legacyOutcomeCode}" (${payload.carrierId ?? 'all'}): ${payload.currentHours}h → ${payload.proposedHours}h`;
    case 'CONFIDENCE_WEIGHT':
      return `Confidence adjustment for ${payload.carrierId}/${payload.cdtTier}: ${payload.currentWeight} → ${payload.proposedWeight}`;
    case 'CARRIER_WAIT_DAY':
      return `Carrier wait day for ${payload.carrierId}: day ${payload.currentDay} → day ${payload.proposedDay}`;
    case 'ESCALATION_THRESHOLD':
      return `Escalation threshold: ${payload.currentDays}d → ${payload.proposedDays}d`;
    default:
      return `Unknown rule type: ${(payload as { type: string }).type}`;
  }
}
