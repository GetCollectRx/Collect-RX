// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Self-Tuning Agent Types
//
// The self-tuner observes real call outcomes, transcripts, and reconciliation
// data, then proposes (and applies) rule updates without human intervention for
// low-risk changes. High-risk changes go to the adaptation ledger for review.
//
// Design principles:
//   1. PHI-safe — only carrier names, outcomes, and UUID tokens are analyzed
//   2. Conservative — auto-apply only LOW-risk changes after test-suite validation
//   3. Auditable — every change written to adaptation-ledger.json before apply
//   4. Rollback-capable — baseline rules preserved; learned rules are overlays
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Observed signal types (raw data from DB analysis)
// ─────────────────────────────────────────────────────────────────────────────

export interface CarrierOutcomeSignal {
  carrierId: string;
  sampleSize: number;
  windowDays: number;
  observedAt: string; // ISO

  resolvedCount: number;
  pendingCount: number;
  deniedCount: number;
  blockDetectedCount: number;
  failedCount: number;
  noAnswerCount: number;

  resolutionRatePct: number;
  blockRatePct: number;
  /** Median time from first call to RESOLVED outcome (hours) */
  medianResolutionHours: number | null;
  /** Median time from first call to first RESOLVED attempt (hours) */
  medianFirstResolutionHours: number | null;
  /** p90 resolution time (hours) */
  p90ResolutionHours: number | null;
  /** Average number of call attempts before resolution */
  avgAttemptsToResolve: number | null;
}

export interface RecallIntervalObservation {
  carrierId: string;
  legacyOutcomeCode: string;
  /** Current configured recall hours (from RECALL_HOURS map) */
  configuredHours: number;
  /** Observed median hours before the next attempt was actually needed */
  observedMedianHours: number | null;
  /** Observed p25 (25th percentile) — earlier bound for recall window */
  observedP25Hours: number | null;
  /** How many samples */
  sampleSize: number;
  /** True if observed significantly deviates from configured */
  isDrift: boolean;
  /** Direction of drift: sooner | later | stable */
  driftDirection: 'sooner' | 'later' | 'stable';
  driftMagnitudeHours: number;
}

export interface BlockPhraseSignal {
  /** The text snippet observed in transcripts immediately before BLOCK_DETECTED outcome */
  phraseCandidate: string;
  /** Number of times this phrase appeared before a block */
  occurrences: number;
  /** Number of calls where this phrase appeared (denominator) */
  totalCallsWithPhrase: number;
  /** Block rate when phrase is present (0–1) */
  blockRateWhenPresent: number;
  /** Whether this phrase is already in the known block phrase list */
  alreadyKnown: boolean;
}

export interface ReconciliationVariance {
  carrierId: string;
  cdtTier: string;
  sampleSize: number;
  /** Mean absolute error in dollars (estimate vs actual) */
  meanAbsoluteError: number;
  /** Median absolute error */
  medianAbsoluteError: number;
  /** % of estimates within $50 of actual */
  withinThresholdPct: number;
  /** Current confidence score adjustment needed (positive = score too high) */
  confidenceOverstatement: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposal types (what the learner suggests changing)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RuleProposal {
  proposalId: string;
  proposedAt: string; // ISO
  ruleType:
    | 'BLOCK_PHRASE'         // Add a new carrier block detection phrase
    | 'RECALL_INTERVAL'      // Adjust a carrier recall timing
    | 'CONFIDENCE_WEIGHT'    // Adjust confidence scoring weight
    | 'CARRIER_WAIT_DAY'     // Adjust minWaitDayForClaims for a carrier
    | 'ESCALATION_THRESHOLD' // Adjust when to escalate (days outstanding)
    ;
  riskLevel: RiskLevel;
  rationale: string;
  evidenceSummary: string;
  sampleSize: number;

  // The actual change (varies by ruleType)
  payload: BlockPhrasePayload | RecallIntervalPayload | ConfidenceWeightPayload | CarrierWaitDayPayload | EscalationThresholdPayload;

  status: 'PENDING' | 'APPROVED' | 'APPLIED' | 'REJECTED' | 'ROLLED_BACK';
  appliedAt?: string;
  rejectedReason?: string;
  testResultPassed?: boolean;
}

export interface BlockPhrasePayload {
  type: 'BLOCK_PHRASE';
  newPhrase: string;
  exampleTranscripts: string[]; // anonymized snippets
}

export interface RecallIntervalPayload {
  type: 'RECALL_INTERVAL';
  legacyOutcomeCode: string;
  carrierId?: string; // null = global for all carriers
  currentHours: number;
  proposedHours: number;
  changeDirection: 'sooner' | 'later';
}

export interface ConfidenceWeightPayload {
  type: 'CONFIDENCE_WEIGHT';
  carrierId: string;
  cdtTier: string;
  currentWeight: number;
  proposedWeight: number;
  reason: 'overestimating' | 'underestimating';
}

export interface CarrierWaitDayPayload {
  type: 'CARRIER_WAIT_DAY';
  carrierId: string;
  currentDay: number;
  proposedDay: number;
  evidenceSource: 'outcome_timing' | 'transcript_signal';
}

export interface EscalationThresholdPayload {
  type: 'ESCALATION_THRESHOLD';
  currentDays: number;
  proposedDays: number;
  rationale: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adaptation ledger (persistent audit trail)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdaptationRecord {
  recordId: string;
  cycleId: string;
  proposal: RuleProposal;
  appliedAt?: string;
  rollbackData?: unknown; // Previous state for rollback
  testSuitePassed?: boolean;
}

export interface AdaptationLedger {
  version: '1.0';
  lastUpdated: string;
  records: AdaptationRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Learned rule override files (loaded at startup, merged with hardcoded)
// ─────────────────────────────────────────────────────────────────────────────

export interface LearnedBlockPhrases {
  version: string;
  lastUpdated: string;
  phrases: Array<{
    phrase: string;
    addedAt: string;
    addedBy: 'self_tuner';
    occurrences: number;
    blockRateWhenPresent: number;
  }>;
}

export interface LearnedRecallIntervals {
  version: string;
  lastUpdated: string;
  /** Overrides to RECALL_HOURS map in claimRouter.ts */
  overrides: Array<{
    legacyOutcomeCode: string;
    carrierId?: string; // if null, applies to all
    proposedHours: number;
    confidence: number; // 0–1 based on sample size
    addedAt: string;
    sampleSize: number;
  }>;
}

export interface LearnedConfidenceWeights {
  version: string;
  lastUpdated: string;
  /** Per-carrier, per-tier confidence adjustments (-25 to +25) */
  adjustments: Array<{
    carrierId: string;
    cdtTier: string;
    adjustment: number; // negative = reduce, positive = increase
    addedAt: string;
    sampleSize: number;
    meanAbsoluteError: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-tuning cycle summary
// ─────────────────────────────────────────────────────────────────────────────

export interface SelfTuningCycleSummary {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  windowDays: number;

  carriersAnalyzed: number;
  signalsObserved: number;

  proposalsGenerated: number;
  proposalsAutoApplied: number;    // LOW risk, tests passed
  proposalsPendingReview: number;  // MEDIUM/HIGH risk
  proposalsRejected: number;       // tests failed or validation error

  appliedChanges: string[];        // human-readable list
  pendingChanges: string[];        // queued for human review

  testSuitePassedAfterChanges: boolean;
  errors: string[];
}
