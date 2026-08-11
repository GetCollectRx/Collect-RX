/**
 * VAPI dispatch for pre-visit eligibility and CDCP predetermination status calls.
 */
import type { PrismaClient } from '@prisma/client';
import {
  checkCarrierAuthorizationGate,
  checkCarrierBlock,
  CARRIER_CONFIGS,
  isWithinCallWindow,
  nextCallWindowStart,
} from '../../carriers/adapter.js';
import { initiatePreVisitCall } from '../../vapi/client.js';
import { piiVault } from '../../pii-vault.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import { canMakeCall } from '../plans/planBridge.js';
import type { PreVisitJobPayload } from './preVisitJobs.js';
import { writeAdjudicationEvent } from '../adjudication/writeAdjudicationEvent.js';
import { tryTelusTx23PreVisit } from './electronicPreVisit.js';
import { appendPhiAccessEvent } from '../audit/auditLog.js';
import { logger } from '../observability/logger.js';

const MAX_PRE_VISIT_ATTEMPTS = 3;

export type PreVisitDispatchResult =
  | { vapiCallId: string }
  | { skipped: true; reason: string }
  | { deferred: true; reason: 'outside_call_window'; retryAt: Date };

export async function dispatchPreVisitCall(
  prisma: PrismaClient,
  jobType: 'PRE_VISIT_ELIGIBILITY' | 'PRE_VISIT_CDCP_PREDET',
  payload: PreVisitJobPayload,
): Promise<PreVisitDispatchResult> {
  const verification = await prisma.appointmentVerification.findUnique({
    where: { id: payload.appointmentVerificationId },
  });
  if (!verification) {
    return { skipped: true, reason: 'verification_not_found' };
  }
  if (verification.attemptCount >= MAX_PRE_VISIT_ATTEMPTS) {
    await prisma.appointmentVerification.update({
      where: { id: verification.id },
      data: { status: 'RED', reason: 'carrier_unreachable' },
    });
    return { skipped: true, reason: 'max_attempts' };
  }

  const block = await checkCarrierBlock(prisma, payload.practiceId, payload.carrierId);
  if (!block.allowed) {
    return { skipped: true, reason: 'carrier_blocked' };
  }

  const auth = await checkCarrierAuthorizationGate(prisma, payload.practiceId, payload.carrierId);
  if (!auth.allowed) {
    return { skipped: true, reason: auth.reason ?? 'not_authorized' };
  }

  const planGate = await canMakeCall(payload.practiceId);
  if (!planGate.allowed) {
    return { skipped: true, reason: planGate.reason ?? 'plan_gate' };
  }

  if (!isWithinCallWindow()) {
    return {
      deferred: true,
      reason: 'outside_call_window',
      retryAt: nextCallWindowStart(),
    };
  }

  const phiResult = piiVault.detokenize(payload.patientToken, 'pre-visit-dispatch', {
    practiceId: payload.practiceId,
  });
  if (!phiResult.success || !phiResult.phi) {
    logger.error('[preVisitDispatch] detokenize failed', { error: phiResult.error ?? 'unknown' });
    return { skipped: true, reason: 'detokenize_failed' };
  }
  const phi = phiResult.phi;
  await appendPhiAccessEvent(prisma, {
    practiceId: payload.practiceId,
    operation: 'detokenize_for_carrier_call',
    recordType: 'AppointmentVerification',
    recordId: verification.id,
    purpose: 'pre_visit_dispatch',
  });

  const settings = await getPracticeSettings(prisma, payload.practiceId);
  const practice = await prisma.practice.findUnique({
    where: { id: payload.practiceId },
    select: { name: true },
  });
  const carrierCfg = settings.carrierConfigs.find((c) => c.carrierId === payload.carrierId);
  const carrierMeta = CARRIER_CONFIGS[payload.carrierId];

  const cdcpContext = jobType === 'PRE_VISIT_CDCP_PREDET' || payload.cdcpContext === true;

  const result = await initiatePreVisitCall({
    practiceId: payload.practiceId,
    patientToken: payload.patientToken,
    carrierId: payload.carrierId,
    appointmentVerificationId: payload.appointmentVerificationId,
    preVisitType: cdcpContext ? 'cdcp_predet' : 'eligibility',
    cdcpContext,
    patientName: phi.patientName,
    patientDob: phi.dateOfBirth,
    policyNumber: phi.subscriberId,
    subscriberName: phi.subscriberName,
    subscriberDob: phi.subscriberDateOfBirth,
    procedureCodes: payload.procedureCodes,
    appointmentAt: payload.appointmentAt,
    practiceName: practice?.name ?? 'Dental Practice',
    providerNumber: carrierCfg?.providerNumber ?? '',
    practicePhone: settings.billingPhone ?? settings.escalationPhoneNumber ?? '',
    languagePreference: carrierCfg?.languagePreference ?? 'en',
    carrierIvrInstructions: carrierMeta?.ivrHints?.join('\n') ?? '',
  });

  await prisma.appointmentVerification.update({
    where: { id: verification.id },
    data: {
      vapiCallId: result.vapiCallId,
      attemptCount: { increment: 1 },
    },
  });

  await writeAdjudicationEvent(prisma, {
    practiceId: payload.practiceId,
    patientToken: payload.patientToken,
    carrierId: payload.carrierId,
    procedureCodes: payload.procedureCodes,
    callType: cdcpContext ? 'pre_visit_cdcp' : 'pre_visit_eligibility',
    outcome: 'dispatched',
    vapiCallId: result.vapiCallId,
    appointmentVerificationId: payload.appointmentVerificationId,
  });

  return { vapiCallId: result.vapiCallId };
}

/**
 * Runs the deferred TELUS Tx23 electronic inquiry (PRE_VISIT_TELUS_TX23 job).
 * `verifyBeforeAppointment` only flags `tx23CheckRequired`; the live CDAnet
 * submission happens here, off the request path.
 */
export async function dispatchTelusTx23Check(
  prisma: PrismaClient,
  payload: PreVisitJobPayload,
): Promise<{ resolved: boolean; reason?: string }> {
  const verification = await prisma.appointmentVerification.findUnique({
    where: { id: payload.appointmentVerificationId },
  });
  if (!verification) {
    return { resolved: false, reason: 'verification_not_found' };
  }

  const tx23 = await tryTelusTx23PreVisit(prisma, {
    practiceId: payload.practiceId,
    patientToken: payload.patientToken,
    carrierId: payload.carrierId,
    procedureCodes: payload.procedureCodes,
    appointmentVerificationId: payload.appointmentVerificationId,
  });

  if (tx23.resolved) {
    await prisma.appointmentVerification.update({
      where: { id: verification.id },
      data: { status: 'GREEN', reason: 'tx23_resolved', tx23Resolved: true },
    });
  }

  return { resolved: tx23.resolved, reason: tx23.reason };
}
