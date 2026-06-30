/**
 * Process VAPI call.ended webhooks for pre-visit verification calls.
 */
import type { PrismaClient } from '@prisma/client';
import type { VapiWebhookPayload } from '../../vapi/client.js';
import { enrichCase, reconsiderationExpiresAt } from '../canadianExpansion/reconsideration.js';
import { upsertReconsiderationFromSignal, detectDenialFromEndOfCall } from '../canadianExpansion/autoReconsideration.js';
import { writeAdjudicationEvent } from '../adjudication/writeAdjudicationEvent.js';
import { enqueueEmrPreVisitEvent } from '../emrSyncOutbox.js';
import { scrubTranscriptPhi } from '../vapi/vapiWebhook.js';
import { enqueuePreVisitJob } from './preVisitJobs.js';
import { isCdcpCarrier, requiresCdcpPredetermination } from './procedureRules.js';
import { parsePreVisitStructuredData } from './preVisitStructuredOutput.js';

const PRE_VISIT_RECALL_DELAY_MS = 4 * 60 * 60 * 1000;

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export async function processPreVisitCallEnded(
  payload: VapiWebhookPayload,
  prisma: PrismaClient,
): Promise<boolean> {
  const meta = payload.metadata;
  const verificationId = meta?.appointmentVerificationId;
  if (!verificationId) return false;

  const verification = await prisma.appointmentVerification.findUnique({
    where: { id: verificationId },
  });
  if (!verification) {
    console.warn(`[preVisitWebhook] verification not found: ${verificationId}`);
    return true;
  }

  if (payload.transcript) {
    payload.transcript = scrubTranscriptPhi(payload.transcript);
  }

  const sd = (payload as { analysis?: { structuredData?: Record<string, unknown> } }).analysis
    ?.structuredData ?? {};
  const collectrx = payload.analysis?.collectrx ?? meta?.collectrx;

  const parsed = parsePreVisitStructuredData(sd);
  if (!parsed.valid && Object.keys(sd).length > 0) {
    console.warn('[preVisitWebhook] structured output parse warnings:', parsed.parseWarnings);
  }

  const eligibilityStatus = parsed.eligibilityStatus;
  const predetStatus = parsed.predetStatus;
  const denialCode = parsed.denialCode;
  const denialText = parsed.denialText ?? asString(collectrx?.outcomeDetail);

  const durationMs = payload.call.durationSeconds
    ? payload.call.durationSeconds * 1000
    : null;

  const callFailed = payload.call.status === 'failed' || payload.type === 'call.failed';
  let status: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
  let reason: string | undefined;

  if (callFailed) {
    status = verification.attemptCount >= 3 ? 'RED' : 'YELLOW';
    reason = verification.attemptCount >= 3 ? 'carrier_unreachable' : 'call_failed_retry';
  } else if (predetStatus?.toLowerCase() === 'denied') {
    status = 'RED';
    reason = 'cdcp_predet_denied';
  } else if (predetStatus?.toLowerCase() === 'pending') {
    status = 'YELLOW';
    reason = 'cdcp_predet_pending';
  } else if (eligibilityStatus?.toLowerCase() === 'ineligible') {
    status = 'RED';
    reason = 'ineligible';
  } else if (predetStatus?.toLowerCase() === 'approved') {
    status = 'GREEN';
    reason = 'cdcp_predet_approved';
  }

  let cdcpDaysRemaining: number | null = null;
  let cdcpCaseId: string | null = null;

  if (meta?.cdcpContext || meta?.preVisitType === 'cdcp_predet') {
    const denialSignal = detectDenialFromEndOfCall({
      type: 'end-of-call-report',
      call: { id: payload.call.id, metadata: meta as unknown as Record<string, unknown> },
      analysis: { structuredData: sd },
    });
    if (denialSignal) {
      const upserted = await upsertReconsiderationFromSignal(prisma, denialSignal);
      cdcpCaseId = upserted.id;
      const caseRow = await prisma.cdcpReconsiderationCase.findUnique({ where: { id: upserted.id } });
      if (caseRow) {
        const enriched = enrichCase(caseRow);
        cdcpDaysRemaining = enriched.daysRemaining;
        if (enriched.windowExpired) {
          status = 'RED';
          reason = 'cdcp_window_expired';
        } else if (enriched.daysRemaining <= 14 && status !== 'RED') {
          status = 'YELLOW';
          reason = 'cdcp_reconsideration_expiring';
        }
      }
    }
  }

  if (
    meta?.preVisitType === 'eligibility' ||
    (!meta?.cdcpContext && eligibilityStatus)
  ) {
    const elig = eligibilityStatus?.toLowerCase();
    const snapStatus =
      elig === 'eligible' ? 'active' : elig === 'ineligible' ? 'inactive' : 'unknown';
    await prisma.eligibilitySnapshot.create({
      data: {
        practiceId: verification.practiceId,
        patientId: verification.patientToken,
        patientToken: verification.patientToken,
        carrier: verification.carrierId,
        status: snapStatus as 'active' | 'inactive' | 'unknown',
        verifiedAt: new Date(),
        planYearStart: new Date(new Date().getUTCFullYear(), 0, 1),
        rawCarrierResponse: sd as object,
      },
    });
  }

  await prisma.appointmentVerification.update({
    where: { id: verificationId },
    data: {
      status,
      reason: reason ?? null,
      cdcpDaysRemaining,
      vapiCallId: payload.call.id,
    },
  });

  const reconDeadline =
    denialCode && cdcpCaseId
      ? reconsiderationExpiresAt(new Date())
      : null;

  await writeAdjudicationEvent(prisma, {
    practiceId: verification.practiceId,
    patientToken: verification.patientToken,
    carrierId: verification.carrierId,
    procedureCodes: verification.procedureCodes,
    callType: meta?.cdcpContext ? 'pre_visit_cdcp' : 'pre_visit_eligibility',
    outcome: callFailed ? 'failed' : 'success',
    eligibilityStatus,
    predeterminationStatus: predetStatus,
    denialReasonCode: denialCode,
    denialReasonText: denialText,
    reconsiderationDeadline: reconDeadline,
    supportingDocsPresent: verification.missingArtifacts.length === 0,
    callDurationMs: durationMs,
    vapiCallId: payload.call.id,
    appointmentVerificationId: verificationId,
    cdcpCaseId,
  });

  await enqueueEmrPreVisitEvent(prisma, {
    practiceId: verification.practiceId,
    appointmentVerificationId: verificationId,
    eventType: 'PRE_VISIT_VERIFICATION_COMPLETE',
    payload: {
      status,
      reason: reason ?? null,
      procedureCodes: verification.procedureCodes,
      appointmentAt: verification.appointmentAt.toISOString(),
      patientToken: verification.patientToken,
    },
  });

  if (callFailed && reason === 'call_failed_retry') {
    const cdcpContext =
      meta?.cdcpContext === true ||
      meta?.preVisitType === 'cdcp_predet' ||
      (isCdcpCarrier(verification.carrierId) &&
        verification.procedureCodes.some(requiresCdcpPredetermination));
    const jobType = cdcpContext ? 'PRE_VISIT_CDCP_PREDET' : 'PRE_VISIT_ELIGIBILITY';
    try {
      await enqueuePreVisitJob(
        jobType,
        {
          practiceId: verification.practiceId,
          patientToken: verification.patientToken,
          carrierId: verification.carrierId,
          procedureCodes: verification.procedureCodes,
          appointmentAt: verification.appointmentAt.toISOString(),
          appointmentVerificationId: verificationId,
          ...(cdcpContext ? { cdcpContext: true } : {}),
        },
        PRE_VISIT_RECALL_DELAY_MS,
      );
    } catch (enqueueErr) {
      console.error('[preVisitWebhook] failed to enqueue recall job:', enqueueErr);
    }
  }

  return true;
}
