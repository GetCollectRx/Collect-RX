import type { CarrierId, PrismaClient } from '@prisma/client';
import { createEscalation } from '../services/escalationService.js';

/**
 * What happens to a claim that dispatch refuses because a person must take over:
 * it is over 90 days in autonomous mode, or it has used its three attempts. The
 * claim and its queue entry leave the automatic pool, and an open escalation is
 * written. The Escalations page reads call_escalations, not claim status, so a
 * claim that is only marked ESCALATED is invisible to the screen built to work
 * it. Both the scheduler and the manual "Call now" route use this.
 */
export type EscalatingGuardCode = 'ESCALATE_OVER_90' | 'MAX_ATTEMPTS';

export function isEscalatingGuardCode(code: string | undefined): code is EscalatingGuardCode {
  return code === 'ESCALATE_OVER_90' || code === 'MAX_ATTEMPTS';
}

export async function escalateClaimForGuard(
  prisma: PrismaClient,
  input: {
    practiceId: string;
    claimId: string;
    /** Null when the claim has no queue row (a manual click on an unqueued claim). */
    queueEntryId: string | null;
    claimNumber: string;
    carrierId: CarrierId;
    outstandingAmount: unknown;
    attempts: number;
    code: EscalatingGuardCode;
    reason?: string;
  },
): Promise<void> {
  await prisma.$transaction([
    prisma.insuranceClaim.update({
      where: { id: input.claimId },
      data: { status: 'ESCALATED' },
    }),
    ...(input.queueEntryId
      ? [
          prisma.callQueue.update({
            where: { id: input.queueEntryId },
            data: { status: 'ESCALATED' },
          }),
        ]
      : []),
  ]);
  const reason =
    input.code === 'MAX_ATTEMPTS'
      ? 'Maximum automated call attempts reached'
      : input.reason ?? 'Claim aged past 90 days — escalate to human';
  const existingEscalation = await prisma.callEscalation.findFirst({
    where: {
      practiceId: input.practiceId,
      claimId: input.claimId,
      status: 'open',
      reason,
    },
    select: { id: true },
  });
  if (!existingEscalation) {
    await createEscalation(prisma, {
      practiceId: input.practiceId,
      claimId: input.claimId,
      claimRef: input.claimNumber,
      carrierId: input.carrierId,
      amountClaimedCents: Math.round(Number(input.outstandingAmount) * 100),
      reason,
      attemptNumber: input.code === 'MAX_ATTEMPTS' ? 3 : input.attempts,
    });
  }
}
