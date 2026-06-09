// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Claim recovery router
//
// Single decision surface: after a call outcome (or sync timeout), choose
// CALL_CARRIER | WAIT_SYNC | OPEN_CDCP | PRACTICE_GATE | STOP.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome, ClaimStatus, QueueStatus } from '@prisma/client';
import type {
  ClaimRouterDecisionRow,
  ClaimRouterInput,
  LegacyOutcomeCode,
  RecoveryDecision,
} from './types.js';
import { extractLegacyOutcomeCode, isCdcpCarrierContext } from './legacyOutcomeCode.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Carrier SLA re-call offsets (hours) — mirrors legacy processor + product rules. */
const RECALL_HOURS: Record<string, number> = {
  processing: 72,
  no_answer: 4,
  failed: 24,
  hung_up: 24,
  payment_trace: 336, // 14 days
  resubmit_cleared: 336,
};

/**
 * Published decision table for API/docs — aligned with `routeClaimRecovery`.
 * Order matters for human reading; runtime uses imperative rules below.
 */
export const CLAIM_ROUTER_DECISION_TABLE: ClaimRouterDecisionRow[] = [
  {
    when: 'BLOCK_DETECTED / carrier_block',
    route: 'STOP',
    claimStatus: 'BLOCKED',
    queueStatus: 'BLOCKED',
    recall: 'none',
    gate: 'none',
    notes: 'Carrier block protocol; all calls to carrier suspended.',
  },
  {
    when: 'RESOLVED + corroborated (ref or structured payload)',
    route: 'WAIT_SYNC',
    claimStatus: 'RESOLVED',
    queueStatus: 'COMPLETED',
    recall: '14d payment trace if sync unchanged',
    gate: 'PAYMENT_VERIFY_SYNC',
    notes: 'Wait for PMS sync to drop outstanding; trace call if payment never lands.',
  },
  {
    when: 'APPROVED_PENDING_PAYMENT',
    route: 'WAIT_SYNC',
    claimStatus: 'APPROVED_PENDING_PAYMENT',
    queueStatus: 'COMPLETED',
    recall: '14d payment trace',
    gate: 'PAYMENT_VERIFY_SYNC',
    notes: 'No carrier dial — verify payment via PMS balance sync.',
  },
  {
    when: 'DENIED / not_covered + CDCP (Sun Life)',
    route: 'OPEN_CDCP',
    claimStatus: 'ESCALATED',
    queueStatus: 'ESCALATED',
    recall: 'CDCP follow-up after submit',
    gate: 'CDCP_RECONSIDERATION',
    notes: 'Open 60-day reconsideration case; stop generic carrier calls.',
  },
  {
    when: 'DENIED (private insurance)',
    route: 'STOP',
    claimStatus: 'DENIED',
    queueStatus: 'COMPLETED',
    recall: 'none',
    gate: 'none',
    notes: 'Terminal for automated carrier follow-up.',
  },
  {
    when: 'coverage_maxed',
    route: 'STOP',
    claimStatus: 'DENIED',
    queueStatus: 'COMPLETED',
    recall: 'none',
    gate: 'none',
    notes: 'Insurance chapter closed; balance may be patient responsibility.',
  },
  {
    when: 'resubmit_required',
    route: 'PRACTICE_GATE',
    claimStatus: 'ON_HOLD',
    queueStatus: 'ESCALATED',
    recall: '14d after gate cleared',
    gate: 'PRACTICE_RESUBMIT (blocking)',
    notes: 'Practice must resubmit in PMS before next carrier call.',
  },
  {
    when: 'xray_required / docs_required',
    route: 'PRACTICE_GATE',
    claimStatus: 'ON_HOLD',
    queueStatus: 'ESCALATED',
    recall: 'after gate cleared',
    gate: 'PRACTICE_DOCS (blocking)',
    notes: 'Practice must attach clinical documentation before re-call.',
  },
  {
    when: 'appeal_required (non-CDCP)',
    route: 'PRACTICE_GATE',
    claimStatus: 'ESCALATED',
    queueStatus: 'ESCALATED',
    recall: 'manual',
    gate: 'HUMAN_ESCALATION',
    notes: 'Human appeal path; no automated re-call until cleared.',
  },
  {
    when: 'processing / PENDING outcome',
    route: 'CALL_CARRIER',
    claimStatus: 'IN_QUEUE',
    queueStatus: 'PENDING',
    recall: '72h',
    gate: 'PROCESSING_RECALL',
    notes: 'Carrier SLA follow-up.',
  },
  {
    when: 'FAILED / NO_ANSWER / HUNG_UP',
    route: 'CALL_CARRIER',
    claimStatus: 'IN_QUEUE',
    queueStatus: 'PENDING',
    recall: '4–24h',
    gate: 'none',
    notes: 'Retry when scheduledFor elapses.',
  },
  {
    when: 'Financial outcome held (gate → ESCALATED)',
    route: 'PRACTICE_GATE',
    claimStatus: 'ESCALATED',
    queueStatus: 'ESCALATED',
    recall: 'manual',
    gate: 'HUMAN_ESCALATION',
    notes: 'Unconfirmed paid/denied — staff verifies transcript before acting.',
  },
  {
    when: 'outstanding = 0 on sync',
    route: 'STOP',
    claimStatus: 'RESOLVED',
    queueStatus: 'COMPLETED',
    recall: 'none',
    gate: 'cleared by PAYMENT_VERIFIED_SYNC',
    notes: 'PMS confirms payment — loop closed.',
  },
];

