// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Self-Tuning Call Pattern Analyzer
//
// Reads real call outcome data from the DB and extracts signals the learner
// uses to propose rule updates. All analysis is PHI-safe — only carrier names,
// outcome enums, durations, and anonymized transcript snippets are used.
//
// Works without a DB (returns empty signals) so the module is always testable.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client';
import type {
  CarrierOutcomeSignal,
  RecallIntervalObservation,
  BlockPhraseSignal,
  ReconciliationVariance,
} from './types.js';

// Current configured recall intervals (mirrors claimRouter.ts RECALL_HOURS)
const BASELINE_RECALL_HOURS: Record<string, number> = {
  processing: 72,
  no_answer: 4,
  failed: 24,
  hung_up: 24,
  payment_trace: 336,
  resubmit_cleared: 336,
};

// ─────────────────────────────────────────────────────────────────────────────
// Carrier Outcome Analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute per-carrier outcome statistics over the given time window.
 * Returns an empty signal (sampleSize=0) when the DB is unavailable.
 */
export async function analyzeCarrierOutcomes(
  prisma: PrismaClient,
  carrierId: string,
  windowDays = 30,
): Promise<CarrierOutcomeSignal> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const base: CarrierOutcomeSignal = {
    carrierId,
    sampleSize: 0,
    windowDays,
    observedAt: new Date().toISOString(),
    resolvedCount: 0,
    pendingCount: 0,
    deniedCount: 0,
    blockDetectedCount: 0,
    failedCount: 0,
    noAnswerCount: 0,
    resolutionRatePct: 0,
    blockRatePct: 0,
    medianResolutionHours: null,
    medianFirstResolutionHours: null,
    p90ResolutionHours: null,
    avgAttemptsToResolve: null,
  };

  try {
    const attempts = await prisma.callAttempt.findMany({
      where: {
        completedAt: { gte: since },
        claim: { carrierId: carrierId as unknown as never },
        outcome: { not: null },
      },
      select: {
        outcome: true,
        initiatedAt: true,
        completedAt: true,
        carrierBlockDetected: true,
        claimId: true,
      },
      take: 2000,
    });

    if (attempts.length === 0) return base;

    const signal = { ...base, sampleSize: attempts.length };

    for (const a of attempts) {
      if (!a.outcome) continue;
      switch (a.outcome) {
        case 'RESOLVED': signal.resolvedCount++; break;
        case 'PENDING':  signal.pendingCount++;  break;
        case 'DENIED':   signal.deniedCount++;   break;
        case 'BLOCK_DETECTED': signal.blockDetectedCount++; break;
        case 'FAILED':   signal.failedCount++;   break;
        case 'NO_ANSWER': signal.noAnswerCount++; break;
      }
    }

    signal.resolutionRatePct =
      signal.sampleSize > 0
        ? Math.round((signal.resolvedCount / signal.sampleSize) * 1000) / 10
        : 0;
    signal.blockRatePct =
      signal.sampleSize > 0
        ? Math.round((signal.blockDetectedCount / signal.sampleSize) * 1000) / 10
        : 0;

    // Compute resolution time distribution
    const resolvedAttempts = attempts.filter(
      (a) => a.outcome === 'RESOLVED' && a.completedAt,
    );
    if (resolvedAttempts.length > 0) {
      const durations = resolvedAttempts
        .map((a) => (a.completedAt!.getTime() - a.initiatedAt.getTime()) / 3_600_000)
        .sort((a, b) => a - b);

      signal.medianFirstResolutionHours = percentile(durations, 50);
      signal.p90ResolutionHours = percentile(durations, 90);
    }

    // Compute avg attempts to resolve per claim
    const claimAttemptCounts = new Map<string, number>();
    for (const a of attempts) {
      claimAttemptCounts.set(a.claimId, (claimAttemptCounts.get(a.claimId) ?? 0) + 1);
    }
    const attemptCounts = Array.from(claimAttemptCounts.values());
    if (attemptCounts.length > 0) {
      signal.avgAttemptsToResolve =
        Math.round((attemptCounts.reduce((s, c) => s + c, 0) / attemptCounts.length) * 10) / 10;
    }

    return signal;
  } catch {
    // DB unavailable — return empty signal
    return base;
  }
}

/**
 * Analyze all 6 core carriers in parallel.
 */
