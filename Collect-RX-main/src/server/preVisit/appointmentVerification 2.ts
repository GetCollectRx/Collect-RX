/**
 * Pre-appointment verification — runs the carrier dispatch guards, CDCP
 * predetermination check, and eligibility-snapshot staleness check before a
 * scheduled appointment, so front desk staff see a GREEN/YELLOW/RED signal
 * ahead of the visit rather than discovering a problem at claim time.
 */
import type { CarrierId, PrismaClient } from '@prisma/client';
import {
  checkCarrierAuthorizationGate,
  checkCarrierBlock,
  isWithinCallWindow,
} from '../../carriers/adapter.js';
import { normalizeCdtCode, reconsiderationExclusionReason } from '../canadianExpansion/constants.js';
import { enrichCase } from '../canadianExpansion/reconsideration.js';
import { isCdcpCarrier, requiresCdcpPredetermination } from './procedureRules.js';
import { enqueuePreVisitJob, type PreVisitJobPayload } from './preVisitJobs.js';
import {
  validatePredetSubmission,
  type PredetArtifact,
} from './predetSubmissionRules.js';
import {
  tryCanadaLifePortalPreVisit,
  tryTelusTx23PreVisit,
} from './electronicPreVisit.js';
import { enqueueEmrPreVisitEvent } from '../emrSyncOutbox.js';

export interface PreVisitParams {
  practiceId: string;
  /** PIIVault UUID — never raw PHI. See src/pii-vault.ts. */
  patientToken: string;
  carrierId: CarrierId;
  procedureCodes: string[];
  appointmentAt: Date;
  artifactAttestations?: Partial<Record<PredetArtifact, boolean>>;
  scheduledAppointmentId?: string;
}

export interface VerificationResult {
  status: 'GREEN' | 'YELLOW' | 'RED';
  reason?: string;
  cdcpDeadlineDaysRemaining?: number;
  cdcpWindowExpired?: boolean;
  eligibilitySnapshotAge?: number | null;
  enqueuedJobId?: string;
  portalCheckRequired?: boolean;
  tx23CheckRequired?: boolean;
  portalResolved?: boolean;
  tx23Resolved?: boolean;
  missingArtifacts?: string[];
}

const SNAPSHOT_STALE_AFTER_DAYS = 30;
const CDCP_DEADLINE_WARNING_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Build stored-value variants so Prisma can match normalized and legacy CDT formats. */
function procedureCodeQueryVariants(codes: string[]): string[] {
  const variants = new Set<string>();
  for (const code of codes) {
    const normalized = normalizeCdtCode(code);
    const digits = normalized.replace(/^D/, '');
    variants.add(normalized);
    variants.add(digits);
    variants.add(code.trim().toUpperCase());
  }
  return [...variants];
}

/** Delay (ms) from `from` until the next moment `isWithinCallWindow` is true. */
function delayUntilNextCallWindow(from: Date): number {
  const candidate = new Date(from);
  candidate.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    candidate.setUTCHours(candidate.getUTCHours() + 1);
    if (isWithinCallWindow(candidate)) {
      return Math.max(0, candidate.getTime() - from.getTime());
    }
  }
  return 0;
}

