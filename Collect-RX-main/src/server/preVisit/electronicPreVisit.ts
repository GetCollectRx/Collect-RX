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
import { submitTx23Inquiry } from './cdanetTx23Client.js';

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
    const det = piiVault.detokenize(params.patientToken, 'pre-visit-portal', {
      practiceId: params.practiceId,
    });
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

interface TelusTx23Identification {
  supported: boolean;
  reason?: string;
  memberId?: string;
  groupNumber?: string;
}

function identifyTelusTx23(patientToken: string, practiceId: string): TelusTx23Identification {
  const det = piiVault.detokenize(patientToken, 'pre-visit-tx23', { practiceId });
  if (!det.success || !det.phi) {
    return { supported: false, reason: 'detokenize_failed' };
  }
  const memberId = det.phi.subscriberId;
  const groupNumber = det.phi.groupPolicyNumber;

  const tpa = identifyTelusPlan(memberId, groupNumber);
  const tpaEntry = Object.values(TELUS_TPA_CONFIGS).find((c) => c.displayName === tpa.identifiedTpa);
  const tx23Supported = tpaEntry ? tpaSupportsTransaction23(tpaEntry.carrierId) : false;

  if (!tx23Supported || tpa.confidence === 'low') {
    return { supported: false, reason: 'tx23_not_supported' };
  }

  return { supported: true, memberId, groupNumber };
}

/**
 * Identification-only check — does not submit a live Tx23 inquiry. Safe to
 * call inline during appointment verification to decide whether a Tx23 check
 * is required; the actual dispatch happens later via `tryTelusTx23PreVisit`,
 * run from the worker.
 */
export function checkTelusTx23Support(
  carrierId: CarrierId,
  patientToken: string,
  practiceId: string,
): { supported: boolean; reason?: string } {
  if (carrierId !== 'telus_adjudicare') {
    return { supported: false, reason: 'not_telus' };
  }
  const identification = identifyTelusTx23(patientToken, practiceId);
  return { supported: identification.supported, reason: identification.reason };
}

/**
 * Submits a live CDAnet Tx23 inquiry. Only call from the worker
 * (PRE_VISIT_TELUS_TX23 job) — never inline in the verification request path.
 */
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

  const identification = identifyTelusTx23(params.patientToken, params.practiceId);
  if (!identification.supported || !identification.memberId || !identification.groupNumber) {
    return { resolved: false, reason: identification.reason };
  }
  const memberId = identification.memberId;
  const groupNumber = identification.groupNumber;

  const settings = await getPracticeSettings(prisma, params.practiceId);
  const carrierCfg = settings.carrierConfigs.find((c) => c.carrierId === 'telus_adjudicare');
  const providerNumber = carrierCfg?.providerNumber?.trim();
  if (!providerNumber) {
    return { resolved: false, reason: 'no_provider_number' };
  }

  const tx23 = await submitTx23Inquiry({
    providerNumber,
    memberId,
    groupNumber,
    procedureCodes: params.procedureCodes,
  });

  await writeAdjudicationEvent(prisma, {
    practiceId: params.practiceId,
    patientToken: params.patientToken,
    carrierId: params.carrierId,
    procedureCodes: params.procedureCodes,
    callType: 'tx23_check',
    outcome: tx23.resolved ? 'success' : 'failed',
    eligibilityStatus: tx23.eligibilityStatus,
    predeterminationStatus: tx23.predeterminationStatus,
    appointmentVerificationId: params.appointmentVerificationId,
  });

  if (!tx23.resolved) {
    return { resolved: false, reason: tx23.reason ?? 'tx23_unresolved' };
  }

  return {
    resolved: true,
    method: 'tx23',
    eligibilityStatus: tx23.eligibilityStatus ?? 'unknown',
    predeterminationStatus: tx23.predeterminationStatus ?? 'unknown',
  };
}
