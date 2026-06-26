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
import { reconsiderationExclusionReason } from '../canadianExpansion/constants.js';
import { enrichCase } from '../canadianExpansion/reconsideration.js';
import { isCdcpCarrier, requiresCdcpPredetermination } from './procedureRules.js';
import { enqueuePreVisitJob, type PreVisitJobPayload } from './preVisitJobs.js';

export interface PreVisitParams {
  practiceId: string;
  /** PIIVault UUID — never raw PHI. See src/pii-vault.ts. */
  patientToken: string;
  carrierId: CarrierId;
  procedureCodes: string[];
  appointmentAt: Date;
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
}

const SNAPSHOT_STALE_AFTER_DAYS = 30;
const CDCP_DEADLINE_WARNING_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  const { practiceId, patientToken, carrierId, procedureCodes, appointmentAt } = params;

  // Create the row up front so its id is available as the FK in any job
  // payload enqueued below; finalize() updates it with the computed result.
  const row = await prisma.appointmentVerification.create({
    data: {
      practiceId,
      patientToken,
      carrierId,
      procedureCodes,
      appointmentAt,
      status: 'GREEN',
    },
  });

  const result: VerificationResult = { status: 'GREEN' };

  // 1a. CARRIER_BLOCK — highest priority, must be checked before any dispatch.
  const blockGuard = await checkCarrierBlock(prisma, practiceId, carrierId);
  if (!blockGuard.allowed) {
    return finalize(prisma, row.id, { status: 'RED', reason: 'carrier_blocked' });
  }

  // 1b. Practice authorization gate (voice agent enabled, BAAL on file, provider number set).
  const authGate = await checkCarrierAuthorizationGate(prisma, practiceId, carrierId);
  if (!authGate.allowed) {
    return finalize(prisma, row.id, {
      status: 'RED',
      reason: `not_authorized: ${authGate.reason ?? 'unknown'}`,
    });
  }

  // 1c. Canada Life is portal-first — flag for the caller, do not execute the portal check here.
  if (carrierId === 'canada_life') {
    result.portalCheckRequired = true;
  }

  // TELUS Transaction 23 is also flagged for the caller (TPA identification happens upstream).
  if (carrierId === 'telus_adjudicare') {
    result.tx23CheckRequired = true;
  }

  // Business-hours check is evaluated up front (not blocking) so any jobs enqueued
  // below can be delayed to the next call window in the same pass.
  const withinWindow = isWithinCallWindow(appointmentAt);
  const delayMs = withinWindow ? undefined : delayUntilNextCallWindow(appointmentAt);

  // 2. Eligibility snapshot staleness.
  //
  // KNOWN GAP: EligibilitySnapshot.patientId is an arbitrary PMS record id from the
  // Phase 3 eligibility layer — it is NOT the patientToken (PIIVault UUID). There is
  // no bridge between the two identifier spaces. We query by practiceId + carrier
  // only and take the most recent row as a proxy, which means this can pick up a
  // different patient's snapshot. Acceptable as a staleness signal only; do not use
  // this for patient-specific eligibility data until the identifiers are bridged.
  const snapshot = await prisma.eligibilitySnapshot.findFirst({
    where: { practiceId, carrier: carrierId },
    orderBy: { verifiedAt: 'desc' },
  });

  if (!snapshot) {
    result.eligibilitySnapshotAge = null;
    result.enqueuedJobId = await enqueuePreVisitJob(
      'PRE_VISIT_ELIGIBILITY',
      buildPayload(params, row.id),
      delayMs,
    );
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

  // 3. CDCP predetermination — only relevant for the CDCP carrier (Sun Life).
  const qualifyingCodes = procedureCodes.filter(requiresCdcpPredetermination);
  if (isCdcpCarrier(carrierId) && qualifyingCodes.length > 0) {
    const nonExcludedCodes = qualifyingCodes.filter((code) => !reconsiderationExclusionReason(code));

    if (nonExcludedCodes.length > 0) {
      const cdcpCase = await prisma.cdcpReconsiderationCase.findFirst({
        where: { practiceId, patientToken },
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
      } else {
        result.enqueuedJobId = await enqueuePreVisitJob(
          'PRE_VISIT_CDCP_PREDET',
          buildPayload(params, row.id, true),
          delayMs,
        );
      }
    }
  }

  // 4. Business hours — non-blocking; only set as the reason if nothing more
  // specific (e.g. CDCP deadline) already flagged this as YELLOW.
  if (!withinWindow && result.status === 'GREEN') {
    result.status = 'YELLOW';
    result.reason = 'outside_call_window';
  }

  return finalize(prisma, row.id, result);
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
    },
  });
  return result;
}
