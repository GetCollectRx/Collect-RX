import type { CarrierId, PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger.js';

export type AdjudicationCallType =
  | 'claim_recovery'
  | 'pre_visit_eligibility'
  | 'pre_visit_cdcp'
  | 'cdcp_reconsideration'
  | 'portal_check'
  | 'tx23_check';

export interface AdjudicationEventInput {
  practiceId: string;
  patientToken: string;
  carrierId: CarrierId;
  procedureCodes: string[];
  callType: AdjudicationCallType;
  outcome: string;
  eligibilityStatus?: string | null;
  predeterminationStatus?: string | null;
  denialReasonCode?: string | null;
  denialReasonText?: string | null;
  reconsiderationDeadline?: Date | null;
  supportingDocsPresent?: boolean | null;
  callDurationMs?: number | null;
  vapiCallId?: string | null;
  appointmentVerificationId?: string | null;
  claimId?: string | null;
  cdcpCaseId?: string | null;
}

/** Never throws — adjudication logging must not block verification or recovery flows. */
export async function writeAdjudicationEvent(
  prisma: PrismaClient,
  input: AdjudicationEventInput,
): Promise<string | null> {
  try {
    const row = await prisma.adjudicationEvent.create({
      data: {
        practiceId: input.practiceId,
        patientToken: input.patientToken,
        carrierId: input.carrierId,
        procedureCodes: input.procedureCodes,
        callType: input.callType,
        outcome: input.outcome,
        eligibilityStatus: input.eligibilityStatus ?? null,
        predeterminationStatus: input.predeterminationStatus ?? null,
        denialReasonCode: input.denialReasonCode ?? null,
        denialReasonText: input.denialReasonText ?? null,
        reconsiderationDeadline: input.reconsiderationDeadline ?? null,
        supportingDocsPresent: input.supportingDocsPresent ?? null,
        callDurationMs: input.callDurationMs ?? null,
        vapiCallId: input.vapiCallId ?? null,
        appointmentVerificationId: input.appointmentVerificationId ?? null,
        claimId: input.claimId ?? null,
        cdcpCaseId: input.cdcpCaseId ?? null,
      },
    });
    return row.id;
  } catch (err) {
    logger.error('[adjudication] writeAdjudicationEvent failed (non-fatal)', { error: err });
    return null;
  }
}