export async function verifyBeforeAppointment(
  prisma: PrismaClient,
  params: PreVisitParams,
): Promise<VerificationResult> {
  const {
    practiceId,
    patientToken,
    carrierId,
    procedureCodes,
    appointmentAt,
    artifactAttestations,
    scheduledAppointmentId,
  } = params;

  const row = await prisma.appointmentVerification.create({
    data: {
      practiceId,
      patientToken,
      carrierId,
      procedureCodes,
      appointmentAt,
      status: 'GREEN',
      missingArtifacts: [],
      scheduledAppointmentId: scheduledAppointmentId ?? null,
    },
  });

  try {
    const result: VerificationResult = { status: 'GREEN' };

    const blockGuard = await checkCarrierBlock(prisma, practiceId, carrierId);
    if (!blockGuard.allowed) {
      return finalize(prisma, row.id, { status: 'RED', reason: 'carrier_blocked' });
    }

    const authGate = await checkCarrierAuthorizationGate(prisma, practiceId, carrierId);
    if (!authGate.allowed) {
      return finalize(prisma, row.id, {
        status: 'RED',
        reason: `not_authorized: ${authGate.reason ?? 'unknown'}`,
      });
    }

    const submission = validatePredetSubmission({
      carrierId,
      procedureCodes,
      artifactAttestations,
    });
    if (!submission.passed) {
      result.status = 'YELLOW';
      result.reason = `missing_documentation: ${submission.missingArtifacts.join(',')}`;
      result.missingArtifacts = submission.missingArtifacts;
      await prisma.appointmentVerification.update({
        where: { id: row.id },
        data: { missingArtifacts: submission.missingArtifacts },
      });
    }

    if (carrierId === 'canada_life') {
      const portal = await tryCanadaLifePortalPreVisit(prisma, {
        practiceId,
        patientToken,
        carrierId,
        procedureCodes,
        appointmentVerificationId: row.id,
      });
      if (portal.resolved) {
        result.portalResolved = true;
        result.status = 'GREEN';
        result.reason = 'portal_resolved';
        await prisma.appointmentVerification.update({
          where: { id: row.id },
          data: { portalResolved: true },
        });
        return finalize(prisma, row.id, result);
      }
      result.portalCheckRequired = true;
    }

    if (carrierId === 'telus_adjudicare') {
      const tx23 = await tryTelusTx23PreVisit(prisma, {
        practiceId,
        patientToken,
        carrierId,
        procedureCodes,
        appointmentVerificationId: row.id,
      });
      if (tx23.resolved) {
        result.tx23Resolved = true;
        result.status = 'GREEN';
        result.reason = 'tx23_resolved';
        await prisma.appointmentVerification.update({
          where: { id: row.id },
          data: { tx23Resolved: true },
        });
        return finalize(prisma, row.id, result);
      }
      result.tx23CheckRequired = true;
    }

    const withinWindow = isWithinCallWindow(appointmentAt);
    const delayMs = withinWindow ? undefined : delayUntilNextCallWindow(appointmentAt);

    const snapshot = await prisma.eligibilitySnapshot.findFirst({
      where: {
        practiceId,
        carrier: carrierId,
        OR: [{ patientToken }, { patientId: patientToken }],
      },
      orderBy: { verifiedAt: 'desc' },
    });

    if (!snapshot) {
      result.eligibilitySnapshotAge = null;
      if (result.status !== 'YELLOW' || !result.reason?.startsWith('missing_documentation')) {
        result.enqueuedJobId = await enqueuePreVisitJob(
          'PRE_VISIT_ELIGIBILITY',
          buildPayload(params, row.id),
          delayMs,
        );
      }
    } else {
      const ageDays = Math.floor((Date.now() - snapshot.verifiedAt.getTime()) / MS_PER_DAY);
      result.eligibilitySnapshotAge = ageDays;
      if (ageDays > SNAPSHOT_STALE_AFTER_DAYS) {
        result.enqueuedJobId = await enqueuePreVisitJob(
          'PRE_VISIT_ELIGIBILITY',
          buildPayload(params, row.id),
          delayMs,
        );
      }
    }

    const qualifyingCodes = procedureCodes.filter(requiresCdcpPredetermination);
    if (isCdcpCarrier(carrierId) && qualifyingCodes.length > 0) {
      const nonExcludedCodes = qualifyingCodes.filter((code) => !reconsiderationExclusionReason(code));

      if (nonExcludedCodes.length > 0) {
        const codeVariants = procedureCodeQueryVariants(nonExcludedCodes);
        const cdcpCase = await prisma.cdcpReconsiderationCase.findFirst({
          where: {
            practiceId,
            patientToken,
            procedureCode: { in: codeVariants },
          },
          orderBy: { denialDate: 'desc' },
        });

        if (cdcpCase) {
          const enriched = enrichCase(cdcpCase);
          const isApproved = enriched.status === 'approved';

          if (enriched.windowExpired && !isApproved) {
            return finalize(prisma, row.id, {
              ...result,
              status: 'RED',
              reason: 'cdcp_window_expired',
            });
          }

          if (!isApproved && enriched.daysRemaining <= CDCP_DEADLINE_WARNING_DAYS) {
            result.status = 'YELLOW';
            result.reason = 'cdcp_reconsideration_expiring';
            result.cdcpDeadlineDaysRemaining = enriched.daysRemaining;
            result.cdcpWindowExpired = false;
          }
        } else if (submission.passed) {
          result.enqueuedJobId = await enqueuePreVisitJob(
            'PRE_VISIT_CDCP_PREDET',
            buildPayload(params, row.id, true),
            delayMs,
          );
        }
      }
    }

    if (!withinWindow && result.status === 'GREEN') {
      result.status = 'YELLOW';
      result.reason = 'outside_call_window';
    }

    return finalize(prisma, row.id, result);
  } catch (err) {
    try {
      await finalize(prisma, row.id, { status: 'RED', reason: 'verification_error' });
    } catch {
      /* prefer original error */
    }
    throw err;
  }
}

function buildPayload(
  params: PreVisitParams,
  appointmentVerificationId: string,
  cdcpContext?: boolean,
): PreVisitJobPayload {
  return {
    practiceId: params.practiceId,
    patientToken: params.patientToken,
    carrierId: params.carrierId,
    procedureCodes: params.procedureCodes,
    appointmentAt: params.appointmentAt.toISOString(),
    appointmentVerificationId,
    ...(cdcpContext ? { cdcpContext: true } : {}),
  };
}

async function finalize(
  prisma: PrismaClient,
  appointmentVerificationId: string,
  result: VerificationResult,
): Promise<VerificationResult> {
  await prisma.appointmentVerification.update({
    where: { id: appointmentVerificationId },
    data: {
      status: result.status,
      reason: result.reason ?? null,
      cdcpDaysRemaining: result.cdcpDeadlineDaysRemaining ?? null,
      enqueuedJobId: result.enqueuedJobId ?? null,
      missingArtifacts: result.missingArtifacts ?? [],
      portalResolved: result.portalResolved ?? false,
      tx23Resolved: result.tx23Resolved ?? false,
    },
  });

  const row = await prisma.appointmentVerification.findUnique({
    where: { id: appointmentVerificationId },
  });
  if (row) {
    await enqueueEmrPreVisitEvent(prisma, {
      practiceId: row.practiceId,
      appointmentVerificationId,
      eventType: 'PRE_VISIT_VERIFICATION_SIGNAL',
      payload: {
        status: result.status,
        reason: result.reason ?? null,
        procedureCodes: row.procedureCodes,
        appointmentAt: row.appointmentAt.toISOString(),
        patientToken: row.patientToken,
      },
    });
  }

  return result;
}
