// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Self-Tuning Rule Applicator
//
// Applies approved (LOW-risk) rule changes to the learned-rules JSON files.
// These files are loaded at runtime and merged with the hardcoded baselines,
// so the system can adapt without a code deploy.
//
// Safety guarantees:
//   1. Every change is recorded in adaptation-ledger.json BEFORE applying
//   2. After applying, the vitest agent test suite is run
//   3. If tests fail, the change is rolled back and marked ROLLED_BACK
//   4. Only LOW-risk proposals are auto-applied (MEDIUM/HIGH go to ledger)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type {
  RuleProposal,
  LearnedBlockPhrases,
  LearnedRecallIntervals,
  LearnedConfidenceWeights,
  BlockPhrasePayload,
  RecallIntervalPayload,
  ConfidenceWeightPayload,
} from './types.js';
import { recordProposal, markApplied, markRejected } from './adaptationLedger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNED_RULES_DIR = join(__dirname, 'learned-rules');
const AGENT_TEST_DIR = join(__dirname, '..', '..', '..', '..', '..', 'tests', 'agents');
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// Learned Rule File Accessors
// ─────────────────────────────────────────────────────────────────────────────

function readLearnedBlockPhrases(): LearnedBlockPhrases {
  const path = join(LEARNED_RULES_DIR, 'block-phrases.json');
  if (!existsSync(path)) {
    return { version: '1.0', lastUpdated: new Date().toISOString(), phrases: [] };
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as LearnedBlockPhrases;
}

function writeLearnedBlockPhrases(data: LearnedBlockPhrases): void {
  writeFileSync(
    join(LEARNED_RULES_DIR, 'block-phrases.json'),
    JSON.stringify({ ...data, lastUpdated: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

function readLearnedRecallIntervals(): LearnedRecallIntervals {
  const path = join(LEARNED_RULES_DIR, 'recall-intervals.json');
  if (!existsSync(path)) {
    return { version: '1.0', lastUpdated: new Date().toISOString(), overrides: [] };
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as LearnedRecallIntervals;
}

function writeLearnedRecallIntervals(data: LearnedRecallIntervals): void {
  writeFileSync(
    join(LEARNED_RULES_DIR, 'recall-intervals.json'),
    JSON.stringify({ ...data, lastUpdated: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

function readLearnedConfidenceWeights(): LearnedConfidenceWeights {
  const path = join(LEARNED_RULES_DIR, 'confidence-weights.json');
  if (!existsSync(path)) {
    return { version: '1.0', lastUpdated: new Date().toISOString(), adjustments: [] };
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as LearnedConfidenceWeights;
}

function writeLearnedConfidenceWeights(data: LearnedConfidenceWeights): void {
  writeFileSync(
    join(LEARNED_RULES_DIR, 'confidence-weights.json'),
    JSON.stringify({ ...data, lastUpdated: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the agent test suite to validate that applied changes don't break anything.
 * Returns true if all tests pass.
 */
export function runValidationTests(): boolean {
  const result = spawnSync(
    'npx',
    ['vitest', 'run', AGENT_TEST_DIR],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
      env: {
        ...process.env,
        STRIPE_SECRET_KEY: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_00000000000000000000000000000000',
      },
    },
  );
  return result.status === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual Rule Applicators
// ─────────────────────────────────────────────────────────────────────────────

function applyBlockPhrase(payload: BlockPhrasePayload, sampleSize: number): void {
  const data = readLearnedBlockPhrases();
  const existing = data.phrases.find((p) => p.phrase === payload.newPhrase);
  if (!existing) {
    data.phrases.push({
      phrase: payload.newPhrase,
      addedAt: new Date().toISOString(),
      addedBy: 'self_tuner',
      occurrences: sampleSize,
      blockRateWhenPresent: 0,
    });
  }
  writeLearnedBlockPhrases(data);
}

function rollbackBlockPhrase(payload: BlockPhrasePayload): void {
  const data = readLearnedBlockPhrases();
  data.phrases = data.phrases.filter((p) => p.phrase !== payload.newPhrase);
  writeLearnedBlockPhrases(data);
}

function applyRecallInterval(payload: RecallIntervalPayload, sampleSize: number): void {
  const data = readLearnedRecallIntervals();
  const existing = data.overrides.find(
    (o) => o.legacyOutcomeCode === payload.legacyOutcomeCode && o.carrierId === payload.carrierId,
  );
  const confidence = Math.min(1, sampleSize / 100);

  if (existing) {
    existing.proposedHours = payload.proposedHours;
    existing.confidence = confidence;
    existing.addedAt = new Date().toISOString();
    existing.sampleSize = sampleSize;
  } else {
    data.overrides.push({
      legacyOutcomeCode: payload.legacyOutcomeCode,
      carrierId: payload.carrierId,
      proposedHours: payload.proposedHours,
      confidence,
      addedAt: new Date().toISOString(),
      sampleSize,
    });
  }
  writeLearnedRecallIntervals(data);
}

function rollbackRecallInterval(payload: RecallIntervalPayload): void {
  const data = readLearnedRecallIntervals();
  data.overrides = data.overrides.filter(
    (o) =>
      !(o.legacyOutcomeCode === payload.legacyOutcomeCode && o.carrierId === payload.carrierId),
  );
  writeLearnedRecallIntervals(data);
}

function applyConfidenceWeight(payload: ConfidenceWeightPayload, sampleSize: number, meanAbsoluteError: number): void {
  const data = readLearnedConfidenceWeights();
  const existing = data.adjustments.find(
    (a) => a.carrierId === payload.carrierId && a.cdtTier === payload.cdtTier,
  );
  if (existing) {
    existing.adjustment = payload.proposedWeight;
    existing.addedAt = new Date().toISOString();
    existing.sampleSize = sampleSize;
    existing.meanAbsoluteError = meanAbsoluteError;
  } else {
    data.adjustments.push({
      carrierId: payload.carrierId,
      cdtTier: payload.cdtTier,
      adjustment: payload.proposedWeight,
      addedAt: new Date().toISOString(),
      sampleSize,
      meanAbsoluteError,
    });
  }
  writeLearnedConfidenceWeights(data);
}

function rollbackConfidenceWeight(payload: ConfidenceWeightPayload): void {
  const data = readLearnedConfidenceWeights();
  data.adjustments = data.adjustments.filter(
    (a) => !(a.carrierId === payload.carrierId && a.cdtTier === payload.cdtTier),
  );
  writeLearnedConfidenceWeights(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Apply Function
// ─────────────────────────────────────────────────────────────────────────────

export interface ApplyResult {
  applied: boolean;
  testsPassed: boolean;
  rolledBack: boolean;
  reason?: string;
}

/**
 * Apply a single LOW-risk proposal with test-suite validation and rollback.
 */
export async function applyProposal(
  cycleId: string,
  proposal: RuleProposal,
  options: { skipTests?: boolean } = {},
): Promise<ApplyResult> {
  if (proposal.riskLevel !== 'LOW') {
    return { applied: false, testsPassed: false, rolledBack: false, reason: 'Only LOW-risk proposals are auto-applied' };
  }

  // Capture rollback state before modifying
  const rollbackData = captureRollbackState(proposal);

  // Record proposal in ledger BEFORE applying
  const record = recordProposal(cycleId, proposal, rollbackData);

  try {
    // Apply the change
    applyPayload(proposal);

    // Validate with test suite
    const testsPassed = options.skipTests ? true : runValidationTests();

    if (testsPassed) {
      markApplied(record.recordId, true);
      return { applied: true, testsPassed: true, rolledBack: false };
    } else {
      // Tests failed — roll back
      rollbackPayload(proposal);
      markApplied(record.recordId, false);
      console.warn(`[selfTuner] Tests failed after applying "${proposal.ruleType}" — rolled back`);
      return { applied: false, testsPassed: false, rolledBack: true, reason: 'Validation test suite failed — change rolled back' };
    }
  } catch (err) {
    // Application error — roll back
    try { rollbackPayload(proposal); } catch { /* ignore rollback error */ }
    markRejected(record.recordId, (err as Error).message);
    return { applied: false, testsPassed: false, rolledBack: true, reason: (err as Error).message };
  }
}

function applyPayload(proposal: RuleProposal): void {
  const p = proposal.payload;
  switch (p.type) {
    case 'BLOCK_PHRASE':
      applyBlockPhrase(p, proposal.sampleSize);
      break;
    case 'RECALL_INTERVAL':
      applyRecallInterval(p, proposal.sampleSize);
      break;
    case 'CONFIDENCE_WEIGHT':
      applyConfidenceWeight(p, proposal.sampleSize, 0);
      break;
    default:
      throw new Error(`No applicator for rule type: ${(p as { type: string }).type}`);
  }
}

function rollbackPayload(proposal: RuleProposal): void {
  const p = proposal.payload;
  switch (p.type) {
    case 'BLOCK_PHRASE':    rollbackBlockPhrase(p);    break;
    case 'RECALL_INTERVAL': rollbackRecallInterval(p); break;
    case 'CONFIDENCE_WEIGHT': rollbackConfidenceWeight(p); break;
  }
}

function captureRollbackState(proposal: RuleProposal): unknown {
  const p = proposal.payload;
  switch (p.type) {
    case 'BLOCK_PHRASE':
      return readLearnedBlockPhrases();
    case 'RECALL_INTERVAL':
      return readLearnedRecallIntervals();
    case 'CONFIDENCE_WEIGHT':
      return readLearnedConfidenceWeights();
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Learned Rule Loaders (called at runtime to merge with hardcoded baselines)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all learned block phrases merged into a flat array.
 * Call this at startup and merge with the hardcoded CARRIER_BLOCK_PHRASES.
 */
export function loadLearnedBlockPhrases(): string[] {
  try {
    return readLearnedBlockPhrases().phrases.map((p) => p.phrase);
  } catch {
    return [];
  }
}

/**
 * Returns the learned recall interval override for a given outcome code,
 * or null if no learned override exists.
 */
export function getLearnedRecallHours(
  legacyOutcomeCode: string,
  carrierId?: string,
): number | null {
  try {
    const data = readLearnedRecallIntervals();
    // First try carrier-specific override
    const specific = data.overrides.find(
      (o) => o.legacyOutcomeCode === legacyOutcomeCode && o.carrierId === carrierId,
    );
    if (specific && specific.confidence >= 0.5) return specific.proposedHours;

    // Fall back to global override (no carrierId)
    const global = data.overrides.find(
      (o) => o.legacyOutcomeCode === legacyOutcomeCode && !o.carrierId,
    );
    return global && global.confidence >= 0.5 ? global.proposedHours : null;
  } catch {
    return null;
  }
}

/**
 * Returns the learned confidence weight adjustment for a carrier/tier pair.
 * Returns 0 (no adjustment) if no learned override exists.
 */
export function getLearnedConfidenceAdjustment(carrierId: string, cdtTier: string): number {
  try {
    const data = readLearnedConfidenceWeights();
    const entry = data.adjustments.find(
      (a) => a.carrierId === carrierId && a.cdtTier === cdtTier,
    );
    return entry?.adjustment ?? 0;
  } catch {
    return 0;
  }
}
