import type { PrismaClient } from '@prisma/client';
import {
  detectDenialFromEndOfCall,
  upsertReconsiderationFromSignal,
  type DenialSignal,
} from '../canadianExpansion/autoReconsideration.js';
import { normalizeCdtCode } from '../canadianExpansion/constants.js';
import { deriveInitialStatus } from '../canadianExpansion/reconsideration.js';

export interface CdcpCaseLinkResult {
  caseId: string;
  created: boolean;
}

interface CdcpCaseMetadata {
  linkedClaimRefs?: string[];
}

const OPEN_CDCP_STATUSES = ['open', 'submitted'] as const;

function procedureCodeQueryVariants(code: string): string[] {
  const normalized = normalizeCdtCode(code);
  const digits = normalized.replace(/^D/, '');
  return [...new Set([normalized, digits, code.trim().toUpperCase()])];
}

/** Extract the primary CDT code from a claim's treatmentCodes field. */
export function primaryProcedureFromTreatmentCodes(treatmentCodes?: string | null): string | null {
  if (!treatmentCodes?.trim()) return null;
  const first = treatmentCodes.split(/[,;\s]+/).find((s) => s.trim());
  return first ? normalizeCdtCode(first.trim()) : null;
}

function parseCaseMetadata(metadata: unknown): CdcpCaseMetadata {
  if (!metadata || typeof metadata !== 'object') return {};
  const linked = (metadata as CdcpCaseMetadata).linkedClaimRefs;
  return {
    linkedClaimRefs: Array.isArray(linked)
      ? linked.filter((r): r is string => typeof r === 'string')
      : undefined,
  };
}

/**
 * Find an open CDCP case for post-visit recovery — by claim ref, linked refs,
 * or pre-visit predet match on (practiceId, patientToken, procedureCode).
 */
export async function findCdcpCaseForRecovery(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    patientToken: string;
    claimRef: string;
    procedureCode?: string | null;
  },
): Promise<{ id: string; claimRef: string } | null> {
  const byClaimRef = await prisma.cdcpReconsiderationCase.findFirst({
    where: {
      practiceId: params.practiceId,
      claimRef: params.claimRef,
      status: { in: [...OPEN_CDCP_STATUSES] },
    },
    select: { id: true, claimRef: true },
  });
  if (byClaimRef) return byClaimRef;

  const linkedCases = await prisma.cdcpReconsiderationCase.findMany({
    where: {
      practiceId: params.practiceId,
      patientToken: params.patientToken,
      status: { in: [...OPEN_CDCP_STATUSES] },
    },
    select: { id: true, claimRef: true, metadata: true },
  });
  for (const row of linkedCases) {
    const meta = parseCaseMetadata(row.metadata);
    if (meta.linkedClaimRefs?.includes(params.claimRef)) {
      return { id: row.id, claimRef: row.claimRef };
    }
  }

  if (params.procedureCode) {
    const variants = procedureCodeQueryVariants(params.procedureCode);
    const byProcedure = await prisma.cdcpReconsiderationCase.findFirst({
      where: {
        practiceId: params.practiceId,
        patientToken: params.patientToken,
        procedureCode: { in: variants },
        status: { in: [...OPEN_CDCP_STATUSES] },
      },
      orderBy: { denialDate: 'desc' },
      select: { id: true, claimRef: true, metadata: true },
    });
    if (byProcedure) return byProcedure;
  }

  return null;
}

/** Whether an open CDCP case exists for this claim (direct or predet-linked). */
export async function hasOpenCdcpCaseForClaim(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    patientToken: string;
    claimRef: string;
    procedureCode?: string | null;
  },
): Promise<boolean> {
  const row = await findCdcpCaseForRecovery(prisma, params);
  return Boolean(row);
}

async function linkClaimRefToCase(
  prisma: PrismaClient,
  caseId: string,
  claimRef: string,
  existingMetadata: unknown,
): Promise<void> {
  const meta = parseCaseMetadata(existingMetadata);
  const linked = new Set(meta.linkedClaimRefs ?? []);
  if (linked.has(claimRef)) return;
  linked.add(claimRef);
  await prisma.cdcpReconsiderationCase.update({
    where: { id: caseId },
    data: { metadata: { ...meta, linkedClaimRefs: [...linked] } },
  });
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
  const existingByRef = await prisma.cdcpReconsiderationCase.findFirst({
    where: { practiceId: params.practiceId, claimRef: params.claimRef },
    select: { id: true },
  });
  if (existingByRef) return { caseId: existingByRef.id, created: false };

  const linked = await findCdcpCaseForRecovery(prisma, {
    practiceId: params.practiceId,
    patientToken: params.patientToken,
    claimRef: params.claimRef,
    procedureCode: params.procedureCode,
  });
  if (linked) {
    const full = await prisma.cdcpReconsiderationCase.findUnique({
      where: { id: linked.id },
      select: { id: true, metadata: true },
    });
    if (full) {
      await linkClaimRefToCase(prisma, full.id, params.claimRef, full.metadata);
      return { caseId: full.id, created: false };
    }
  }

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
  authority?: { practiceId: string; patientToken: string },
): Promise<CdcpCaseLinkResult | null> {
  const message = (body as { message?: unknown })?.message;
  if (!message || typeof message !== 'object') return null;
  const signal = detectDenialFromEndOfCall(message as Parameters<typeof detectDenialFromEndOfCall>[0]);
  if (!signal) return null;
  // The detected practice/patient identity originates from LLM structured
  // output; when the caller already resolved the claim server-side, its
  // identity wins so the case row cannot land in the wrong tenant.
  const upsert = await upsertReconsiderationFromSignal(
    prisma,
    authority ? { ...signal, ...authority } : signal,
  );
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
