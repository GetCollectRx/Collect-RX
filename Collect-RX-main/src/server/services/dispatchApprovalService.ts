// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Dispatch approval service.
//
// Human-in-the-loop checkpoint before a claim's first outbound Vapi call
// (RDC-SO accountability guidance / PHIPA audit-trail requirement). See
// DispatchApprovalStatus + DispatchApproval in prisma/schema.prisma, and
// checkDispatchApprovalGate() in src/carriers/adapter.ts, which is the
// enforcement point — this service only manages the review/decision side.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import type { CarrierId, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { appendAuditLog } from '../audit/auditLog.js';
import { piiVault } from '../../pii-vault.js';

const MAX_DECISIONS_PER_BATCH = 200;

export interface PendingApprovalItem {
  callQueueId: string;
  claimId: string;
  patientName: string;
  claimNumber: string;
  carrierId: CarrierId;
  outstandingAmount: number;
  daysOutstanding: number;
  flagReason: string;
  queuedSince: string;
}

interface ClaimFlagFields {
  status: string;
  denialReasonCode: string | null;
  denialReasonText: string | null;
}

/** Human-readable reason a claim needs review — never includes PHI, only claim metadata. */
function flagReasonForClaim(claim: ClaimFlagFields): string {
  if (claim.denialReasonText) return claim.denialReasonText;
  if (claim.denialReasonCode) return `Denial code ${claim.denialReasonCode}`;
  if (claim.status === 'DENIED') return 'Carrier denial on file';
  if (claim.status === 'ESCALATED') return 'Previously escalated — re-queued for outbound calling';
  return 'Outstanding balance aged into the carrier-call window';
}

/**
 * Resolves a patientToken to a display name for the reviewing practice — same
 * detokenize pattern as priorityEngine.ts's displayPatientName. The practice
 * IS the covered entity for its own patients (RBAC differentiates by role:
 * see routes/dispatchApprovals.ts, which masks this for platform_dev only).
 */
function displayPatientName(patientToken: string, practiceId: string): string {
  const r = piiVault.detokenize(patientToken, 'dispatch-approval-review', { practiceId });
  if (!r.success || !r.phi?.patientName?.trim()) {
    return `Patient ${patientToken.slice(0, 8)}…`;
  }
  return r.phi.patientName.trim();
}

export async function listPendingDispatchApprovals(
  prisma: PrismaClient,
  practiceId: string,
): Promise<PendingApprovalItem[]> {
  const rows = await prisma.callQueue.findMany({
    where: {
      practiceId,
      approvalStatus: 'PENDING_REVIEW',
      claim: { deletedAt: null },
    },
    include: {
      claim: {
        select: {
          patientToken: true,
          claimNumber: true,
          carrierId: true,
          outstandingAmount: true,
          daysOutstanding: true,
          status: true,
          denialReasonCode: true,
          denialReasonText: true,
        },
      },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  return rows.map((r) => ({
    callQueueId: r.id,
    claimId: r.claimId,
    patientName: displayPatientName(r.claim.patientToken, practiceId),
    claimNumber: r.claim.claimNumber,
    carrierId: r.claim.carrierId,
    outstandingAmount: Number(r.claim.outstandingAmount),
    daysOutstanding: r.claim.daysOutstanding,
    flagReason: flagReasonForClaim(r.claim),
    queuedSince: r.createdAt.toISOString(),
  }));
}

export interface DispatchDecisionInput {
  claimId: string;
  decision: 'APPROVED' | 'SKIPPED';
  notes?: string;
}

export interface DecideBatchResult {
  batchId: string;
  decided: number;
  /** claimIds the caller sent that were no longer PENDING_REVIEW (already decided by
   * someone else, or not in this practice's queue) — the UI should surface these as
   * "already handled" rather than silently dropping them. */
  skipped: string[];
}

/**
 * Applies a batch of approve/skip decisions. Each claim is only decided if it is
 * still PENDING_REVIEW at write time — a claim another reviewer already acted on
 * (stale UI, two staff reviewing concurrently) is reported back in `skipped`
 * rather than silently overwritten, so the audit trail never shows two people
 * deciding the same claim.
 */
export async function decideDispatchApprovalBatch(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    decidedByUserId: string;
    decisions: DispatchDecisionInput[];
    req?: Request;
  },
): Promise<DecideBatchResult> {
  const { practiceId, decidedByUserId, decisions, req } = params;
  if (decisions.length === 0) return { batchId: '', decided: 0, skipped: [] };
  if (decisions.length > MAX_DECISIONS_PER_BATCH) {
    throw new Error(`Maximum ${MAX_DECISIONS_PER_BATCH} claims per approval batch`);
  }

  const batchId = randomUUID();
  const claimIds = decisions.map((d) => d.claimId);

  const queueRows = await prisma.callQueue.findMany({
    where: {
      practiceId,
      claimId: { in: claimIds },
      approvalStatus: 'PENDING_REVIEW',
    },
    include: {
      claim: {
        select: {
          carrierId: true,
          outstandingAmount: true,
          denialReasonCode: true,
          denialReasonText: true,
          status: true,
        },
      },
    },
  });
  const byClaimId = new Map(queueRows.map((r) => [r.claimId, r]));
  const skipped = claimIds.filter((id) => !byClaimId.has(id));

  let decided = 0;
  for (const d of decisions) {
    const row = byClaimId.get(d.claimId);
    if (!row) continue;

    const flagReasonSnapshot = flagReasonForClaim(row.claim);

    await prisma.$transaction([
      prisma.callQueue.update({
        where: { id: row.id },
        data: {
          approvalStatus: d.decision,
          approvalDecidedBy: decidedByUserId,
          approvalDecidedAt: new Date(),
        },
      }),
      prisma.dispatchApproval.create({
        data: {
          batchId,
          practiceId,
          claimId: d.claimId,
          callQueueId: row.id,
          carrierId: row.claim.carrierId,
          flagReasonSnapshot,
          outstandingAmountSnapshot: row.claim.outstandingAmount,
          decision: d.decision,
          decidedByUserId,
          notes: d.notes,
        },
      }),
    ]);

    await appendAuditLog(prisma, {
      practiceId,
      action: d.decision === 'APPROVED' ? 'dispatch_approval.approve' : 'dispatch_approval.skip',
      subjectType: 'claim',
      subjectId: d.claimId,
      details: { batchId, callQueueId: row.id },
      req,
      userId: decidedByUserId,
    });

    decided += 1;
  }

  return { batchId, decided, skipped };
}
