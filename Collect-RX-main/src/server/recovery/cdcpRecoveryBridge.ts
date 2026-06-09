import type { PrismaClient } from '@prisma/client';
import {
  detectDenialFromEndOfCall,
  upsertReconsiderationFromSignal,
  type DenialSignal,
} from '../canadianExpansion/autoReconsideration.js';
import { deriveInitialStatus } from '../canadianExpansion/reconsideration.js';

export interface CdcpCaseLinkResult {
  caseId: string;
  created: boolean;
}

/** Unified CDCP case open — structured Vapi signal, call outcome, or PMS T11 row. */
export async function ensureCdcpCaseForClaim(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    patientToken: string;
    claimRef: string;
    procedureCode?: string | null;
    reasonCode?: string | null;
    vapiCallId?: string | null;
    clinicalSummary?: string | null;
  },
): Promise<CdcpCaseLinkResult | null> {
  const existing = await prisma.cdcpReconsiderationCase.findFirst({
    where: { practiceId: params.practiceId, claimRef: params.claimRef },
    select: { id: true },
  });
  if (existing) return { caseId: existing.id, created: false };

  const init = deriveInitialStatus(params.procedureCode ?? null);
  if (init.status === 'excluded') return null;

  const row = await prisma.cdcpReconsiderationCase.create({
    data: {
      practiceId: params.practiceId,
      patientToken: params.patientToken,
      claimRef: params.claimRef,
      carrierCode: 'cdcp_sunlife',
      procedureCode: params.procedureCode,
      denialDate: new Date(),
      status: init.status,
      exclusionReason: init.exclusionReason,
      clinicalEvidenceSummary:
        params.clinicalSummary?.slice(0, 2000) ??
        (params.reasonCode
          ? `CDCP denial (${params.reasonCode})`
          : 'Auto-opened from recovery routing.'),
    },
  });

  return { caseId: row.id, created: true };
}

export async function tryCdcpFromVapiPayload(
  prisma: PrismaClient,
  body: unknown,
): Promise<CdcpCaseLinkResult | null> {
  const message = (body as { message?: unknown })?.message;
  if (!message || typeof message !== 'object') return null;
  const signal = detectDenialFromEndOfCall(message as Parameters<typeof detectDenialFromEndOfCall>[0]);
  if (!signal) return null;
  const upsert = await upsertReconsiderationFromSignal(prisma, signal);
  return { caseId: upsert.id, created: upsert.created };
}

export function buildPmsT11DenialSignal(params: {
  practiceId: string;
  patientToken: string;
  claimRef: string;
  procedureCode?: string | null;
  reasonCode?: string | null;
}): DenialSignal {
  return {
    practiceId: params.practiceId,
    patientToken: params.patientToken,
    claimRef: params.claimRef,
    carrierCode: 'cdcp_sunlife',
    procedureCode: params.procedureCode ?? null,
    vapiCallId: null,
    reasonCode: params.reasonCode ?? 'T11',
  };
}

export async function linkRecoveryActionToCdcpCase(
  prisma: PrismaClient,
  claimId: string,
  cdcpCaseId: string,
): Promise<void> {
  await prisma.claimRecoveryAction.updateMany({
    where: {
      claimId,
      actionType: 'CDCP_RECONSIDERATION',
      clearedAt: null,
    },
    data: { cdcpCaseId },
  });
}
