import type { CallAttempt, PrismaClient } from '@prisma/client';

export interface DispatchedCallAttemptInput {
  claimId: string;
  vapiCallId: string;
  /** True for V1 human-assisted-squad calls. Authorizes request_staff_handoff. */
  isHumanAssisted: boolean;
  initiatedAt?: Date;
}

/**
 * Records the CallAttempt for a call the dispatcher just placed.
 *
 * Upsert, not create: the call.started webhook (vapiDeskEvents) can write the
 * row first, without isHumanAssisted. The update branch sets the flag so a
 * human-assisted call stays authorized for staff handoff regardless of which
 * writer arrives first. Never throws on a duplicate vapiCallId.
 */
export async function recordDispatchedCallAttempt(
  prisma: PrismaClient,
  input: DispatchedCallAttemptInput,
): Promise<CallAttempt> {
  return prisma.callAttempt.upsert({
    where: { vapiCallId: input.vapiCallId },
    create: {
      claimId: input.claimId,
      vapiCallId: input.vapiCallId,
      initiatedAt: input.initiatedAt ?? new Date(),
      liveState: 'dialing',
      activeAgent: 'IVR_Navigator',
      // Excludes this call from CarrierLesson extraction (learning loop
      // webhook path) - that pipeline is scoped to the autonomous squad only.
      isHumanAssisted: input.isHumanAssisted,
    },
    update: { isHumanAssisted: input.isHumanAssisted },
  });
}
