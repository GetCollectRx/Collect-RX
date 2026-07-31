import type {
  CallOutcome,
  ClaimStatus,
  QueueStatus,
  RecoveryActionType,
  RecoveryRoute,
} from '@prisma/client';

export interface ClaimRouterInput {
  callOutcome: CallOutcome;
  outcomeDetail: string | null;
  gatedClaimStatus: ClaimStatus;
  /** Raw classifier status before financial gate (for payment-trace logic). */
  proposedClaimStatus: ClaimStatus;
  outstandingCents: number;
  carrierId: string;
  daysOutstanding: number;
  attemptCount: number;
  hasBlockingPracticeGate: boolean;
  hasOpenCdcpCase: boolean;
  paymentCorroborated: boolean;
  /**
   * True when any attempt on this claim captured engagement evidence — a
   * reference number or a rep name. Without it, repeat identical retries are
   * the lowest-yield spend in the system and the ladder escalates instead.
   */
  hasEngagementEvidence?: boolean;
  /**
   * Rolling per-carrier rate of held-then-dumped calls (holdLedger.ts), or
   * null when the sample is too small to be meaningful.
   */
  carrierHoldDumpRate?: number | null;
  now?: Date;
}

export interface RecoveryDecision {
  route: RecoveryRoute;
  claimStatus: ClaimStatus;
  queueStatus: QueueStatus;
  scheduledRecallAt: Date | null;
  recoveryActionType: RecoveryActionType | null;
  actionTitle: string | null;
  actionDetail: string | null;
  paymentExpectedBy: Date | null;
  openCdcpCase: boolean;
  stopCalling: boolean;
  /** Human-readable routing reason (for events + API docs). */
  reason: string;
}

export interface ClaimRouterDecisionRow {
  when: string;
  route: RecoveryRoute;
  claimStatus: ClaimStatus;
  queueStatus: QueueStatus;
  recall: string;
  gate: string;
  notes: string;
}

export type LegacyOutcomeCode =
  | 'paid'
  | 'processing'
  | 'resubmit_required'
  | 'xray_required'
  | 'docs_required'
  | 'coverage_maxed'
  | 'not_covered'
  | 'appeal_required'
  | 'no_answer'
  | 'carrier_block'
  | null;
