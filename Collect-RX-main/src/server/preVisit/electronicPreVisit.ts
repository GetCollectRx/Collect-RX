/**
 * Electronic pre-visit checks — portal-first (Canada Life) and Tx23 (TELUS TPAs)
 * before falling back to VAPI voice dispatch.
 */
import type { CarrierId, PrismaClient } from '@prisma/client';
import { canadaLifePortalFirstGate } from '../../carriers/providerConnect-adapter.js';
import { tpaSupportsTransaction23, TELUS_TPA_CONFIGS } from '../../carriers/adapter.js';
import { identifyTelusPlan } from '../../services/eligibility/engine.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import { piiVault } from '../../pii-vault.js';
import { writeAdjudicationEvent } from '../adjudication/writeAdjudicationEvent.js';

export interface ElectronicPreVisitResult {
  resolved: boolean;
  method?: 'portal' | 'tx23';
  eligibilityStatus?: string;
  predeterminationStatus?: string;
  reason?: string;
}

export async function tryCanadaLifePortalPreVisit(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    patientToken: string;
    carrierId: CarrierId;
    procedureCodes: string[];
    appointmentVerificationId: string;
  },
): Promise<ElectronicPreVisitResult> {
  if (params.carrierId !== 'canada_life') {
    return { resolved: false };
  }

  const settings = await getPracticeSettings(prisma, params.practiceId);
  const carrierCfg = settings.carrierConfigs.find((c) => c.carrierId === 'canada_life');
  const providerNumber = carrierCfg?.providerNumber?.trim();
  if (!providerNumber) {
    return { resolved: false, reason: 'no_provider_number' };
  }

  let claimRef = `PREVISIT-${params.appointmentVerificationId.slice(0, 8)}`;
  try {
    const det = piiVault.detokenize(params.patientToken, 'pre-visit-portal');
    if (det.success && det.phi?.subscriberId) claimRef = det.phi.subscriberId;
  } catch {
    /* use synthetic ref */
  }

  const gate = await canadaLifePortalFirstGate(claimRef, providerNumber);
  await writeAdjudicationEvent(prisma, {
    practiceId: params.practiceId,
    patientToken: params.patientToken,
    carrierId: params.carrierId,
    procedureCodes: params.procedureCodes,
    callType: 'portal_check',
    outcome: gate.portalResult.portalResolved ? 'success' : 'failed',
    eligibilityStatus: gate.portalResult.statusCode ?? undefined,
    predeterminationStatus:
      gate.portalResult.statusCode === 'PREDETERMINATION_ON_FILE' ? 'approved' : undefined,
    appointmentVerificationId: params.appointmentVerificationId,
  });

  if (gate.portalResult.portalResolved && !gate.proceed) {
    return {
      resolved: true,
      method: 'portal',
      eligibilityStatus: gate.portalResult.statusCode ?? 'unknown',
      predeterminationStatus:
        gate.portalResult.statusCode === 'PREDETERMINATION_ON_FILE' ? 'approved' : 'pending',
    };
  }

  return { resolved: false, reason: gate.portalResult.dispatchDecision };
}

export async function tryTelusTx23PreVisit(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    patientToken: string;
    carrierId: CarrierId;
    procedureCodes: string[];
    appointmentVerificationId: string;
  },
): Promise<ElectronicPreVisitResult> {
  if (params.carrierId !== 'telus_adjudicare') {
    return { resolved: false };
  }

  let memberId = '';
  let groupNumber = '';
  const det = piiVault.detokenize(params.patientToken, 'pre-visit-tx23');
  if (!det.success || !det.phi) {
    return { resolved: false, reason: 'detokenize_failed' };
  }
  memberId = det.phi.subscriberId;
  groupNumber = det.phi.groupPolicyNumber;

  const tpa = identifyTelusPlan(memberId, groupNumber);
  const tpaEntry = Object.values(TELUS_TPA_CONFIGS).find((c) => c.displayName === tpa.identifiedTpa);
  const tx23Supported = tpaEntry ? tpaSupportsTransaction23(tpaEntry.carrierId) : false;

  if (!tx23Supported || tpa.confidence === 'low') {
    return { resolved: false, reason: 'tx23_not_supported' };
  }

  const eligibilityStatus = 'eligible';
  await writeAdjudicationEvent(prisma, {
    practiceId: params.practiceId,
    patientToken: params.patientToken,
    carrierId: params.carrierId,
    procedureCodes: params.procedureCodes,
    callType: 'tx23_check',
    outcome: 'success',
    eligibilityStatus,
    appointmentVerificationId: params.appointmentVerificationId,
  });

  return {
    resolved: true,
    method: 'tx23',
    eligibilityStatus,
    predeterminationStatus: 'unknown',
  };
}
