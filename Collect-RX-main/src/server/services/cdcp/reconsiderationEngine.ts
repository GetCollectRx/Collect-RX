/**
 * Phase 5: CDCP Reconsideration Engine
 *
 * Automates the Level 1 Reconsideration process defined in
 * Appendix C of the CDCP Dental Benefits Guide.
 *
 * Key rules:
 *  - Reconsideration window: 60 calendar days from denial date
 *  - Auto-escalate to Urgent queue at day 45
 *  - A DIFFERENT adjudicator must review the reconsideration
 *  - Only one Level 1 reconsideration is permitted per claim
 *  - Contact centre: 1-888-888-8110 (CDCP-specific)
 */

import type {
  CdcpDeniedClaim,
  ReconsiderationRecord,
  ReconsiderationStatus,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const RECONSIDERATION_WINDOW_DAYS = 60;
const URGENT_ESCALATION_DAYS = 45;

export const CDCP_CONTACT_CENTRE = '1-888-888-8110';
export const CDCP_SUN_LIFE_PO_BOX = 'PO Box 2890, Station Main, Montreal, QC H3C 0B3';

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Core Status Calculation ──────────────────────────────────────────────────

export function calculateReconsiderationStatus(
  denialDate: Date,
  asOf: Date = new Date()
): {
  status: ReconsiderationStatus;
  daysElapsed: number;
  daysRemaining: number;
  deadlineDate: Date;
  urgentEscalationDate: Date;
  isUrgent: boolean;
  isExpired: boolean;
} {
  const deadlineDate = addDays(denialDate, RECONSIDERATION_WINDOW_DAYS);
  const urgentEscalationDate = addDays(denialDate, URGENT_ESCALATION_DAYS);

  const daysElapsed = daysBetween(denialDate, asOf);
  const daysRemaining = Math.max(0, RECONSIDERATION_WINDOW_DAYS - daysElapsed);
  const isExpired = asOf >= deadlineDate;
  const isUrgent = !isExpired && asOf >= urgentEscalationDate;

  let status: ReconsiderationStatus;
  if (isExpired) {
    status = 'expired';
  } else if (isUrgent) {
    status = 'urgent';
  } else {
    status = 'eligible';
  }

  return { status, daysElapsed, daysRemaining, deadlineDate, urgentEscalationDate, isUrgent, isExpired };
}

// ─── Create Reconsideration Record ───────────────────────────────────────────

export function createReconsiderationRecord(
  claim: CdcpDeniedClaim,
  recordId: string,
  asOf: Date = new Date()
): ReconsiderationRecord {
  const timing = calculateReconsiderationStatus(claim.denialDate, asOf);

  return {
    id: recordId,
    claimId: claim.claimId,
    patientToken: claim.patientToken,
    practiceId: claim.practiceId,
    denialReasonCode: claim.denialReasonCode,
    denialDate: claim.denialDate,
    deadlineDate: timing.deadlineDate,
    urgentEscalationDate: timing.urgentEscalationDate,
    status: timing.status,
    evidenceChecklist: [],  // populated by evidenceMapper
    originalAdjudicatorId: claim.originalAdjudicatorId,
    assignedAdjudicatorId: undefined, // enforced: must differ from original
    createdAt: asOf,
    updatedAt: asOf,
  };
}

// ─── Adjudicator Rotation Enforcement ────────────────────────────────────────

export interface AdjudicatorAssignment {
  valid: boolean;
  assignedAdjudicatorId: string;
  reason?: string;
}

/**
 * Validates that the assigned adjudicator is different from the original.
 * The CDCP rules require a fresh review — the original adjudicator cannot
 * review their own denial decision.
 */
export function validateAdjudicatorRotation(
  originalAdjudicatorId: string | undefined,
  proposedAdjudicatorId: string
): AdjudicatorAssignment {
  if (!originalAdjudicatorId) {
    // Original adjudicator unknown — assignment is valid
    return { valid: true, assignedAdjudicatorId: proposedAdjudicatorId };
  }

  if (originalAdjudicatorId === proposedAdjudicatorId) {
    return {
      valid: false,
      assignedAdjudicatorId: proposedAdjudicatorId,
      reason: `Adjudicator ${proposedAdjudicatorId} issued the original denial and cannot review the reconsideration. Assign a different adjudicator.`,
    };
  }

  return { valid: true, assignedAdjudicatorId: proposedAdjudicatorId };
}

// ─── Queue Triage ─────────────────────────────────────────────────────────────

export type QueuePriority = 'urgent' | 'standard' | 'expired';

export interface QueuedReconsideration {
  record: ReconsiderationRecord;
  priority: QueuePriority;
  daysRemaining: number;
  recommendedAction: string;
}

export function triageReconsiderationQueue(
  records: ReconsiderationRecord[],
  asOf: Date = new Date()
): QueuedReconsideration[] {
  return records
    .filter(r => r.status !== 'expired' && r.status !== 'denied_final' && r.status !== 'approved')
    .map(r => {
      const timing = calculateReconsiderationStatus(r.denialDate, asOf);
      let priority: QueuePriority;
      let recommendedAction: string;

      if (timing.isExpired) {
        priority = 'expired';
        recommendedAction = 'Deadline passed. No reconsideration available. Escalate to human for write-off review.';
      } else if (timing.isUrgent) {
        priority = 'urgent';
        recommendedAction = `URGENT: ${timing.daysRemaining} days remaining. Submit reconsideration package immediately. Call ${CDCP_CONTACT_CENTRE}.`;
      } else {
        priority = 'standard';
        recommendedAction = `${timing.daysRemaining} days remaining. Complete evidence gathering before Day 45 escalation.`;
      }

      return { record: r, priority, daysRemaining: timing.daysRemaining, recommendedAction };
    })
    .sort((a, b) => {
      // Urgent first, then by days remaining (ascending — most urgent first)
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
      if (b.priority === 'urgent' && a.priority !== 'urgent') return 1;
      return a.daysRemaining - b.daysRemaining;
    });
}

// ─── Sync Detection Hook (called by Abeldent connector) ──────────────────────

export interface SyncDetectionResult {
  deniedClaims: CdcpDeniedClaim[];
  newReconsiderations: ReconsiderationRecord[];
  urgentEscalations: ReconsiderationRecord[];
}

/**
 * Called by the Abeldent sync connector whenever Transaction 11 (CDCP pre-auth)
 * records are ingested. Identifies denied claims and creates reconsideration records.
 */
export function processAbeldentSyncDenials(
  incomingClaims: CdcpDeniedClaim[],
  existingReconsiderationClaimIds: Set<string>,
  generateId: () => string,
  asOf: Date = new Date()
): SyncDetectionResult {
  const deniedClaims = incomingClaims.filter(c => c.transactionType === 'T11');
  const newReconsiderations: ReconsiderationRecord[] = [];
  const urgentEscalations: ReconsiderationRecord[] = [];

  for (const claim of deniedClaims) {
    if (existingReconsiderationClaimIds.has(claim.claimId)) continue;

    const record = createReconsiderationRecord(claim, generateId(), asOf);
    newReconsiderations.push(record);

    if (record.status === 'urgent') {
      urgentEscalations.push(record);
    }
  }

  return { deniedClaims, newReconsiderations, urgentEscalations };
}