function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * HOUR_MS);
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

function shouldOpenCdcp(
  input: ClaimRouterInput,
  legacy: LegacyOutcomeCode,
): boolean {
  if (input.hasOpenCdcpCase) return true;
  if (input.carrierId !== 'sun_life') return false;
  if (legacy === 'not_covered' || legacy === 'appeal_required') return true;
  if (input.callOutcome === 'DENIED') return isCdcpCarrierContext(input.carrierId, input.outcomeDetail);
  if (input.callOutcome === 'ESCALATED') return true;
  return isCdcpCarrierContext(input.carrierId, input.outcomeDetail);
}

/**
 * Core router — maps call outcome + gates → recovery decision.
 */
export function routeClaimRecovery(input: ClaimRouterInput): RecoveryDecision {
  const now = input.now ?? new Date();
  const legacy = extractLegacyOutcomeCode(input.outcomeDetail);
  const detail = input.outcomeDetail ?? '';

  if (input.hasBlockingPracticeGate) {
    const supersedingGate =
      legacy === 'processing' ||
      input.gatedClaimStatus === 'RESOLVED' ||
      input.gatedClaimStatus === 'DENIED';
    if (!supersedingGate) {
      return {
        route: 'PRACTICE_GATE',
        claimStatus: 'ON_HOLD',
        queueStatus: 'ESCALATED',
        scheduledRecallAt: null,
        recoveryActionType: null,
        actionTitle: null,
        actionDetail: null,
        paymentExpectedBy: null,
        openCdcpCase: false,
        stopCalling: true,
        reason: 'Uncleared practice gate — staff must complete resubmit/docs before carrier re-call.',
      };
    }
  }

  if (input.callOutcome === 'BLOCK_DETECTED' || legacy === 'carrier_block') {
    return {
      route: 'STOP',
      claimStatus: 'BLOCKED',
      queueStatus: 'BLOCKED',
      scheduledRecallAt: null,
      recoveryActionType: null,
      actionTitle: null,
      actionDetail: null,
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Carrier block — suspend automated calls.',
    };
  }

  // Financial gate held outcome for human review
  if (
    input.gatedClaimStatus === 'ESCALATED' &&
    input.proposedClaimStatus !== 'ESCALATED' &&
    ['RESOLVED', 'DENIED', 'APPROVED_PENDING_PAYMENT'].includes(input.proposedClaimStatus)
  ) {
    return {
      route: 'PRACTICE_GATE',
      claimStatus: 'ESCALATED',
      queueStatus: 'ESCALATED',
      scheduledRecallAt: null,
      recoveryActionType: 'HUMAN_ESCALATION',
      actionTitle: 'Verify carrier outcome',
      actionDetail:
        `Carrier may have reported "${input.proposedClaimStatus}" but outcome lacks reference/structured confirmation. ` +
        'Review transcript and confirm before closing the claim.',
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Unconfirmed financial outcome — human verification required.',
    };
  }

  if (
    input.paymentCorroborated &&
    (input.gatedClaimStatus === 'RESOLVED' ||
      (input.gatedClaimStatus === 'APPROVED_PENDING_PAYMENT' && legacy === 'paid'))
  ) {
    const paymentExpectedBy = addDays(now, 14);
    return {
      route: 'WAIT_SYNC',
      claimStatus:
        input.gatedClaimStatus === 'APPROVED_PENDING_PAYMENT'
          ? 'APPROVED_PENDING_PAYMENT'
          : 'RESOLVED',
      queueStatus: 'COMPLETED',
      scheduledRecallAt: addHours(now, RECALL_HOURS.payment_trace),
      recoveryActionType: 'PAYMENT_VERIFY_SYNC',
      actionTitle: 'Await PMS payment confirmation',
      actionDetail:
        'Carrier confirmed payment. Next PMS sync should show a lower outstanding balance. ' +
        'If unchanged after 14 days, schedule a payment trace call.',
      paymentExpectedBy,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Payment corroborated — verify via sync before closing loop.',
    };
  }

  if (input.gatedClaimStatus === 'APPROVED_PENDING_PAYMENT') {
    const paymentExpectedBy = addDays(now, 14);
    return {
      route: 'WAIT_SYNC',
      claimStatus: 'APPROVED_PENDING_PAYMENT',
      queueStatus: 'COMPLETED',
      scheduledRecallAt: addHours(now, RECALL_HOURS.payment_trace),
      recoveryActionType: 'PAYMENT_VERIFY_SYNC',
      actionTitle: 'Approved — awaiting payment in PMS',
      actionDetail: 'Do not re-call carrier until sync shows payment or trace window expires.',
      paymentExpectedBy,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Approved pending payment — sync verification path.',
    };
  }

  if (legacy === 'coverage_maxed') {
    return {
      route: 'STOP',
      claimStatus: 'DENIED',
      queueStatus: 'COMPLETED',
      scheduledRecallAt: null,
      recoveryActionType: null,
      actionTitle: null,
      actionDetail: null,
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Benefits exhausted — insurance follow-up complete.',
    };
  }

  if (
    input.callOutcome === 'DENIED' ||
    legacy === 'not_covered' ||
    (input.gatedClaimStatus === 'DENIED' && input.callOutcome !== 'ESCALATED')
  ) {
    if (shouldOpenCdcp(input, legacy)) {
      return {
        route: 'OPEN_CDCP',
        claimStatus: 'ESCALATED',
        queueStatus: 'ESCALATED',
        scheduledRecallAt: null,
        recoveryActionType: 'CDCP_RECONSIDERATION',
        actionTitle: 'CDCP Level 1 reconsideration',
        actionDetail:
          'Open reconsideration case (60-day window). Gather Appendix C evidence and submit via CDAnet or paper.',
        paymentExpectedBy: null,
        openCdcpCase: true,
        stopCalling: true,
        reason: 'CDCP denial — reconsideration path replaces generic carrier calls.',
      };
    }
    return {
      route: 'STOP',
      claimStatus: 'DENIED',
      queueStatus: 'COMPLETED',
      scheduledRecallAt: null,
      recoveryActionType: null,
      actionTitle: null,
      actionDetail: null,
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Claim denied — automated carrier follow-up complete.',
    };
  }

  if (legacy === 'resubmit_required' || detail.toLowerCase().includes('resubmit')) {
    return {
      route: 'PRACTICE_GATE',
      claimStatus: 'ON_HOLD',
      queueStatus: 'ESCALATED',
      scheduledRecallAt: null,
      recoveryActionType: 'PRACTICE_RESUBMIT',
      actionTitle: 'Resubmit claim in PMS',
      actionDetail:
        'Carrier has no record of this claim. Resubmit from the practice PMS, then mark gate cleared to schedule follow-up call.',
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Blocking gate — resubmit required before next call.',
    };
  }

  if (legacy === 'xray_required' || legacy === 'docs_required') {
    const isXray = legacy === 'xray_required';
    return {
      route: 'PRACTICE_GATE',
      claimStatus: 'ON_HOLD',
      queueStatus: 'ESCALATED',
      scheduledRecallAt: null,
      recoveryActionType: 'PRACTICE_DOCS',
      actionTitle: isXray ? 'Attach radiographs' : 'Attach clinical documentation',
      actionDetail: isXray
        ? 'Carrier requires imaging. Attach in PMS and clear gate before re-call.'
        : 'Carrier requires clinical notes or supporting docs. Clear gate after submission.',
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Blocking gate — practice clinical action required.',
    };
  }

  if (legacy === 'appeal_required' || input.callOutcome === 'ESCALATED') {
    if (shouldOpenCdcp(input, legacy)) {
      return {
        route: 'OPEN_CDCP',
        claimStatus: 'ESCALATED',
        queueStatus: 'ESCALATED',
        scheduledRecallAt: null,
        recoveryActionType: 'CDCP_RECONSIDERATION',
        actionTitle: 'CDCP reconsideration / appeal',
        actionDetail: detail || 'Escalated denial — CDCP reconsideration workflow.',
        paymentExpectedBy: null,
        openCdcpCase: true,
        stopCalling: true,
        reason: 'CDCP appeal path.',
      };
    }
    return {
      route: 'PRACTICE_GATE',
      claimStatus: 'ESCALATED',
      queueStatus: 'ESCALATED',
      scheduledRecallAt: null,
      recoveryActionType: 'HUMAN_ESCALATION',
      actionTitle: 'Human escalation',
      actionDetail: detail || 'Claim requires staff review before next automated action.',
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'Escalated — human owns next step.',
    };
  }

  if (legacy === 'processing' || input.callOutcome === 'PENDING') {
    return {
      route: 'CALL_CARRIER',
      claimStatus: 'IN_QUEUE',
      queueStatus: 'PENDING',
      scheduledRecallAt: addHours(now, RECALL_HOURS.processing),
      recoveryActionType: 'PROCESSING_RECALL',
      actionTitle: 'Processing follow-up scheduled',
      actionDetail: `Re-call carrier in ${RECALL_HOURS.processing}h if still outstanding.`,
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: false,
      reason: 'Claim still processing — SLA re-call.',
    };
  }

  if (
    input.callOutcome === 'FAILED' ||
    input.callOutcome === 'NO_ANSWER' ||
    input.callOutcome === 'HUNG_UP'
  ) {
    const hours =
      input.callOutcome === 'NO_ANSWER' ? RECALL_HOURS.no_answer : RECALL_HOURS.failed;
    return {
      route: 'CALL_CARRIER',
      claimStatus: 'IN_QUEUE',
      queueStatus: 'PENDING',
      scheduledRecallAt: addHours(now, hours),
      recoveryActionType: null,
      actionTitle: null,
      actionDetail: null,
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: false,
      reason: `Connection retry in ${hours}h.`,
    };
  }

  if (input.gatedClaimStatus === 'RESOLVED' && input.outstandingCents <= 0) {
    return {
      route: 'STOP',
      claimStatus: 'RESOLVED',
      queueStatus: 'COMPLETED',
      scheduledRecallAt: null,
      recoveryActionType: null,
      actionTitle: null,
      actionDetail: null,
      paymentExpectedBy: null,
      openCdcpCase: false,
      stopCalling: true,
      reason: 'No outstanding balance — closed.',
    };
  }

  // Default: return to queue with modest retry
  return {
    route: 'CALL_CARRIER',
    claimStatus: input.gatedClaimStatus === 'CALLING' ? 'IN_QUEUE' : input.gatedClaimStatus,
    queueStatus: 'PENDING',
    scheduledRecallAt: addHours(now, RECALL_HOURS.failed),
    recoveryActionType: null,
    actionTitle: null,
    actionDetail: null,
    paymentExpectedBy: null,
    openCdcpCase: false,
    stopCalling: false,
    reason: 'Default re-queue with 24h retry.',
  };
}

