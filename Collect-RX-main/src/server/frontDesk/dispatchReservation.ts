import type { ClaimStatus, PrismaClient, QueueStatus } from '@prisma/client';

/**
 * Takes the claim for the scheduler under the same row lock the manual "Call
 * now" route uses, so the two dispatchers cannot both dial one claim. Each
 * re-reads the claim and queue state while holding the claim row lock; the
 * second one in sees CALLING or IN_PROGRESS and stands down.
 *
 * Attempt accounting is unchanged: the scheduler still counts the attempt after
 * the dial. This only marks the claim in flight before it.
 */
export type SchedulerReservation =
  | { ok: true; priorClaimStatus: ClaimStatus }
  | { ok: false; reason: string };

export async function reserveSchedulerSlot(
  prisma: PrismaClient,
  input: { practiceId: string; claimId: string; queueEntryId: string },
): Promise<SchedulerReservation> {
  return prisma.$transaction(
    async (tx) => {
      // Raw statements on tx only: a model call would go through the RLS
      // extension, open a second connection and wait on the lock this
      // transaction holds (see the manual route's reservation).
      await tx.$executeRawUnsafe(`SELECT set_config('app.practice_id', $1, true)`, input.practiceId);
      await tx.$queryRawUnsafe(`SELECT id FROM insurance_claims WHERE id = $1 FOR UPDATE`, input.claimId);
      const rows = await tx.$queryRawUnsafe<Array<{ claim_status: ClaimStatus; queue_status: QueueStatus | null }>>(
        `SELECT c.status AS claim_status, q.status AS queue_status
         FROM insurance_claims c
         LEFT JOIN call_queue q ON q.id = $2
         WHERE c.id = $1`,
        input.claimId,
        input.queueEntryId,
      );
      const row = rows[0];
      if (!row) return { ok: false as const, reason: 'Claim no longer exists' };
      if (row.claim_status === 'CALLING' || row.queue_status === 'IN_PROGRESS') {
        return { ok: false as const, reason: 'A call is already in progress for this claim' };
      }
      if (row.queue_status !== 'PENDING') {
        return { ok: false as const, reason: `Queue entry is ${row.queue_status ?? 'missing'}, not PENDING` };
      }
      await tx.$executeRawUnsafe(`UPDATE insurance_claims SET status = 'CALLING' WHERE id = $1`, input.claimId);
      await tx.$executeRawUnsafe(
        `UPDATE call_queue SET status = 'IN_PROGRESS', updated_at = now() WHERE id = $1`,
        input.queueEntryId,
      );
      return { ok: true as const, priorClaimStatus: row.claim_status };
    },
    { timeout: 15000, maxWait: 10000 },
  );
}

/** Gives the claim back after a dial that did not happen or could not be recorded. */
export async function releaseSchedulerSlot(
  prisma: PrismaClient,
  input: { claimId: string; queueEntryId: string; priorClaimStatus: ClaimStatus },
): Promise<void> {
  await prisma.$transaction([
    prisma.insuranceClaim.updateMany({
      where: { id: input.claimId, status: 'CALLING' },
      data: { status: input.priorClaimStatus },
    }),
    prisma.callQueue.updateMany({
      where: { id: input.queueEntryId, status: 'IN_PROGRESS' },
      data: { status: 'PENDING' },
    }),
  ]);
}
