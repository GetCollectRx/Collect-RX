import type { CdcpReconsiderationCase, PrismaClient, Prisma } from '@prisma/client';
import {
  calculateReconsiderationStatus,
  triageReconsiderationQueue,
  type QueuedReconsideration,
} from '../services/cdcp/reconsiderationEngine.js';
import type { CdcpDenialReasonCode, ReconsiderationRecord, ReconsiderationStatus, CdcpDeniedClaim, EvidenceSubmissionMethod } from '../services/cdcp/types.js';
import { upsertReconsiderationFromSignal } from '../canadianExpansion/autoReconsideration.js';
import { buildPmsT11DenialSignal } from './cdcpRecoveryBridge.js';

export interface CdcpCaseMetadata {
  assignedAdjudicatorId?: string;
  confirmationNumber?: string;
  submissionMethod?: EvidenceSubmissionMethod;
  submittedAt?: string;
  notes?: string;
}

function parseCaseMetadata(raw: unknown): CdcpCaseMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const m = raw as Record<string, unknown>;
  const out: CdcpCaseMetadata = {};
  if (typeof m.assignedAdjudicatorId === 'string') out.assignedAdjudicatorId = m.assignedAdjudicatorId;
  if (typeof m.confirmationNumber === 'string') out.confirmationNumber = m.confirmationNumber;
  if (m.submissionMethod === 'cdanet_09' || m.submissionMethod === 'paper_fallback') {
    out.submissionMethod = m.submissionMethod;
  }
  if (typeof m.submittedAt === 'string') out.submittedAt = m.submittedAt;
  if (typeof m.notes === 'string') out.notes = m.notes;
  return out;
}

const LEGACY_STATUS_TO_PRISMA: Record<string, { status: string; exclusionReason?: string }> = {
  eligible: { status: 'open' },
  urgent: { status: 'open' },
  expired: { status: 'excluded', exclusionReason: '60-day reconsideration window elapsed' },
  submitted: { status: 'submitted' },
  under_review: { status: 'submitted' },
  approved: { status: 'approved' },
  denied_final: { status: 'denied_final' },
  open: { status: 'open' },
  excluded: { status: 'excluded' },
};

function mapLegacyPatchStatus(status: string): { status: string; exclusionReason?: string } | null {
  return LEGACY_STATUS_TO_PRISMA[status] ?? null;
}

function mapPrismaStatusToQueueStatus(
  row: CdcpReconsiderationCase,
  timing: ReturnType<typeof calculateReconsiderationStatus>,
): ReconsiderationStatus {
  if (row.status === 'submitted') return 'submitted';
  if (row.status === 'approved') return 'approved';
  if (row.status === 'denied_final') return 'denied_final';
  if (row.status === 'excluded') return 'expired';
  if (timing.isExpired) return 'expired';
  if (timing.isUrgent) return 'urgent';
  return 'eligible';
}