/** Map recovery decision queue status when sync closes the loop. */
export function routeForSyncPaymentVerified(): Pick<
  RecoveryDecision,
  'route' | 'claimStatus' | 'queueStatus' | 'stopCalling' | 'reason'
> {
  return {
    route: 'STOP',
    claimStatus: 'RESOLVED',
    queueStatus: 'COMPLETED',
    stopCalling: true,
    reason: 'PMS sync verified outstanding balance dropped to zero.',
  };
}

/** When payment trace window expires without sync confirmation. */
export function routeForPaymentTraceRecall(now: Date = new Date()): RecoveryDecision {
  return {
    route: 'CALL_CARRIER',
    claimStatus: 'IN_QUEUE',
    queueStatus: 'PENDING',
    scheduledRecallAt: addHours(now, RECALL_HOURS.no_answer),
    recoveryActionType: 'PAYMENT_TRACE',
    actionTitle: 'Payment trace call',
    actionDetail:
      'Carrier previously confirmed payment but PMS balance unchanged. Call to trace check/EFT.',
    paymentExpectedBy: null,
    openCdcpCase: false,
    stopCalling: false,
    reason: 'Payment trace — sync did not confirm carrier payment.',
  };
}

export function mapOutcomeToQueueStatus(outcome: CallOutcome): QueueStatus {
  switch (outcome) {
    case 'RESOLVED':
      return 'COMPLETED';
    case 'DENIED':
      return 'COMPLETED';
    case 'ESCALATED':
      return 'ESCALATED';
    case 'BLOCK_DETECTED':
      return 'BLOCKED';
    default:
      return 'PENDING';
  }
}

export function mapOutcomeToClaimStatus(outcome: CallOutcome): ClaimStatus {
  switch (outcome) {
    case 'RESOLVED':
      return 'RESOLVED';
    case 'DENIED':
      return 'DENIED';
    case 'ESCALATED':
      return 'ESCALATED';
    case 'BLOCK_DETECTED':
      return 'BLOCKED';
    case 'FAILED':
    case 'NO_ANSWER':
    case 'HUNG_UP':
    case 'PENDING':
    default:
      return 'IN_QUEUE';
  }
}
