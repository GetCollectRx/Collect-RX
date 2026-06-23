import type { CarrierId, PrismaClient } from '@prisma/client';
import type { EscalationDto, EscalationResolution } from '../../types/practiceSettings.js';

function mapRow(row: {
  id: string;
  practiceId: string;
  callAttemptId: string | null;
  claimId: string;
  claimRef: string;
  carrierId: CarrierId;
  amountClaimedCents: number;
  reason: string;
  status: string;
  resolution: string | null;
  resolvedByStaffId: string | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  attemptNumber: number | null;
  createdAt: Date;
}): EscalationDto {
  return {
    id: row.id,
    practiceId: row.practiceId,
    callId: row.callAttemptId,
    claimId: row.claimId,
    claimRef: row.claimRef,
    carrierId: row.carrierId,
    amountClaimedCents: row.amountClaimedCents,
    reason: row.reason,
    status: row.status as 'open' | 'resolved',
    resolution: row.resolution as EscalationResolution | null,
    resolvedByStaffId: row.resolvedByStaffId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNotes: row.resolutionNotes,
    attemptNumber: row.attemptNumber,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createEscalation(
  prisma: PrismaClient,
  input: {
    practiceId: string;
    claimId: string;
    claimRef: string;
    carrierId: CarrierId;
    amountClaimedCents: number;
    reason: string;
    callAttemptId?: string;
    attemptNumber?: number;
  },
): Promise<EscalationDto> {
  const row = await prisma.callEscalation.create({
    data: {
      practiceId: input.practiceId,
      claimId: input.claimId,
      claimRef: input.claimRef,
      carrierId: input.carrierId,
      amountClaimedCents: input.amountClaimedCents,
      reason: input.reason,
      callAttemptId: input.callAttemptId ?? null,
      attemptNumber: input.attemptNumber ?? null,
      status: 'open',
    },
  });
  return mapRow(row);
}

export async function listEscalations(
  prisma: PrismaClient,
  practiceId: string,
  status?: 'open' | 'resolved',
  limit = 50,
): Promise<EscalationDto[]> {
  const rows = await prisma.callEscalation.findMany({
    where: {
      practiceId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(mapRow);
}

export async function resolveEscalation(
  prisma: PrismaClient,
  practiceId: string,
  escalationId: string,
  input: {
    resolution: EscalationResolution;
    notes?: string;
    staffId: string;
  },
): Promise<EscalationDto | null> {
  const existing = await prisma.callEscalation.findFirst({
    where: { id: escalationId, practiceId },
  });
  if (!existing) return null;

  const row = await prisma.callEscalation.update({
    where: { id: escalationId },
    data: {
      status: input.resolution === 'paused_for_review' ? 'open' : 'resolved',
      resolution: input.resolution,
      resolutionNotes: input.notes ?? null,
      resolvedByStaffId: input.staffId,
      resolvedAt: new Date(),
    },
  });

  if (input.resolution === 'written_off') {
    await prisma.callQueue.deleteMany({ where: { claimId: existing.claimId } });
    await prisma.insuranceClaim.update({
      where: { id: existing.claimId },
      data: { status: 'DENIED' },
    });
  } else if (input.resolution === 'appealing' || input.resolution === 'paused_for_review') {
    await prisma.insuranceClaim.update({
      where: { id: existing.claimId },
      data: { status: 'ON_HOLD' },
    });
  }

  return mapRow(row);
}

export async function countOpenEscalations(
  prisma: PrismaClient,
  practiceId: string,
): Promise<number> {
  return prisma.callEscalation.count({ where: { practiceId, status: 'open' } });
}