export function prismaCaseToReconsiderationRecord(
  row: CdcpReconsiderationCase,
  asOf = new Date(),
): ReconsiderationRecord {
  const timing = calculateReconsiderationStatus(row.denialDate, asOf);
  const meta = parseCaseMetadata(row.metadata);
  return {
    id: row.id,
    claimId: row.claimRef,
    patientToken: row.patientToken,
    practiceId: row.practiceId,
    denialReasonCode: (row.clinicalEvidenceSummary?.includes('T11') ? 'T11' : 'F-010') as CdcpDenialReasonCode,
    denialDate: row.denialDate,
    deadlineDate: timing.deadlineDate,
    urgentEscalationDate: timing.urgentEscalationDate,
    status: mapPrismaStatusToQueueStatus(row, timing),
    evidenceChecklist: [],
    submissionMethod: meta.submissionMethod,
    submittedAt: meta.submittedAt ? new Date(meta.submittedAt) : undefined,
    originalAdjudicatorId: row.originalAdjudicatorHint ?? undefined,
    assignedAdjudicatorId: meta.assignedAdjudicatorId,
    notes: meta.notes ?? row.clinicalEvidenceSummary ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCdcpQueueFromPrisma(
  prisma: PrismaClient,
  practiceId: string,
): Promise<{
  total: number;
  urgent: number;
  queue: Array<QueuedReconsideration & { cdtCode?: string; province?: string }>;
}> {
  const rows = await prisma.cdcpReconsiderationCase.findMany({
    where: {
      practiceId,
      status: { notIn: ['approved', 'denied_final', 'excluded'] },
    },
    orderBy: { denialDate: 'asc' },
    take: 200,
  });

  const records = rows.map((r) => prismaCaseToReconsiderationRecord(r));
  const triaged = triageReconsiderationQueue(records);

  return {
    total: triaged.length,
    urgent: triaged.filter((t) => t.priority === 'urgent').length,
    queue: triaged.map((t) => ({
      ...t,
      cdtCode: rows.find((r) => r.id === t.record.id)?.procedureCode ?? undefined,
      province: undefined,
    })),
  };
}

/** Ingest AbelDent T11 denials into the unified Prisma CDCP case store. */
export async function ingestCdcpDeniedClaimsToPrisma(
  prisma: PrismaClient,
  practiceId: string,
  claims: CdcpDeniedClaim[],
): Promise<{ processed: number; newReconsiderations: number; urgentClaimIds: string[] }> {
  let newReconsiderations = 0;
  const urgentClaimIds: string[] = [];

  for (const claim of claims.filter((c) => c.practiceId === practiceId)) {
    const signal = buildPmsT11DenialSignal({
      practiceId,
      patientToken: claim.patientToken,
      claimRef: claim.claimId,
      procedureCode: claim.cdtCode ?? null,
      reasonCode: claim.denialReasonCode ?? 'T11',
    });
    const upsert = await upsertReconsiderationFromSignal(prisma, signal);
    if (upsert.created) {
      newReconsiderations += 1;
      const timing = calculateReconsiderationStatus(claim.denialDate);
      if (timing.isUrgent) urgentClaimIds.push(claim.claimId);
    }
  }

  return {
    processed: claims.length,
    newReconsiderations,
    urgentClaimIds,
  };
}

export interface PatchCdcpReconsiderationInput {
  status?: string;
  assignedAdjudicatorId?: string;
  confirmationNumber?: string;
  notes?: string;
  submissionMethod?: string;
}

export type PatchCdcpReconsiderationResult =
  | { ok: true }
  | { ok: false; httpStatus: 404 | 422; error: string };

/** PATCH /api/cdcp/reconsiderations/:id — Prisma-backed update with adjudicator rotation rules. */
export async function patchCdcpReconsiderationCase(
  prisma: PrismaClient,
  practiceId: string,
  caseId: string,
  patch: PatchCdcpReconsiderationInput,
): Promise<PatchCdcpReconsiderationResult> {
  const existing = await prisma.cdcpReconsiderationCase.findFirst({
    where: { id: caseId, practiceId },
  });
  if (!existing) {
    return { ok: false, httpStatus: 404, error: 'Reconsideration not found' };
  }

  if (patch.assignedAdjudicatorId) {
    const { validateAdjudicatorRotation } = await import('../services/cdcp/reconsiderationEngine.js');
    const rotationCheck = validateAdjudicatorRotation(
      existing.originalAdjudicatorHint ?? undefined,
      patch.assignedAdjudicatorId,
    );
    if (!rotationCheck.valid) {
      return { ok: false, httpStatus: 422, error: rotationCheck.reason ?? 'Invalid adjudicator assignment' };
    }
  }

  const meta = parseCaseMetadata(existing.metadata);
  const nextMeta: CdcpCaseMetadata = { ...meta };
  if (patch.assignedAdjudicatorId) nextMeta.assignedAdjudicatorId = patch.assignedAdjudicatorId;
  if (patch.confirmationNumber) nextMeta.confirmationNumber = patch.confirmationNumber;
  if (patch.submissionMethod === 'cdanet_09' || patch.submissionMethod === 'paper_fallback') {
    nextMeta.submissionMethod = patch.submissionMethod;
  }
  if (patch.notes !== undefined) nextMeta.notes = patch.notes;

  const data: {
    status?: string;
    exclusionReason?: string | null;
    metadata: Prisma.InputJsonValue;
  } = { metadata: nextMeta as unknown as Prisma.InputJsonValue };

  if (patch.status) {
    const mapped = mapLegacyPatchStatus(patch.status);
    if (!mapped) {
      return { ok: false, httpStatus: 422, error: `Unsupported status: ${patch.status}` };
    }
    data.status = mapped.status;
    if (mapped.exclusionReason !== undefined) {
      data.exclusionReason = mapped.exclusionReason;
    }
    if (mapped.status === 'submitted' && !nextMeta.submittedAt) {
      nextMeta.submittedAt = new Date().toISOString();
      data.metadata = nextMeta as unknown as Prisma.InputJsonValue;
    }
  }

  await prisma.cdcpReconsiderationCase.update({
    where: { id: caseId },
    data,
  });

  return { ok: true };
}
