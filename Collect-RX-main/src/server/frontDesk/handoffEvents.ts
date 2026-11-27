import type { PrismaClient, CarrierId } from '@prisma/client';
import { logger } from '../observability/logger.js';

/**
 * Structured handoff events (B-06). Log lines carry ids and counts only, never
 * patient data, names, numbers or free text. Under a blind transfer the call
 * leaves Vapi, so "staff answered" and "seconds to answer" cannot be observed
 * here; they need the conference design (B-01).
 */
export type HandoffEventName =
  | 'handoff_attempted'
  | 'handoff_log_received'
  | 'handoff_no_log'
  | 'automation_suspicion_flagged';

export function emitHandoffEvent(
  name: HandoffEventName,
  fields: { practiceId?: string; carrierId?: string; claimId?: string; vapiCallId?: string; callAttemptId?: string },
): void {
  logger.info(`[handoff-event] ${name}`, { event: name, ...fields });
}

/**
 * A rep saying they suspect an automated caller must reach a human. It does
 * not suspend the carrier by itself (a stray remark should not stop a
 * practice's calls); it opens an escalation so staff decide, and it is
 * logged so repeats per carrier can be counted.
 */
export async function openAutomationSuspicionReview(
  prisma: PrismaClient,
  input: {
    practiceId: string;
    claimId: string;
    claimRef: string;
    carrierId: CarrierId;
    amountClaimedCents: number;
    callAttemptId?: string;
    vapiCallId?: string;
  },
): Promise<void> {
  emitHandoffEvent('automation_suspicion_flagged', {
    practiceId: input.practiceId,
    carrierId: input.carrierId,
    claimId: input.claimId,
    vapiCallId: input.vapiCallId,
  });
  try {
    const { createEscalation } = await import('../services/escalationService.js');
    await createEscalation(prisma, {
      practiceId: input.practiceId,
      claimId: input.claimId,
      claimRef: input.claimRef,
      carrierId: input.carrierId,
      amountClaimedCents: input.amountClaimedCents,
      reason:
        'A carrier rep indicated they suspected an automated caller. Review before the next call to this carrier; suspend the carrier if the concern is real.',
      callAttemptId: input.callAttemptId,
    });
  } catch (err) {
    logger.error('[handoff-event] suspicion review escalation failed (non-fatal)', { error: err });
  }
}
