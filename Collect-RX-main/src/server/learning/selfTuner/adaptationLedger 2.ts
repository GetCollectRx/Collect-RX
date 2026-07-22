// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Adaptation Ledger
//
// Persistent audit trail for all proposed and applied rule changes.
// Stored in learned-rules/adaptation-ledger.json — version controlled,
// human-readable, and rollback-capable.
//
// Every change applied by the self-tuner is recorded here before application.
// The ledger is the single source of truth for "what has the system learned."
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import type { AdaptationLedger, AdaptationRecord, RuleProposal } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNED_RULES_DIR = join(__dirname, 'learned-rules');
const LEDGER_PATH = join(LEARNED_RULES_DIR, 'adaptation-ledger.json');

// ─────────────────────────────────────────────────────────────────────────────
// Ledger I/O
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(LEARNED_RULES_DIR)) {
    mkdirSync(LEARNED_RULES_DIR, { recursive: true });
  }
}

export function readLedger(): AdaptationLedger {
  ensureDir();
  if (!existsSync(LEDGER_PATH)) {
    return { version: '1.0', lastUpdated: new Date().toISOString(), records: [] };
  }
  try {
    const raw = readFileSync(LEDGER_PATH, 'utf-8');
    return JSON.parse(raw) as AdaptationLedger;
  } catch {
    console.warn('[selfTuner] Ledger parse error — starting fresh');
    return { version: '1.0', lastUpdated: new Date().toISOString(), records: [] };
  }
}

export function writeLedger(ledger: AdaptationLedger): void {
  ensureDir();
  const pruned = pruneLedger(ledger);
  writeFileSync(LEDGER_PATH, JSON.stringify(pruned, null, 2), 'utf-8');
}

/**
 * Keep only the last 90 days of records to prevent unbounded growth.
 */
function pruneLedger(ledger: AdaptationLedger): AdaptationLedger {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  return {
    ...ledger,
    lastUpdated: new Date().toISOString(),
    records: ledger.records.filter((r) => r.proposal.proposedAt >= cutoff),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a new proposal to the ledger (before applying).
 */
export function recordProposal(
  cycleId: string,
  proposal: RuleProposal,
  rollbackData: unknown,
): AdaptationRecord {
  const record: AdaptationRecord = {
    recordId: uuidv4(),
    cycleId,
    proposal,
    rollbackData,
  };

  const ledger = readLedger();
  ledger.records.push(record);
  writeLedger(ledger);

  return record;
}

/**
 * Mark a proposal as applied (test suite passed).
 */
export function markApplied(
  recordId: string,
  testSuitePassed: boolean,
): void {
  const ledger = readLedger();
  const record = ledger.records.find((r) => r.recordId === recordId);
  if (!record) return;

  record.proposal.status = testSuitePassed ? 'APPLIED' : 'ROLLED_BACK';
  record.proposal.appliedAt = new Date().toISOString();
  record.testSuitePassed = testSuitePassed;
  record.appliedAt = new Date().toISOString();

  writeLedger(ledger);
}

/**
 * Mark a proposal as rejected (manual review or validation failure).
 */
export function markRejected(recordId: string, reason: string): void {
  const ledger = readLedger();
  const record = ledger.records.find((r) => r.recordId === recordId);
  if (!record) return;

  record.proposal.status = 'REJECTED';
  record.proposal.rejectedReason = reason;

  writeLedger(ledger);
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getPendingProposals(): AdaptationRecord[] {
  return readLedger().records.filter((r) => r.proposal.status === 'PENDING');
}

export function getAppliedRecords(): AdaptationRecord[] {
  return readLedger().records.filter((r) => r.proposal.status === 'APPLIED');
}

export function getRolledBackRecords(): AdaptationRecord[] {
  return readLedger().records.filter((r) => r.proposal.status === 'ROLLED_BACK');
}

/**
 * Get a summary of what has been learned and applied.
 */
export function getLedgerSummary(): {
  totalProposals: number;
  applied: number;
  pending: number;
  rejected: number;
  rolledBack: number;
  byRuleType: Record<string, number>;
  mostRecentApplied: string | null;
} {
  const ledger = readLedger();
  const records = ledger.records;

  const byRuleType: Record<string, number> = {};
  let mostRecentApplied: string | null = null;

  for (const r of records) {
    const type = r.proposal.ruleType;
    byRuleType[type] = (byRuleType[type] ?? 0) + 1;
    if (r.proposal.status === 'APPLIED' && r.appliedAt) {
      if (!mostRecentApplied || r.appliedAt > mostRecentApplied) {
        mostRecentApplied = r.appliedAt;
      }
    }
  }

  return {
    totalProposals: records.length,
    applied: records.filter((r) => r.proposal.status === 'APPLIED').length,
    pending: records.filter((r) => r.proposal.status === 'PENDING').length,
    rejected: records.filter((r) => r.proposal.status === 'REJECTED').length,
    rolledBack: records.filter((r) => r.proposal.status === 'ROLLED_BACK').length,
    byRuleType,
    mostRecentApplied,
  };
}
