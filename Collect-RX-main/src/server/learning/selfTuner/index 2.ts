// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Self-Tuning Agent Public API
// ─────────────────────────────────────────────────────────────────────────────

export { runSelfTuningCycle, getSelfTunerStatus } from './orchestrator.js';
export {
  loadLearnedBlockPhrases,
  getLearnedRecallHours,
  getLearnedConfidenceAdjustment,
} from './ruleApplicator.js';
export {
  readLedger,
  getLedgerSummary,
  getPendingProposals,
  getAppliedRecords,
} from './adaptationLedger.js';
export type {
  SelfTuningCycleSummary,
  RuleProposal,
  AdaptationRecord,
  AdaptationLedger,
  CarrierOutcomeSignal,
  BlockPhraseSignal,
  RecallIntervalObservation,
  ReconciliationVariance,
} from './types.js';

// Pure analysis functions (useful for one-off inspection)
export {
  analyzeCarrierOutcomes,
  analyzeAllCarriers,
  detectRecallIntervalDrift,
  extractBlockPhraseSignals,
  analyzeReconciliationVariance,
} from './callPatternAnalyzer.js';

// Rule proposal functions (pure, DB-free)
export {
  proposeBlockPhrases,
  proposeRecallIntervalAdjustments,
  proposeConfidenceRecalibrations,
  proposeCarrierWaitDayAdjustments,
  generateAllProposals,
  roundToSensibleInterval,
} from './ruleProposer.js';