export async function analyzeAllCarriers(
  prisma: PrismaClient,
  windowDays = 30,
): Promise<CarrierOutcomeSignal[]> {
  const CARRIER_IDS = [
    'sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare',
  ];
  return Promise.all(CARRIER_IDS.map((id) => analyzeCarrierOutcomes(prisma, id, windowDays)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Recall Interval Drift Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects whether configured recall intervals match observed resolution timing.
 *
 * Logic: for each (carrier, outcomeCode) pair, measure the time between a call
 * with that outcome and the NEXT call that actually produced RESOLVED. If the
 * median observed time significantly differs from the configured recall hours,
 * flag it as drift.
 *
 * Drift threshold: > 20% difference AND sample size >= 10.
 */
export async function detectRecallIntervalDrift(
  prisma: PrismaClient,
  carrierId: string,
  windowDays = 60,
): Promise<RecallIntervalObservation[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const observations: RecallIntervalObservation[] = [];

  for (const [legacyCode, configuredHours] of Object.entries(BASELINE_RECALL_HOURS)) {
    try {
      // Find claims with this carrier that went through this outcome code
      const pendingAttempts = await prisma.callAttempt.findMany({
        where: {
          completedAt: { gte: since },
          claim: { carrierId: carrierId as unknown as never },
          outcomeDetail: { contains: legacyCode },
        },
        select: {
          claimId: true,
          completedAt: true,
        },
        take: 200,
      });

      if (pendingAttempts.length < 5) continue;

      // For each pending attempt, find the next attempt on the same claim
      const waitTimes: number[] = [];
      for (const attempt of pendingAttempts) {
        if (!attempt.completedAt) continue;
        const nextAttempt = await prisma.callAttempt.findFirst({
          where: {
            claimId: attempt.claimId,
            initiatedAt: { gt: attempt.completedAt },
          },
          orderBy: { initiatedAt: 'asc' },
          select: { initiatedAt: true, outcome: true },
        });
        if (nextAttempt) {
          const waitHours =
            (nextAttempt.initiatedAt.getTime() - attempt.completedAt.getTime()) / 3_600_000;
          waitTimes.push(waitHours);
        }
      }

      if (waitTimes.length < 5) continue;

      waitTimes.sort((a, b) => a - b);
      const observedMedian = percentile(waitTimes, 50)!;
      const observedP25 = percentile(waitTimes, 25);
      const driftHours = observedMedian - configuredHours;
      const driftPct = Math.abs(driftHours) / configuredHours;
      const isDrift = driftPct > 0.2 && waitTimes.length >= 10;

      observations.push({
        carrierId,
        legacyOutcomeCode: legacyCode,
        configuredHours,
        observedMedianHours: observedMedian,
        observedP25Hours: observedP25,
        sampleSize: waitTimes.length,
        isDrift,
        driftDirection: driftHours > 0 ? 'later' : driftHours < 0 ? 'sooner' : 'stable',
        driftMagnitudeHours: Math.abs(driftHours),
      });
    } catch {
      // DB unavailable for this carrier/code pair — skip
    }
  }

  return observations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Block Phrase Signal Extraction
// ─────────────────────────────────────────────────────────────────────────────

// Known phrases already in the baseline (from carrierBlockPhrases.ts)
const KNOWN_BLOCK_PHRASES = [
  'automated', 'bot', 'system detected', 'not a live agent',
  'cannot process automated', 'fraud detection', 'call flagged',
];

/**
 * Scans call transcripts for new phrases that correlate with BLOCK_DETECTED outcomes.
 *
 * PHI-safe: only carrier-rep speech (not patient voice lines) is analyzed.
 * UUID tokens and procedure codes are excluded from candidates.
 */
export async function extractBlockPhraseSignals(
  prisma: PrismaClient,
  windowDays = 90,
): Promise<BlockPhraseSignal[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  try {
    // Get blocked calls
    const blockedCalls = await prisma.callAttempt.findMany({
      where: {
        completedAt: { gte: since },
        carrierBlockDetected: true,
      },
      select: { vapiCallId: true },
      take: 500,
    });

    // Get all recent calls for denominator
    const allCalls = await prisma.callAttempt.findMany({
      where: { completedAt: { gte: since } },
      select: { vapiCallId: true, carrierBlockDetected: true },
      take: 5000,
    });

    if (blockedCalls.length === 0) return [];

    const blockedCallIds = new Set(blockedCalls.map((c) => c.vapiCallId));
    const allCallIds = new Set(allCalls.map((c) => c.vapiCallId));

    // Get transcript lines from blocked calls (carrier-rep lines only)
    const transcriptLines = await prisma.callTranscriptLine.findMany({
      where: {
        vapiCallId: { in: Array.from(blockedCallIds) },
        speaker: { notIn: ['patient', 'agent', 'IVR_Navigator'] }, // Only carrier rep lines
      },
      select: { text: true, vapiCallId: true },
      take: 5000,
    });

    // Extract n-gram candidates
    const candidatePhrases = extractNgramCandidates(
      transcriptLines.map((t) => t.text),
      { minLength: 3, maxWords: 6, minOccurrences: 3 },
    );

    // For each candidate, compute block rate when phrase is present
    const signals: BlockPhraseSignal[] = [];

    for (const [phrase, blockedOccurrences] of candidatePhrases.entries()) {
      if (blockedOccurrences < 3) continue;
      if (isKnownPhrase(phrase)) continue;
      if (isProbablyNotASignal(phrase)) continue;

      // Count calls where this phrase appeared
      const callsWithPhrase = transcriptLines.filter((t) =>
        t.text.toLowerCase().includes(phrase),
      ).length;

      if (callsWithPhrase === 0) continue;

      const blockRateWhenPresent = Math.min(1, blockedOccurrences / callsWithPhrase);
      if (blockRateWhenPresent < 0.5) continue; // Only high-correlation phrases

      signals.push({
        phraseCandidate: phrase,
        occurrences: blockedOccurrences,
        totalCallsWithPhrase: callsWithPhrase,
        blockRateWhenPresent,
        alreadyKnown: false,
      });
    }

    return signals
      .sort((a, b) => b.blockRateWhenPresent - a.blockRateWhenPresent)
      .slice(0, 20);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Variance Analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes estimate accuracy per carrier and CDT tier from reconciliation logs.
 * Used to calibrate the confidence scoring weights in the eligibility engine.
 */
export async function analyzeReconciliationVariance(
  prisma: PrismaClient,
  practiceId: string,
  windowDays = 90,
): Promise<ReconciliationVariance[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  try {
    // ReconciliationLog stores carrier, tier, estimated vs actual
    const logs = await prisma.reconciliationLog.findMany({
      where: {
        practiceId,
        createdAt: { gte: since },
      },
      select: {
        carrierId: true,
        tier: true,
        estimatedPatientPortion: true,
        actualPatientPortion: true,
        variance: true,
        requiresHumanReview: true,
      },
      take: 2000,
    });

    if (logs.length === 0) return [];

    // Group by carrier + tier
    const groups = new Map<string, typeof logs>();
    for (const log of logs) {
      const key = `${log.carrierId}:${log.tier}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(log);
    }

    const variances: ReconciliationVariance[] = [];
    for (const [key, group] of groups.entries()) {
      const [carrierId, cdtTier] = key.split(':');
      const absErrors = group
        .map((l) => Math.abs(Number(l.variance ?? 0)))
        .sort((a, b) => a - b);

      const meanAbsoluteError =
        absErrors.reduce((s, e) => s + e, 0) / absErrors.length;
      const medianAbsoluteError = percentile(absErrors, 50) ?? 0;
      const withinThresholdCount = absErrors.filter((e) => e <= 50).length;
      const withinThresholdPct =
        Math.round((withinThresholdCount / absErrors.length) * 1000) / 10;

      // If within-threshold rate < 70%, confidence is overstated
      const confidenceOverstatement = withinThresholdPct < 70 ? 70 - withinThresholdPct : 0;

      variances.push({
        carrierId: carrierId!,
        cdtTier: cdtTier!,
        sampleSize: group.length,
        meanAbsoluteError,
        medianAbsoluteError,
        withinThresholdPct,
        confidenceOverstatement,
      });
    }

    return variances.sort((a, b) => b.meanAbsoluteError - a.meanAbsoluteError);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!;
}

/**
 * Extract n-gram phrases from carrier-rep transcript lines.
 * Returns map of phrase → count of appearances in BLOCKED calls.
 */
function extractNgramCandidates(
  texts: string[],
  options: { minLength: number; maxWords: number; minOccurrences: number },
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const text of texts) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    for (let n = 1; n <= options.maxWords; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const phrase = words.slice(i, i + n).join(' ');
        if (phrase.length >= options.minLength) {
          counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
        }
      }
    }
  }

  // Filter by min occurrences
  for (const [phrase, count] of counts.entries()) {
    if (count < options.minOccurrences) counts.delete(phrase);
  }

  return counts;
}

function isKnownPhrase(phrase: string): boolean {
  return KNOWN_BLOCK_PHRASES.some((known) => phrase.includes(known) || known.includes(phrase));
}

/**
 * Filters out phrases that are unlikely to be automation signals:
 * - UUID-like patterns (tokens)
 * - Pure numbers
 * - Very common stop words
 * - CDT code patterns
 */
function isProbablyNotASignal(phrase: string): boolean {
  if (/^[0-9a-f-]{36}$/i.test(phrase)) return true; // UUID
  if (/^[0-9\s]+$/.test(phrase)) return true;         // Pure numbers
  if (/^d\d{4}$/.test(phrase)) return true;            // CDT code
  if (phrase.split(' ').length === 1 && phrase.length < 5) return true; // Too short
  const STOP_PHRASES = ['the claim', 'your claim', 'the patient', 'please hold', 'one moment'];
  return STOP_PHRASES.some((s) => phrase === s);
}
